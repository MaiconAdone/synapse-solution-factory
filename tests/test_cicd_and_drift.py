"""Local CI/CD engine and drift monitor: CI stages, build, promotion rules, smoke, rollback, hook."""

import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer
from scripts.synapse_lib.cicd import CicdError, CicdPipeline, CommandResult, install_hook
from scripts.synapse_lib.drift import DriftError, DriftMonitor, categorical_psi, numeric_psi
from scripts.synapse_lib.harness_service import HarnessAuditor
from scripts.synapse_lib.improvement_loop import ImprovementLoop

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / "config/cicd_policy.json").read_text(encoding="utf-8-sig"))


class FakeExecutor:
    """Stands in for subprocess: scripted exit codes and eval metrics per command."""

    def __init__(self, fail=(), metrics=None, smoke_fail=False):
        self.fail = set(fail)
        self.metrics = metrics or {}
        self.smoke_fail = smoke_fail
        self.commands = []

    def run(self, command, cwd):
        self.commands.append((command, Path(cwd)))
        joined = " ".join(command)
        if command[:2] == ["git", "rev-parse"]:
            return CommandResult(0, "abc1234\n" if "--short" in command else "abc1234def\n")
        if "run_evals.py" in joined:
            mode = command[-1]
            in_release = "releases" in Path(cwd).parts
            failed = mode in self.fail or (in_release and self.smoke_fail)
            payload = {"metrics": self.metrics.get(mode, {"pass_rate": 1.0})}
            return CommandResult(1 if failed else 0, json.dumps(payload))
        stage = "tests" if "pytest" in joined else "validate" if "audit_harness" in joined else "other"
        return CommandResult(1 if stage in self.fail else 0, "")


def project(tmp_path, universe="ia"):
    root = tmp_path / "proj"
    for folder in ("config", "scripts", "evals", "templates"):
        (root / folder).mkdir(parents=True)
    (root / "config/project_universe.json").write_text(json.dumps({"universe": universe}), encoding="utf-8")
    (root / "config/cicd_policy.json").write_text(json.dumps(POLICY), encoding="utf-8")
    (root / "scripts/run_evals.py").write_text("# evals\n", encoding="utf-8")
    (root / "requirements.txt").write_text("pytest\n", encoding="utf-8")
    return root


def pipeline(root, **kwargs):
    return CicdPipeline(root, executor=FakeExecutor(**kwargs), python="python")


# --- CI -------------------------------------------------------------------------------

def test_ci_runs_stages_in_order_and_builds_a_hashed_bundle(tmp_path):
    root = project(tmp_path)
    run = pipeline(root).run_ci()
    assert run["passed"] and [step["id"] for step in run["steps"]] == ["validate", "tests", "evals", "build"]
    manifest = json.loads((root / "artifacts/builds" / run["version"] / "build_manifest.json").read_text(encoding="utf-8"))
    assert manifest["ci_passed"] and "config/cicd_policy.json" in manifest["files"]
    assert set(manifest["gates"]) == set(POLICY["evals_by_universe"]["ia"])
    assert manifest["git_commit"] == "abc1234def"
    assert (root / "artifacts/cicd/reports" / f"{run['run_id']}.md").exists()


def test_failures_stop_the_pipeline_and_skip_later_stages(tmp_path):
    root = project(tmp_path)
    tests_failed = pipeline(root, fail={"tests"}).run_ci()
    assert not tests_failed["passed"] and [s["status"] for s in tests_failed["steps"]] == ["passed", "failed", "skipped", "skipped"]
    eval_failed = pipeline(root, fail={"graph"}).run_ci()
    evals = next(step for step in eval_failed["steps"] if step["id"] == "evals")
    assert evals["status"] == "failed" and evals["detail"]["failed"] == ["graph"] and eval_failed["version"] is None


def test_build_io_error_is_a_failed_step_not_a_crash(tmp_path, monkeypatch):
    import scripts.synapse_lib.cicd as cicd_module

    def broken_copy(*args, **kwargs):
        raise OSError("path too long")

    monkeypatch.setattr(cicd_module.shutil, "copy2", broken_copy)
    run = pipeline(project(tmp_path)).run_ci()
    build = next(step for step in run["steps"] if step["id"] == "build")
    assert not run["passed"] and build["status"] == "failed" and "path too long" in build["detail"]["error"]


def test_eval_suites_follow_the_universe(tmp_path):
    assert pipeline(project(tmp_path / "a", "ml")).eval_modes() == ["ml"]
    hybrid = project(tmp_path / "b", "hybrid")
    (hybrid / "evals/voice_agent_cases.jsonl").write_text("{}\n", encoding="utf-8")
    assert pipeline(hybrid).eval_modes() == [*POLICY["evals_by_universe"]["hybrid"], "voice"]


# --- CD -------------------------------------------------------------------------------

def test_promotion_path_prod_approver_and_status(tmp_path):
    root = project(tmp_path)
    cicd = pipeline(root)
    version = cicd.run_ci()["version"]
    assert cicd.promote(version, "staging")["status"] == "blocked"  # must pass through dev first
    assert cicd.promote(version, "dev")["status"] == "promoted"
    assert cicd.promote(version, "staging")["status"] == "promoted"
    assert cicd.promote(version, "prod")["checks"]["named_approver"] is False
    assert cicd.promote(version, "prod", approver="Outra Pessoa")["status"] == "blocked"
    promoted = cicd.promote(version, "prod", approver="Maicon Adone")
    assert promoted["status"] == "promoted" and promoted["smoke"]["checks"]["manifest_integrity"]
    assert cicd.status()["environments"]["prod"]["version"] == version
    with pytest.raises(CicdError):
        cicd.promote(version, "qa")


def test_promote_without_version_takes_the_previous_stage(tmp_path):
    root = project(tmp_path)
    cicd = pipeline(root)
    with pytest.raises(CicdError):
        cicd.promote(None, "dev")  # no build yet
    version = cicd.run_ci()["version"]
    assert cicd.promote(None, "dev")["version"] == version
    with pytest.raises(CicdError, match="omit --version"):
        cicd.promote("VERSAO_DO_PASSO_2", "staging")
    assert cicd.promote(None, "staging")["version"] == version
    prod = cicd.promote(None, "prod", approver="Maicon Adone")
    assert prod["status"] == "promoted" and prod["version"] == version


def test_no_regression_blocks_worse_candidates(tmp_path):
    root = project(tmp_path)
    good = CicdPipeline(root, executor=FakeExecutor(metrics={"retrieval": {"recall_at_k": 0.9}}), python="python")
    first = good.run_ci()["version"]
    for env in ("dev", "staging"):
        good.promote(first, env)
    worse = CicdPipeline(root, executor=FakeExecutor(metrics={"retrieval": {"recall_at_k": 0.8}}), python="python")
    second = worse.run_ci()["version"]
    worse.promote(second, "dev")
    blocked = worse.promote(second, "staging")
    assert blocked["status"] == "blocked" and blocked["regressions"] == ["retrieval.recall_at_k: 0.9 -> 0.8"]


def test_smoke_failure_rolls_back_automatically_and_manual_rollback(tmp_path):
    root = project(tmp_path)
    cicd = pipeline(root)
    first = cicd.run_ci()["version"]
    cicd.promote(first, "dev")
    second = cicd.run_ci()["version"]
    broken = pipeline(root, smoke_fail=True)
    record = broken.promote(second, "dev")
    assert record["status"] == "rolled_back" and cicd.current("dev")["version"] == first
    first_ever = broken.promote(first, "staging")
    assert first_ever["status"] == "rolled_back" and first_ever["rollback"]["to_version"] is None and cicd.current("staging") is None
    cicd.promote(second, "dev")
    rollback = cicd.rollback("dev", reason="incidente", actor="Maicon Adone")
    assert rollback["to_version"] == first and cicd.current("dev")["version"] == first
    with pytest.raises(CicdError):
        cicd.rollback("prod", reason="x", actor="y")


def test_tampered_release_fails_smoke(tmp_path):
    root = project(tmp_path)
    cicd = pipeline(root)
    version = cicd.run_ci()["version"]
    cicd.promote(version, "dev")
    (root / "artifacts/releases/dev" / version / "config/cicd_policy.json").write_text("{}", encoding="utf-8")
    smoke = cicd.smoke("dev", version)
    assert not smoke["passed"] and smoke["tampered_files"] == ["config/cicd_policy.json"]


# --- hook -----------------------------------------------------------------------------

def test_install_hook_initializes_git_and_writes_pre_push(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("git not installed")
    root = tmp_path / "novo"
    root.mkdir()
    assert install_hook(root)["installed"] is False
    inside_repo = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True, check=False)
    if inside_repo.returncode == 0:  # pytest temp dir inside a repository (e.g. the pipeline's --basetemp)
        assert "inside another repository" in install_hook(root, init_git=True)["reason"]
        return
    result = install_hook(root, init_git=True)
    assert result["installed"] and "synapse_ci.py ci --no-build --trigger pre-push" in Path(result["hook"]).read_text(encoding="utf-8")
    nested = root / "sub"
    nested.mkdir()
    assert install_hook(nested, init_git=True)["installed"] is False  # never nests repositories


# --- drift ----------------------------------------------------------------------------

def test_psi_math():
    rng = random.Random(1)
    reference = [rng.gauss(0, 1) for _ in range(2000)]
    assert numeric_psi(reference, [rng.gauss(0, 1) for _ in range(2000)]) < 0.1
    assert numeric_psi(reference, [rng.gauss(1.5, 1) for _ in range(2000)]) > 0.2
    assert categorical_psi(["a"] * 50 + ["b"] * 50, ["a"] * 50 + ["b"] * 50) == pytest.approx(0.0)


def test_drift_opens_retraining_request_and_review_case(tmp_path):
    loop_policy = json.loads((ROOT / "config/agent_improvement_loop.json").read_text(encoding="utf-8-sig"))
    loop = ImprovementLoop(root=tmp_path, policy=loop_policy)
    monitor = DriftMonitor(root=tmp_path, policy=POLICY["drift"], capture=loop.capture)
    rng = random.Random(3)
    (tmp_path / "data").mkdir()
    rows = lambda mu, cat: "\n".join(f"{rng.gauss(mu, 1):.4f},{cat},{rng.random():.3f}" for _ in range(200))
    (tmp_path / "data/ref.csv").write_text("x,canal,pred\n" + rows(0, "loja"), encoding="utf-8")
    (tmp_path / "data/cur.csv").write_text("x,canal,pred\n" + rows(3, "app"), encoding="utf-8")
    report = monitor.check("data/ref.csv", "data/cur.csv", prediction_column="pred", model_id="demanda-v1")
    assert report["status"] == "drift" and {"x", "canal"} <= set(report["drifted_features"])
    assert report["features"]["pred"]["signal"] == "prediction_drift"
    assert report["retraining_request"]["status"] == "pending_human_approval"
    assert (tmp_path / POLICY["drift"]["retraining_requests"]).exists()
    assert loop.pending_reviews()[0]["agent_id"] == "drift-monitor"
    with pytest.raises(DriftError):
        monitor.check("../fora.csv", "data/cur.csv")
    with pytest.raises(DriftError):
        monitor.compare([{"x": 1}] * 5, [{"x": 1}] * 5)


# --- integration ----------------------------------------------------------------------

def test_harness_analyzer_and_workflows_are_connected():
    ia = HarnessAuditor(root=ROOT).audit("ia")
    ml = HarnessAuditor(root=ROOT).audit("ml")
    assert "cicd" in {c["id"] for c in ia["components"]} and "drift_monitoring" not in {c["id"] for c in ia["components"]}
    assert {"cicd", "drift_monitoring"} <= {c["id"] for c in ml["components"]} and ml["harness_ready"] and ia["harness_ready"]
    analysis = BusinessSolutionAnalyzer(root=ROOT).analyze(project_goal="previsao", business_problem="prever demanda", requested_universe="ML")
    assert analysis["cicd"]["eval_gates"] == ["ml"] and analysis["cicd"]["drift_active"] is True
    assert analysis["cicd"]["prod_approvers"] == ["Maicon Adone"]
    assert "## CI/CD Local" in BusinessSolutionAnalyzer(root=ROOT).to_markdown(analysis)
    for name in ("ml-release", "rag-build"):
        workflow = json.loads((ROOT / f"config/workflows/synapse/{name}.json").read_text(encoding="utf-8-sig"))
        assert all("synapse_ci.py" in command for command in workflow["executable_pipeline"].values())


def test_cli_plan_and_stdlib_boundary():
    completed = subprocess.run([sys.executable, "scripts/synapse_ci.py", "plan"], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert completed.returncode == 0 and json.loads(completed.stdout)["prod_approvers"] == ["Maicon Adone"]
    code = (
        "import sys; [sys.modules.__setitem__(m, None) for m in ('numpy', 'pydantic')]; sys.path.insert(0, '.');"
        "from scripts.synapse_lib.cicd import CicdPipeline; from scripts.synapse_lib.drift import DriftMonitor; print('ok')"
    )
    stdlib = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert stdlib.returncode == 0, stdlib.stderr

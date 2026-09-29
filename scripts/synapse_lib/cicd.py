"""Local CI/CD engine (config/cicd_policy.json): no cloud, no containers.

CI: validate (harness audit) -> tests (pytest) -> evals of the universe (gates of
evals/quality_gates.yaml) -> build of a versioned bundle with a SHA-256 manifest.

CD: promote dev -> staging -> prod. Each promotion checks the policy
requirements (CI passed, came from the previous environment, no regression of
eval metrics against the version currently in the target environment, named
approver for prod), copies the bundle to ``releases/<env>/<version>``, moves the
``current.json`` pointer, runs smoke checks inside the release and rolls back
automatically when they fail. Every run is appended to the history JSONL with a
markdown report.

Every external step is a command run through ``CommandExecutor`` so tests can
substitute it. Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

UNIVERSES = {"ml", "ia", "chatbolt", "hybrid"}


class CicdError(ValueError):
    pass


@dataclass
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class CommandExecutor:
    def __init__(self, timeout: int = 1800) -> None:
        self.timeout = timeout

    def run(self, command: list[str], cwd: Path) -> CommandResult:
        completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=self.timeout, check=False)
        return CommandResult(completed.returncode, completed.stdout, completed.stderr)


@dataclass
class StepResult:
    id: str
    status: str  # passed | failed | skipped
    duration_ms: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lp(path: Path) -> Path:
    """Extended-length path on Windows so deep bundles survive the 260-character limit."""
    if os.name != "nt":
        return path
    prefix = "\\\\?\\"
    text = str(path.resolve())
    return Path(text if text.startswith(prefix) else prefix + text)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with _lp(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


class CicdPipeline:
    def __init__(
        self,
        root: Path | None = None,
        policy: dict[str, Any] | None = None,
        executor: CommandExecutor | Any = None,
        python: str = sys.executable,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        if policy is None:
            path = self.root / "config" / "cicd_policy.json"
            if not path.exists():
                raise CicdError("config/cicd_policy.json is required")
            policy = json.loads(path.read_text(encoding="utf-8-sig"))
        self.policy = policy
        self.executor = executor or CommandExecutor()
        self.python = python
        self.clock = clock

    # --- planning ---------------------------------------------------------------
    def universe(self) -> str:
        profile = self.root / "config" / "project_universe.json"
        if profile.exists():
            universe = json.loads(profile.read_text(encoding="utf-8-sig")).get("universe", "hybrid")
            return universe if universe in UNIVERSES else "hybrid"
        return "hybrid"

    def eval_modes(self, universe: str | None = None) -> list[str]:
        selected = universe or self.universe()
        modes = list(self.policy["evals_by_universe"][selected])
        modes += [mode for mode, cases in self.policy.get("optional_evals", {}).items() if (self.root / cases).exists()]
        return modes

    def plan(self) -> dict[str, Any]:
        universe = self.universe()
        return {
            "universe": universe,
            "stages": [stage["id"] for stage in self.policy["stages"]],
            "evals": self.eval_modes(universe),
            "environments": self.policy["environments"],
            "prod_approvers": self.policy["approvers"]["prod"],
            "drift_active": universe in self.policy["drift"]["applies_to_universes"],
        }

    # --- CI -------------------------------------------------------------------------
    def run_ci(self, trigger: str = "manual", build: bool = True) -> dict[str, Any]:
        universe = self.universe()
        run = {"run_id": uuid.uuid4().hex[:12], "kind": "ci", "trigger": trigger, "universe": universe, "started_at": _now()}
        steps: list[StepResult] = []
        gates: dict[str, Any] = {}
        for stage in self.policy["stages"]:
            if any(step.status == "failed" for step in steps):
                steps.append(StepResult(stage["id"], "skipped"))
                continue
            if stage["id"] == "evals":
                result, gates = self._run_evals(universe)
            elif stage["id"] == "build":
                if not build:
                    steps.append(StepResult("build", "skipped", detail={"reason": "--no-build"}))
                    continue
                try:
                    result = self._build(run["run_id"], universe, gates)
                except OSError as error:
                    result = StepResult("build", "failed", detail={"error": str(error)})
            else:
                result = self._command_step(stage, universe)
            steps.append(result)
        run["steps"] = [asdict(step) for step in steps]
        run["passed"] = all(step.status in {"passed", "skipped"} for step in steps)
        run["version"] = next((s.detail.get("version") for s in steps if s.id == "build" and s.status == "passed"), None)
        run["finished_at"] = _now()
        self._record(run)
        return run

    def _command_step(self, stage: dict[str, Any], universe: str) -> StepResult:
        command = [part.replace("{python}", self.python).replace("{universe}", universe) for part in stage["command"]]
        started = self.clock()
        result = self.executor.run(command, self.root)
        detail = {"command": " ".join(command), "returncode": result.returncode}
        if result.returncode != 0:
            detail["output_tail"] = (result.stdout + result.stderr)[-1500:]
        return StepResult(stage["id"], "passed" if result.returncode == 0 else "failed", self._elapsed(started), detail)

    def _run_evals(self, universe: str, cwd: Path | None = None, modes: list[str] | None = None) -> tuple[StepResult, dict[str, Any]]:
        started = self.clock()
        gates: dict[str, Any] = {}
        for mode in modes or self.eval_modes(universe):
            result = self.executor.run([self.python, "scripts/run_evals.py", mode], cwd or self.root)
            try:
                payload = json.loads(result.stdout)
                metrics = payload.get("metrics", {})
            except json.JSONDecodeError:
                metrics = {}
            gates[mode] = {"passed": result.returncode == 0, "metrics": metrics}
        failed = sorted(mode for mode, gate in gates.items() if not gate["passed"])
        status = "failed" if failed else "passed"
        return StepResult("evals", status, self._elapsed(started), {"modes": sorted(gates), "failed": failed}), gates

    def _build(self, run_id: str, universe: str, gates: dict[str, Any]) -> StepResult:
        started = self.clock()
        # Short folder name (Windows path limits); the git commit lives in the manifest.
        version = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{run_id[:4]}"
        settings = self.policy["build"]
        target = self.root / settings["output_dir"] / version
        _lp(target).mkdir(parents=True, exist_ok=False)
        files: dict[str, str] = {}
        for item in settings["include"]:
            source = self.root / item
            for path in ([source] if source.is_file() else sorted(source.rglob("*")) if source.is_dir() else []):
                if not path.is_file() or self._excluded(path, settings):
                    continue
                relative = path.relative_to(self.root).as_posix()
                destination = target / relative
                _lp(destination.parent).mkdir(parents=True, exist_ok=True)
                shutil.copy2(_lp(path), _lp(destination))
                files[relative] = _sha256(destination)
        manifest = {
            "schema": "synapse-build-manifest.v1",
            "version": version,
            "run_id": run_id,
            "universe": universe,
            "created_at": _now(),
            "git_commit": self._git_sha(full=True),
            "ci_passed": all(gate["passed"] for gate in gates.values()),
            "gates": gates,
            "files": files,
        }
        _lp(target / settings["manifest"]).write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        return StepResult("build", "passed", self._elapsed(started), {"version": version, "files": len(files), "path": str(target.relative_to(self.root))})

    def _excluded(self, path: Path, settings: dict[str, Any]) -> bool:
        parts = set(path.relative_to(self.root).parts)
        return bool(parts & set(settings["exclude_names"])) or path.suffix in settings["exclude_suffixes"]

    # --- CD -------------------------------------------------------------------------
    def current(self, env: str) -> dict[str, Any] | None:
        pointer = self._releases() / env / "current.json"
        return json.loads(pointer.read_text(encoding="utf-8")) if pointer.exists() else None

    def resolve_version(self, env: str, version: str | None = None) -> str:
        """Explicit version, or (None/"latest") what the previous stage holds: last passing build for dev, else the source env."""
        if env not in self.policy["environments"]:
            raise CicdError(f"unknown environment {env}")
        if version and version != "latest":
            if not (self.root / self.policy["build"]["output_dir"] / version / self.policy["build"]["manifest"]).exists():
                source = self.policy["promotion"][env]["from"]
                raise CicdError(f"build {version} not found; omit --version to promote what is in {source}")
            return version
        source = self.policy["promotion"][env]["from"]
        if source != "build":
            current = self.current(source)
            if not current:
                raise CicdError(f"nothing promoted to {source} yet; run python scripts/synapse_ci.py pipeline")
            return current["version"]
        builds = self.root / self.policy["build"]["output_dir"]
        passing = [
            path.name
            for path in sorted(builds.iterdir() if builds.exists() else [])
            if (path / self.policy["build"]["manifest"]).exists()
            and json.loads((path / self.policy["build"]["manifest"]).read_text(encoding="utf-8")).get("ci_passed")
        ]
        if not passing:
            raise CicdError("no passing build yet; run python scripts/synapse_ci.py ci")
        return passing[-1]

    def promote(self, version: str | None, env: str, approver: str | None = None) -> dict[str, Any]:
        version = self.resolve_version(env, version)
        rules = self.policy["promotion"][env]
        manifest = self._manifest(version)
        record = {"run_id": uuid.uuid4().hex[:12], "kind": "promotion", "env": env, "version": version, "approver": approver, "started_at": _now()}
        checks = {"ci_passed": bool(manifest.get("ci_passed"))}
        if rules["from"] != "build":
            previous_env = self.current(rules["from"])
            checks[f"from_{rules['from']}"] = bool(previous_env) and previous_env["version"] == version
        if "no_regression" in rules["requires"]:
            checks["no_regression"], record["regressions"] = self._no_regression(manifest, self.current(env))
        if "named_approver" in rules["requires"]:
            checks["named_approver"] = bool(approver) and approver in self.policy["approvers"].get(env, [])
        record["checks"] = checks
        if not all(checks.values()):
            record.update({"status": "blocked", "finished_at": _now()})
            self._record(record)
            return record

        release = self._releases() / env / version
        if release.exists():
            shutil.rmtree(_lp(release))
        _lp(release.parent).mkdir(parents=True, exist_ok=True)
        shutil.copytree(_lp(self.root / self.policy["build"]["output_dir"] / version), _lp(release))
        previous = self.current(env)
        self._write_pointer(env, version, approver, previous)
        smoke = self.smoke(env, version)
        record["smoke"] = smoke
        if smoke["passed"]:
            record["status"] = "promoted"
        elif self.policy["rollback"].get("auto_on_smoke_failure", True):
            record["status"] = "rolled_back"
            if previous:
                record["rollback"] = self.rollback(env, reason="smoke checks failed", actor="cicd", record=False)
            else:
                (self._releases() / env / "current.json").unlink()
                record["rollback"] = {"env": env, "from_version": version, "to_version": None, "reason": "smoke checks failed; environment left empty"}
        else:
            record["status"] = "smoke_failed"
        record["finished_at"] = _now()
        self._record(record)
        return record

    def smoke(self, env: str, version: str) -> dict[str, Any]:
        release = self._releases() / env / version
        manifest = json.loads((release / self.policy["build"]["manifest"]).read_text(encoding="utf-8"))
        tampered = [rel for rel, digest in manifest["files"].items() if not _lp(release / rel).exists() or _sha256(release / rel) != digest]
        checks: dict[str, Any] = {"manifest_integrity": not tampered}
        modes = self.policy["smoke"]["evals_by_universe"][manifest["universe"]]
        step, _ = self._run_evals(manifest["universe"], cwd=release, modes=modes)
        checks["smoke_evals"] = step.status == "passed"
        if (release / "templates/backend/fastapi_service.py").exists():
            probe = self.executor.run([self.python, "-c", FASTAPI_PROBE], release)
            checks["fastapi_health"] = probe.returncode in {0, 3}  # 3 = fastapi not installed (optional)
        return {"passed": all(checks.values()), "checks": checks, "tampered_files": tampered[:10]}

    def rollback(self, env: str, reason: str, actor: str, record: bool = True) -> dict[str, Any]:
        pointer = self.current(env)
        if not pointer or not pointer.get("history"):
            raise CicdError(f"no previous version to roll back to in {env}")
        history = list(pointer["history"])
        target = history.pop()
        self._write_pointer(env, target["version"], target.get("approver"), None, history=history)
        result = {"kind": "rollback", "env": env, "from_version": pointer["version"], "to_version": target["version"], "reason": reason, "actor": actor, "at": _now()}
        if record:
            self._record({"run_id": uuid.uuid4().hex[:12], **result, "status": "rolled_back"})
        return result

    def status(self) -> dict[str, Any]:
        history_path = self.root / self.policy["history"]["runs"]
        runs = [json.loads(line) for line in history_path.read_text(encoding="utf-8").splitlines() if line.strip()] if history_path.exists() else []
        return {
            "environments": {env: self.current(env) for env in self.policy["environments"]},
            "last_runs": runs[-5:],
        }

    # --- helpers --------------------------------------------------------------------
    def _no_regression(self, manifest: dict[str, Any], current: dict[str, Any] | None) -> tuple[bool, list[str]]:
        if not current:
            return True, []
        baseline = self._manifest(current["version"]).get("gates", {})
        tracked = set(self.policy["no_regression_metrics"])
        regressions = []
        for mode, gate in manifest.get("gates", {}).items():
            previous = baseline.get(mode, {}).get("metrics", {})
            for name, value in gate.get("metrics", {}).items():
                if name in tracked and isinstance(value, (int, float)) and isinstance(previous.get(name), (int, float)) and value < previous[name]:
                    regressions.append(f"{mode}.{name}: {previous[name]} -> {value}")
        return not regressions, regressions

    def _manifest(self, version: str) -> dict[str, Any]:
        path = self.root / self.policy["build"]["output_dir"] / version / self.policy["build"]["manifest"]
        if not path.exists():
            raise CicdError(f"build {version} not found")
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_pointer(self, env: str, version: str, approver: str | None, previous: dict[str, Any] | None, history: list | None = None) -> None:
        if history is None:
            history = list((previous or {}).get("history", []))
            if previous:
                history.append({"version": previous["version"], "approver": previous.get("approver")})
        pointer = {"env": env, "version": version, "approver": approver, "promoted_at": _now(), "history": history}
        target = self._releases() / env / "current.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(pointer, indent=2, ensure_ascii=False), encoding="utf-8")

    def _releases(self) -> Path:
        return self.root / self.policy["releases_dir"]

    def _record(self, run: dict[str, Any]) -> None:
        history = self.root / self.policy["history"]["runs"]
        history.parent.mkdir(parents=True, exist_ok=True)
        with history.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(run, ensure_ascii=False) + "\n")
        reports = self.root / self.policy["history"]["reports_dir"]
        reports.mkdir(parents=True, exist_ok=True)
        (reports / f"{run['run_id']}.md").write_text(render_report(run), encoding="utf-8")

    def _git_sha(self, full: bool = False) -> str:
        try:
            result = self.executor.run(["git", "rev-parse", "HEAD" if full else "--short", *([] if full else ["HEAD"])], self.root)
        except (OSError, subprocess.SubprocessError):
            return "nogit"
        sha = result.stdout.strip() if result.returncode == 0 else ""
        return sha or "nogit"

    def _elapsed(self, started: float) -> float:
        return round((self.clock() - started) * 1000, 3)


def render_report(run: dict[str, Any]) -> str:
    lines = [f"# CI/CD {run['kind']} {run['run_id']}", ""]
    for key in ("trigger", "universe", "env", "version", "approver", "status", "passed", "started_at", "finished_at", "reason"):
        if run.get(key) not in (None, ""):
            lines.append(f"- {key}: {run[key]}")
    if run.get("steps"):
        lines += ["", "| Etapa | Status | ms |", "|-------|--------|----|"]
        lines += [f"| {step['id']} | {step['status']} | {step['duration_ms']} |" for step in run["steps"]]
    if run.get("checks"):
        lines += ["", "## Checks", ""] + [f"- {name}: {value}" for name, value in run["checks"].items()]
    if run.get("regressions"):
        lines += ["", "## Regressoes", ""] + [f"- {item}" for item in run["regressions"]]
    return "\n".join(lines) + "\n"


FASTAPI_PROBE = (
    "import sys\n"
    "try:\n"
    "    from fastapi.testclient import TestClient\n"
    "except ImportError:\n"
    "    sys.exit(3)\n"
    "sys.path.insert(0, '.')\n"
    "from templates.backend.fastapi_service import create_app\n"
    "client = TestClient(create_app(gateway=object()))\n"
    "sys.exit(0 if client.get('/health').status_code == 200 else 1)\n"
)


HOOK_SCRIPT = """#!/bin/sh
# Installed by Synapse (config/cicd_policy.json): local CI before every push.
if [ -x ".venv/Scripts/python.exe" ]; then PY=".venv/Scripts/python.exe";
elif [ -x ".venv/bin/python" ]; then PY=".venv/bin/python";
else PY="python"; fi
"$PY" scripts/synapse_ci.py ci --no-build --trigger pre-push || {
  echo "Synapse CI falhou: push bloqueado. Veja artifacts/cicd/reports." >&2
  exit 1
}
"""


def install_hook(root: Path, init_git: bool = False, executor: CommandExecutor | Any = None) -> dict[str, Any]:
    """Install the pre-push hook; with init_git, create the repository when none exists."""
    executor = executor or CommandExecutor(timeout=60)
    try:
        inside = executor.run(["git", "rev-parse", "--show-toplevel"], root)
    except (OSError, subprocess.SubprocessError):
        return {"installed": False, "reason": "git not available"}
    toplevel = Path(inside.stdout.strip()).resolve() if inside.returncode == 0 and inside.stdout.strip() else None
    if toplevel is None or toplevel != root.resolve():
        if toplevel is not None:
            return {"installed": False, "reason": f"project is inside another repository ({toplevel}); hook not installed"}
        if not init_git:
            return {"installed": False, "reason": "not a git repository (use --init-git)"}
        created = executor.run(["git", "init", "-q"], root)
        if created.returncode != 0:
            return {"installed": False, "reason": "git init failed"}
    hooks = executor.run(["git", "rev-parse", "--git-path", "hooks"], root)
    hooks_dir = (root / hooks.stdout.strip()).resolve() if hooks.returncode == 0 and hooks.stdout.strip() else root / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook = hooks_dir / "pre-push"
    hook.write_text(HOOK_SCRIPT, encoding="utf-8", newline="\n")
    hook.chmod(0o755)
    return {"installed": True, "hook": str(hook)}

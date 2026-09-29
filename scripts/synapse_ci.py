"""Local CI/CD command line (config/cicd_policy.json). No cloud or containers.

    python scripts/synapse_ci.py plan
    python scripts/synapse_ci.py ci [--no-build] [--trigger manual]
    python scripts/synapse_ci.py pipeline                     # ci + dev + staging
    python scripts/synapse_ci.py promote --env prod --approver "Maicon Adone"   # version from staging
    python scripts/synapse_ci.py rollback --env prod --reason "<texto>" --actor "<nome>"
    python scripts/synapse_ci.py status
    python scripts/synapse_ci.py drift --reference <treino.csv> --current <producao.csv>
    python scripts/synapse_ci.py install-hook [--init-git]
    python scripts/synapse_ci.py serve --env prod [--port 8000]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.cicd import CicdError, CicdPipeline, install_hook  # noqa: E402
from scripts.synapse_lib.drift import DriftError, DriftMonitor  # noqa: E402
from scripts.synapse_lib.improvement_loop import ImprovementLoop  # noqa: E402


def _print(payload: dict) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Synapse local CI/CD (no cloud, no containers).")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("plan")
    ci = sub.add_parser("ci")
    ci.add_argument("--no-build", action="store_true")
    ci.add_argument("--trigger", default="manual")
    sub.add_parser("pipeline")
    promote = sub.add_parser("promote")
    promote.add_argument("--version", help="default: the version currently in the previous environment")
    promote.add_argument("--env", required=True)
    promote.add_argument("--approver")
    rollback = sub.add_parser("rollback")
    rollback.add_argument("--env", required=True)
    rollback.add_argument("--reason", required=True)
    rollback.add_argument("--actor", required=True)
    sub.add_parser("status")
    drift = sub.add_parser("drift")
    drift.add_argument("--reference", required=True)
    drift.add_argument("--current", required=True)
    drift.add_argument("--features", help="comma-separated feature names (default: shared columns)")
    drift.add_argument("--prediction-column")
    drift.add_argument("--model-id")
    hook = sub.add_parser("install-hook")
    hook.add_argument("--init-git", action="store_true")
    serve = sub.add_parser("serve")
    serve.add_argument("--env", default="prod")
    serve.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    try:
        if args.command == "install-hook":
            result = install_hook(ROOT, init_git=args.init_git)
            _print(result)
            return 0
        if args.command == "drift":
            monitor = DriftMonitor(ROOT, capture=ImprovementLoop(ROOT).capture)
            features = [item.strip() for item in args.features.split(",")] if args.features else None
            report = monitor.check(args.reference, args.current, features, args.prediction_column, args.model_id)
            _print(report)
            return 1 if report["status"] == "drift" else 0
        pipeline = CicdPipeline(ROOT)
        if args.command == "plan":
            _print(pipeline.plan())
            return 0
        if args.command == "ci":
            run = pipeline.run_ci(trigger=args.trigger, build=not args.no_build)
            _print(run)
            return 0 if run["passed"] else 1
        if args.command == "pipeline":
            run = pipeline.run_ci(trigger="pipeline")
            result = {"ci": run, "promotions": []}
            if run["passed"] and run["version"]:
                for env in ("dev", "staging"):
                    promotion = pipeline.promote(run["version"], env)
                    result["promotions"].append(promotion)
                    if promotion["status"] != "promoted":
                        break
                approver = pipeline.policy["approvers"]["prod"][0]
                result["next"] = f'python scripts/synapse_ci.py promote --env prod --approver "{approver}"'
            _print(result)
            ok = run["passed"] and all(item["status"] == "promoted" for item in result["promotions"])
            return 0 if ok else 1
        if args.command == "promote":
            record = pipeline.promote(args.version, args.env, args.approver)
            _print(record)
            return 0 if record["status"] == "promoted" else 1
        if args.command == "rollback":
            _print(pipeline.rollback(args.env, args.reason, args.actor))
            return 0
        if args.command == "status":
            _print(pipeline.status())
            return 0
        if args.command == "serve":
            current = pipeline.current(args.env)
            if not current:
                raise CicdError(f"nothing promoted to {args.env}")
            release = ROOT / pipeline.policy["releases_dir"] / args.env / current["version"]
            command = [sys.executable, "-m", "uvicorn", "templates.backend.fastapi_service:create_app", "--factory", "--port", str(args.port)]
            return subprocess.call(command, cwd=release)
    except (CicdError, DriftError) as error:
        _print({"ok": False, "error": str(error)})
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

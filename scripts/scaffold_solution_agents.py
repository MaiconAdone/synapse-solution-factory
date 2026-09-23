import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.solution_agents import build_solution_agents, validate_solution_agents  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Draft runtime agent blueprints (config/solution_agents.json) from the business solution analysis."
    )
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing config/solution_agents.json.")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    target = project_root / "config" / "solution_agents.json"
    if args.validate_only:
        problems = validate_solution_agents(json.loads(target.read_text(encoding="utf-8-sig")), project_root)
        print(json.dumps({"ok": not problems, "problems": problems}, ensure_ascii=False))
        return 0 if not problems else 1

    if target.exists() and not args.force:
        print(json.dumps({"ok": False, "error": f"{target} exists; use --force to overwrite"}, ensure_ascii=False))
        return 1
    analysis = json.loads((project_root / "config" / "business_solution_analysis.json").read_text(encoding="utf-8-sig"))
    document = build_solution_agents(analysis, project_root)
    problems = validate_solution_agents(document, project_root)
    target.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"ok": not problems, "path": str(target), "architecture": document["architecture"], "problems": problems}, ensure_ascii=False))
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())

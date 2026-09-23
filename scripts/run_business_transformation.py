import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.business_transformation import BusinessTransformationWorkflow, run_cases  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the governed business transformation workflow (simulation only, no external calls)."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--brief", help="JSON brief, e.g. templates/business/transformation_brief.json")
    group.add_argument("--cases", help="JSONL eval cases, e.g. evals/business_transformation_cases.jsonl")
    parser.add_argument("--output", help="Write the full run report to this JSON file.")
    args = parser.parse_args()

    if args.cases:
        result = run_cases(ROOT / args.cases, root=ROOT)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result["passed"] else 1

    brief = json.loads((ROOT / args.brief).read_text(encoding="utf-8-sig"))
    report = BusinessTransformationWorkflow(root=ROOT).run(brief)
    if args.output:
        target = ROOT / args.output
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {
        "status": report["status"],
        "pending_user_decisions": report["pending_user_decisions"],
        "ranking": report["stages"][-1]["output"]["ranked_opportunities"],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

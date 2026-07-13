from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.eval_service import EvalService  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Synapse evals locally without the web stack.")
    parser.add_argument("mode", choices=("ml", "ai"))
    parser.add_argument("--cases-path")
    parser.add_argument("--model-id")
    args = parser.parse_args()

    service = EvalService(root=ROOT)
    if args.mode == "ml":
        result = service.run_ml_eval(
            model_id=args.model_id,
            cases_path=args.cases_path or "evals/ml_cases.jsonl",
        )
    else:
        result = service.run_ai_eval(
            cases_path=args.cases_path or "evals/prompt_cases.jsonl",
        )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

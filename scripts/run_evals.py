from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.eval_service import EvalService  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Synapse evals locally without the web stack.")
    parser.add_argument("mode", choices=("ml", "ai", "rag", "retrieval", "graph", "agent", "fine_tuning"))
    parser.add_argument("--cases-path")
    parser.add_argument("--model-id")
    parser.add_argument("--runner", help="agent mode: module:function returning proposed tool calls for a case")
    args = parser.parse_args()

    service = EvalService(root=ROOT)
    if args.mode == "ml":
        result = service.run_ml_eval(
            model_id=args.model_id,
            cases_path=args.cases_path or "evals/ml_cases.jsonl",
        )
    elif args.mode == "retrieval":
        result = service.run_retrieval_eval(
            cases_path=args.cases_path or "evals/retrieval_cases.jsonl",
        )
    elif args.mode == "agent":
        runner = None
        if args.runner:
            module_name, _, function_name = args.runner.partition(":")
            runner = getattr(importlib.import_module(module_name), function_name)
        result = service.run_agent_eval(
            cases_path=args.cases_path or "evals/tool_workflow_cases.jsonl",
            runner=runner,
        )
    elif args.mode == "fine_tuning":
        result = service.run_fine_tuning_eval(
            cases_path=args.cases_path or "evals/fine_tuning_cases.jsonl",
        )
    elif args.mode == "graph":
        result = service.run_graph_eval(
            cases_path=args.cases_path or "evals/graph_cases.jsonl",
        )
    elif args.mode == "rag":
        result = service.run_rag_eval(
            cases_path=args.cases_path or "evals/rag_cases.jsonl",
        )
    else:
        result = service.run_ai_eval(
            cases_path=args.cases_path or "evals/prompt_cases.jsonl",
        )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

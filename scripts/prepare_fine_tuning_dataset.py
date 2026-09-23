from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.fine_tuning_service import FineTuningDatasetBuilder, FineTuningError  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate, deduplicate and split a fine-tuning dataset. Never trains or calls a provider."
    )
    parser.add_argument("--input", default="data/learning/training_examples.jsonl")
    parser.add_argument("--output-dir", default="artifacts/fine_tuning")
    parser.add_argument("--tier", choices=("pilot", "production"), default="pilot")
    args = parser.parse_args()

    try:
        report = FineTuningDatasetBuilder(root=ROOT).prepare(args.input, args.output_dir, args.tier)
    except FineTuningError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["ready_for_human_review"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

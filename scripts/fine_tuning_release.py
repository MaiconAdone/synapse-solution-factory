from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.fine_tuning_release import FineTuningReleaseGate, ModelRegistry  # noqa: E402
from scripts.synapse_lib.fine_tuning_service import FineTuningError  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply the fine-tuning release gates to a candidate. Never trains, deploys or switches traffic."
    )
    parser.add_argument("--candidate", required=True, help="JSON shaped like templates/fine_tuning/release_candidate.json")
    parser.add_argument("--register", action="store_true", help="append an approved release to the model registry")
    args = parser.parse_args()

    path = (ROOT / args.candidate).resolve()
    try:
        path.relative_to(ROOT)
    except ValueError:
        print(json.dumps({"ok": False, "error": "candidate must stay inside the project"}))
        return 2
    candidate = json.loads(path.read_text(encoding="utf-8-sig"))
    decision = FineTuningReleaseGate(root=ROOT).evaluate(candidate)
    if args.register:
        try:
            decision["registry_record"] = ModelRegistry(ROOT).register(candidate, decision)
        except FineTuningError as error:
            decision["registry_error"] = str(error)
    print(json.dumps(decision, indent=2, ensure_ascii=False))
    return 0 if decision["decision"] == "approved_for_rollout" else 1


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.harness_service import HarnessAuditor  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit harness engineering readiness for this project.")
    parser.add_argument("--universe", choices=("ml", "ia", "chatbolt", "hybrid"))
    args = parser.parse_args()

    report = HarnessAuditor(root=ROOT).audit(args.universe)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["harness_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

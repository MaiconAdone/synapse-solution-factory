import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_cost_optimization_policy() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    policy_path = root / "config" / "cost_optimization_policy.json"
    with policy_path.open("r", encoding="utf-8-sig") as policy_file:
        return json.load(policy_file)

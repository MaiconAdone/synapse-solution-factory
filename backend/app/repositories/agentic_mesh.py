import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_agent_trust_framework() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    path = root / "config" / "agent_trust_framework.json"
    with path.open("r", encoding="utf-8-sig") as framework_file:
        return json.load(framework_file)


@lru_cache
def load_agent_fleets() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    path = root / "config" / "agent_fleets.json"
    with path.open("r", encoding="utf-8-sig") as fleets_file:
        return json.load(fleets_file)

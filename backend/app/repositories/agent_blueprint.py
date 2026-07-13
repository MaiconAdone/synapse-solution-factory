import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_agent_blueprint_contract() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    path = root / "config" / "agent_blueprint_contract.json"
    with path.open("r", encoding="utf-8-sig") as contract_file:
        return json.load(contract_file)


@lru_cache
def load_agent_improvement_loop() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    path = root / "config" / "agent_improvement_loop.json"
    with path.open("r", encoding="utf-8-sig") as loop_file:
        return json.load(loop_file)

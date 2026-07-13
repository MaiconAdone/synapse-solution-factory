import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_enterprise_spec() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    spec_path = root / "config" / "ai_ml_enterprise_spec.json"
    with spec_path.open("r", encoding="utf-8-sig") as spec_file:
        return json.load(spec_file)

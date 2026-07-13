import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_ai_framework_catalog() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    catalog_path = root / "config" / "ai_framework_selection.json"
    with catalog_path.open("r", encoding="utf-8-sig") as catalog_file:
        return json.load(catalog_file)

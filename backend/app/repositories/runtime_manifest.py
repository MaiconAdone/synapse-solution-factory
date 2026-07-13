import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache
def load_runtime_manifest() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[3]
    manifest_path = root / "config" / "runtime_manifest.json"
    with manifest_path.open("r", encoding="utf-8-sig") as manifest_file:
        return json.load(manifest_file)

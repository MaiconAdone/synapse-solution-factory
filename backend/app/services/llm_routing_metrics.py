import json
from pathlib import Path
from threading import Lock
from typing import Any


class LlmRoutingMetrics:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self._lock = Lock()

    def record(self, event: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, ensure_ascii=True, separators=(",", ":"))
        with self._lock:
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(f"{line}\n")

    def summary(self) -> dict[str, Any]:
        if not self.path.exists():
            return {
                "requests": 0,
                "cloud_requests": 0,
                "retries": 0,
                "cloud_tokens": 0,
            }
        events = []
        with self._lock:
            for line in self.path.read_text(encoding="utf-8").splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return {
            "requests": len(events),
            "cloud_requests": sum(event.get("provider") == "openai" for event in events),
            "retries": sum(bool(event.get("retried")) for event in events),
            "cloud_tokens": sum(
                int(event.get("total_tokens", 0))
                for event in events
                if event.get("provider") == "openai"
            ),
        }

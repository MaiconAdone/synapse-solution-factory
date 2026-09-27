"""Executable agent improvement loop (config/agent_improvement_loop.json).

capture -> classify -> review -> approve -> eval case -> measure, append-only:

- ``capture``: the LLM gateway (or any agent) records a redacted learning event
  in ``memory_targets.learning_events``;
- ``classify``: failures (quality not passed, guard findings, refusals) become
  review candidates in ``memory_targets.teacher_review_cases`` with status
  ``quarantined_pending_review`` - never an active eval case until a human promotes it;
- ``promote``: a named human approves an event for retrieval in a learning scope;
  ``approved_for_training`` stays false (weights change only through
  config/fine_tuning_policy.json);
- ``measure``: success rate and pending review count over the recent window.

Standard library only.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.synapse_lib.agent_harness import redact

MAX_EXCERPT = 500


class ImprovementLoopError(ValueError):
    pass


class ImprovementLoop:
    def __init__(self, root: Path | None = None, project_id: str = "synapse", policy: dict[str, Any] | None = None) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        if policy is None:
            path = self.root / "config" / "agent_improvement_loop.json"
            if not path.exists():
                path = Path(__file__).resolve().parents[2] / "config" / "agent_improvement_loop.json"
            policy = json.loads(path.read_text(encoding="utf-8-sig"))
        self.policy = policy
        targets = policy["memory_targets"]
        self.events_path = self.root / targets["learning_events"]
        self.review_path = self.root / targets["teacher_review_cases"]
        self.scopes = set(policy.get("learning_scopes", []))
        self.project_id = project_id

    def capture(self, event: dict[str, Any]) -> dict[str, Any]:
        record = {
            "event_id": uuid.uuid4().hex,
            "type": "capture",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "project_id": self.project_id,
            "agent_id": event.get("agent_id", "unknown-agent"),
            "request_id": event.get("request_id"),
            "outcome": event.get("outcome"),
            "quality_passed": bool(event.get("quality_passed")),
            "model": event.get("model"),
            "provider": event.get("provider"),
            "findings": list(event.get("findings", [])),
            "response_excerpt": redact(str(event.get("response_excerpt", ""))[:MAX_EXCERPT]),
            "status": "captured",
            "approved_for_training": False,
        }
        self._append(self.events_path, record)
        if self.is_failure(record):
            self._append(
                self.review_path,
                {
                    "id": f"review-{record['event_id'][:12]}",
                    "source_event_id": record["event_id"],
                    "agent_id": record["agent_id"],
                    "outcome": record["outcome"],
                    "findings": record["findings"],
                    "status": "quarantined_pending_review",
                    "reason": "captured failure; a reviewer turns it into an eval case or discards it",
                },
            )
        return record

    @staticmethod
    def is_failure(record: dict[str, Any]) -> bool:
        return not record.get("quality_passed") or bool(record.get("findings"))

    def promote(self, event_id: str, approver: str, scope: str = "project") -> dict[str, Any]:
        if not approver.strip():
            raise ImprovementLoopError("a named human approver is required")
        if scope not in self.scopes:
            raise ImprovementLoopError(f"scope must be one of {sorted(self.scopes)}")
        captured = {event["event_id"]: event for event in self.events() if event.get("type") == "capture"}
        if event_id not in captured:
            raise ImprovementLoopError(f"unknown event {event_id}")
        if self.is_failure(captured[event_id]):
            raise ImprovementLoopError("failed events are reviewed as eval cases, not promoted as examples")
        record = {
            "event_id": uuid.uuid4().hex,
            "type": "promotion",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "promoted_event_id": event_id,
            "approver": approver,
            "scope": scope,
            "status": "approved_for_retrieval",
            "approved_for_training": False,
        }
        self._append(self.events_path, record)
        return record

    def events(self) -> list[dict[str, Any]]:
        return self._read(self.events_path)

    def pending_reviews(self) -> list[dict[str, Any]]:
        return [case for case in self._read(self.review_path) if case.get("status") == "quarantined_pending_review"]

    def measure(self, window: int = 100) -> dict[str, Any]:
        captures = [event for event in self.events() if event.get("type") == "capture"][-window:]
        passed = sum(1 for event in captures if not self.is_failure(event))
        return {
            "window": len(captures),
            "success_rate": passed / len(captures) if captures else None,
            "pending_reviews": len(self.pending_reviews()),
            "promotions": sum(1 for event in self.events() if event.get("type") == "promotion"),
        }

    def _append(self, path: Path, record: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    @staticmethod
    def _read(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

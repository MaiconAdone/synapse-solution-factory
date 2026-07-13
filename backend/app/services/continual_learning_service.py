import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app.core_config import Settings, get_settings
from app.services.ruflo_service import RufloService


class ContinualLearningError(ValueError):
    pass


class ContinualLearningService:
    SECRET_PATTERNS = (
        (re.compile(r"(?i)\b(api[_ -]?key|token|senha|password|secret)\b\s*[:=]\s*\S+"), r"\1=[REDACTED]"),
        (re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----.*?-----END [A-Z ]+PRIVATE KEY-----", re.DOTALL), "[PRIVATE_KEY_REDACTED]"),
        (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "[CPF_REDACTED]"),
        (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[EMAIL_REDACTED]"),
    )

    def __init__(
        self,
        settings: Settings | None = None,
        ruflo: RufloService | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.ruflo = ruflo or RufloService()
        self.events_path = Path(self.settings.learning_events_path)
        self.dataset_path = Path(self.settings.local_training_dataset_path)
        self._lock = Lock()

    def retrieve(
        self,
        query: str,
        *,
        project_id: str = "synapse-ai",
        limit: int = 3,
    ) -> dict[str, Any]:
        namespace = self._namespace(project_id)
        runtime = self.ruflo.search_memory(query, namespace, limit=limit)
        examples = self._normalize_search_results(runtime.get("data", {}))
        return {
            "namespace": namespace,
            "available": bool(runtime.get("available")),
            "examples": examples[:limit],
            "runtime": runtime,
        }

    def capture_execution(
        self,
        *,
        execution_id: str,
        project_id: str,
        prompt: str,
        response: str,
        provider: str,
        model: str,
        fleet: str,
        agents: list[str],
        quality_passed: bool,
    ) -> dict[str, Any]:
        sanitized_prompt = self.sanitize(prompt)
        sanitized_response = self.sanitize(response)
        event = {
            "event_id": str(uuid.uuid4()),
            "execution_id": execution_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "project_id": project_id,
            "scope": "project",
            "status": "approved_for_retrieval" if quality_passed else "rejected_quality",
            "approved_for_training": False,
            "prompt": sanitized_prompt,
            "response": sanitized_response,
            "provider": provider,
            "model": model,
            "fleet": fleet,
            "agents": agents,
            "quality_passed": quality_passed,
        }
        self._append_jsonl(self.events_path, event)

        memory = {"available": False, "reason": "quality_not_approved"}
        if quality_passed:
            memory = self.ruflo.store_memory(
                self._namespace(project_id),
                f"experience.{execution_id}",
                json.dumps(
                    {
                        "prompt": sanitized_prompt,
                        "response": sanitized_response,
                        "fleet": fleet,
                        "agents": agents,
                        "provider": provider,
                    },
                    ensure_ascii=True,
                ),
            )
        outcome = self.ruflo.record_task_outcome(
            execution_id,
            sanitized_prompt,
            agent=agents[0] if agents else "orchestration-manager",
            success=quality_passed,
            quality=1.0 if quality_passed else 0.0,
        )
        return {"event": event, "memory": memory, "outcome": outcome}

    def apply_feedback(
        self,
        *,
        execution_id: str,
        project_id: str,
        approved: bool,
        score: float,
        notes: str,
        scope: str,
        approver: str,
        global_promotion_authorized: bool = False,
    ) -> dict[str, Any]:
        source = self._find_execution(execution_id, project_id)
        if source is None:
            raise ContinualLearningError("Learning execution not found")
        if scope == "global" and not global_promotion_authorized:
            raise ContinualLearningError("Global promotion requires an authenticated administrator")
        if approver.strip().lower() in {"", "auto", "system"}:
            raise ContinualLearningError("Feedback requires an identified authenticated approver")

        feedback = {
            "event_id": str(uuid.uuid4()),
            "event_type": "human_feedback",
            "execution_id": execution_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "project_id": project_id,
            "scope": scope,
            "approved": approved,
            "score": score,
            "notes": self.sanitize(notes),
            "approver": approver,
        }
        self._append_jsonl(self.events_path, feedback)

        training_written = False
        if approved and score >= 0.8:
            training_example = {
                "messages": [
                    {"role": "system", "content": "Voce e o especialista local governado do Synapse."},
                    {"role": "user", "content": source["prompt"]},
                    {"role": "assistant", "content": source["response"]},
                ],
                "metadata": {
                    "execution_id": execution_id,
                    "project_id": project_id,
                    "scope": scope,
                    "score": score,
                    "approver": approver,
                    "provider": source["provider"],
                    "model": source["model"],
                },
            }
            self._append_jsonl(self.dataset_path, training_example)
            training_written = True

        return {
            "feedback": feedback,
            "approved_for_training": training_written,
            "dataset_path": str(self.dataset_path),
        }

    def summary(self) -> dict[str, Any]:
        events = self._read_jsonl(self.events_path)
        dataset = self._read_jsonl(self.dataset_path)
        executions = [item for item in events if "prompt" in item and "response" in item]
        feedback = [item for item in events if item.get("event_type") == "human_feedback"]
        return {
            "execution_experiences": len(executions),
            "retrieval_approved": sum(item.get("status") == "approved_for_retrieval" for item in executions),
            "human_feedback_events": len(feedback),
            "training_examples": len(dataset),
            "training_requires_explicit_feedback": True,
            "automatic_weight_updates": False,
            "events_path": str(self.events_path),
            "dataset_path": str(self.dataset_path),
        }

    def context_block(self, retrieval: dict[str, Any]) -> str:
        examples = retrieval.get("examples", [])
        if not examples:
            return ""
        lines = [
            "Experiencias anteriores relevantes do Synapse. Use como referencia, nao como verdade absoluta:"
        ]
        for index, item in enumerate(examples, start=1):
            lines.append(f"{index}. {json.dumps(item, ensure_ascii=False)[:800]}")
        return "\n".join(lines)

    @classmethod
    def sanitize(cls, value: str) -> str:
        sanitized = value
        for pattern, replacement in cls.SECRET_PATTERNS:
            sanitized = pattern.sub(replacement, sanitized)
        return sanitized[:24000]

    @staticmethod
    def _namespace(project_id: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]", "-", project_id).strip(".-") or "synapse-ai"
        return f"synapse-learning-{safe}"

    def _find_execution(self, execution_id: str, project_id: str) -> dict[str, Any] | None:
        for event in reversed(self._read_jsonl(self.events_path)):
            if event.get("execution_id") == execution_id and event.get("project_id") == project_id:
                if "prompt" in event and "response" in event:
                    return event
        return None

    @staticmethod
    def _normalize_search_results(data: Any) -> list[dict[str, Any]]:
        candidates = []
        if isinstance(data, dict):
            for key in ("results", "matches", "memories"):
                if isinstance(data.get(key), list):
                    candidates = data[key]
                    break
        if not candidates and isinstance(data, list):
            candidates = data
        normalized = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            value = item.get("value") or item.get("content") or item.get("text")
            if isinstance(value, str):
                try:
                    parsed = json.loads(value)
                    normalized.append(parsed if isinstance(parsed, dict) else {"value": parsed})
                except json.JSONDecodeError:
                    normalized.append({"value": value})
            else:
                normalized.append(item)
        return normalized

    def _append_jsonl(self, path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            with path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(value, ensure_ascii=False) + "\n")

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        with self._lock:
            lines = path.read_text(encoding="utf-8").splitlines()
        result = []
        for line in lines:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                result.append(value)
        return result

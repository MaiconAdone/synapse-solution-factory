import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app.core_config import Settings, get_settings
from app.services.hybrid_llm_router import HybridLlmRouter, HybridLlmRouterError
from app.services.llm_routing_metrics import LlmRoutingMetrics


class LlmGatewayError(RuntimeError):
    pass


class LlmGateway:
    """Central production boundary for all LLM generation.

    The gateway keeps low-level providers behind one policy surface: routing,
    token limits, cloud budget, cache, fallback telemetry and audit records.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        router: HybridLlmRouter | None = None,
        metrics: LlmRoutingMetrics | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.router = router or HybridLlmRouter(self.settings)
        self.metrics = metrics or self.router.metrics
        self.cache_path = Path(self.settings.llm_gateway_cache_path)
        self.audit_path = Path(self.settings.llm_gateway_audit_path)
        self._cache_lock = Lock()
        self._audit_lock = Lock()

    def close(self) -> None:
        self.router.close()

    def decide(
        self,
        prompt: str,
        *,
        allow_cloud: bool = False,
        force_provider: str | None = None,
        local_model_profile: str = "auto",
        human_approved: bool = False,
    ) -> dict[str, Any]:
        self._validate_input_budget(prompt)
        if allow_cloud:
            self._require_cloud_approval(allow_cloud=allow_cloud, human_approved=human_approved)
        decision = self.router.decide(
            prompt,
            allow_cloud=allow_cloud,
            force_provider=force_provider,
            local_model_profile=local_model_profile,
        )
        if decision["provider"] == "openai":
            self._enforce_cloud_budget(prompt)
        return {
            **decision,
            "gateway": "llm_gateway",
            "policy": {
                "single_entrypoint": True,
                "cache_enabled": True,
                "cloud_requires_human_approval": True,
                "max_input_tokens": self.settings.llm_gateway_max_input_tokens,
                "daily_cloud_token_budget": self.settings.llm_gateway_daily_cloud_token_budget,
            },
        }

    def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        allow_cloud: bool = False,
        force_provider: str | None = None,
        local_model_profile: str = "auto",
        local_model: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        min_response_chars: int = 40,
        human_approved: bool = False,
        project_id: str = "synapse-ai",
        agent_id: str = "unassigned",
        tool_name: str = "llm.generate",
        request_id: str | None = None,
    ) -> dict[str, Any]:
        request_id = request_id or str(uuid.uuid4())
        profile = self._profile_for_local_model(local_model, local_model_profile)
        decision = self.decide(
            prompt,
            allow_cloud=allow_cloud,
            force_provider=force_provider,
            local_model_profile=profile,
            human_approved=human_approved,
        )
        cache_key = self._cache_key(
            prompt=prompt,
            system=system,
            decision=decision,
            json_mode=json_mode,
            temperature=temperature,
        )
        cached = self._read_cache(cache_key) if self._cache_allowed(decision, temperature) else None
        if cached:
            result = {
                **cached["result"],
                "cache_hit": True,
                "gateway": {
                    "request_id": request_id,
                    "project_id": project_id,
                    "agent_id": agent_id,
                    "tool_name": tool_name,
                    "cache_key": cache_key,
                    "policy_enforced": True,
                },
            }
            self._record_gateway_event(
                request_id=request_id,
                project_id=project_id,
                agent_id=agent_id,
                tool_name=tool_name,
                decision=decision,
                result=result,
                cache_hit=True,
                elapsed_ms=0.0,
            )
            return result

        started_at = time.perf_counter()
        try:
            result = self.router.generate(
                prompt,
                system=system,
                allow_cloud=allow_cloud,
                force_provider=force_provider,
                local_model_profile=profile,
                json_mode=json_mode,
                temperature=temperature,
                min_response_chars=min_response_chars,
            )
        except HybridLlmRouterError as error:
            self._record_audit(
                {
                    "request_id": request_id,
                    "timestamp": self._now(),
                    "project_id": project_id,
                    "agent_id": agent_id,
                    "tool_name": tool_name,
                    "status": "error",
                    "error": str(error),
                    "decision": decision,
                }
            )
            raise LlmGatewayError(str(error)) from error

        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        result = {
            **result,
            "cache_hit": False,
            "gateway": {
                "request_id": request_id,
                "project_id": project_id,
                "agent_id": agent_id,
                "tool_name": tool_name,
                "cache_key": cache_key,
                "policy_enforced": True,
            },
        }
        if self._cache_allowed(decision, temperature) and result.get("quality", {}).get("passed", True):
            self._write_cache(cache_key, result)
        self._record_gateway_event(
            request_id=request_id,
            project_id=project_id,
            agent_id=agent_id,
            tool_name=tool_name,
            decision=decision,
            result=result,
            cache_hit=False,
            elapsed_ms=elapsed_ms,
        )
        return result

    def _profile_for_local_model(self, local_model: str | None, local_model_profile: str) -> str:
        if not local_model:
            return local_model_profile
        profiles = {
            self.settings.ollama_model: "fast",
            self.settings.ollama_general_model: "general",
            self.settings.ollama_balanced_model: "balanced",
            self.settings.ollama_code_review_model: "code_review",
            self.settings.ollama_code_strong_model: "code_strong",
            self.settings.ollama_planning_strong_model: "planning_strong",
            self.settings.ollama_reasoning_strong_model: "reasoning_strong",
            self.settings.ollama_code_critical_model: "code_critical",
            self.settings.ollama_large_model: "large",
            self.settings.ollama_embedding_model: "embeddings",
        }
        try:
            return profiles[local_model]
        except KeyError as error:
            allowed = sorted(set(profiles))
            raise LlmGatewayError(f"local_model must be one of {allowed}") from error

    def _validate_input_budget(self, prompt: str) -> None:
        estimated = self._estimate_tokens(prompt)
        if estimated > self.settings.llm_gateway_max_input_tokens:
            raise LlmGatewayError(
                f"Input exceeds gateway token budget: {estimated}>{self.settings.llm_gateway_max_input_tokens}"
            )

    def _require_cloud_approval(self, *, allow_cloud: bool, human_approved: bool) -> None:
        if not allow_cloud or not human_approved:
            raise LlmGatewayError("Cloud LLM usage requires explicit allow_cloud and human_approved")

    def _enforce_cloud_budget(self, prompt: str) -> None:
        estimated = self._estimate_tokens(prompt) + self.settings.ollama_max_output_tokens
        if estimated > self.settings.llm_gateway_per_request_cloud_token_budget:
            raise LlmGatewayError("Request exceeds per-request cloud token budget")
        used = self.metrics.summary().get("cloud_tokens", 0)
        if int(used) + estimated > self.settings.llm_gateway_daily_cloud_token_budget:
            raise LlmGatewayError("Daily cloud token budget exceeded")

    def _cache_allowed(self, decision: dict[str, Any], temperature: float) -> bool:
        return (
            decision["provider"] == "ollama"
            and not decision["sensitive"]
            and temperature == 0.0
        )

    def _cache_key(
        self,
        *,
        prompt: str,
        system: str | None,
        decision: dict[str, Any],
        json_mode: bool,
        temperature: float,
    ) -> str:
        payload = {
            "prompt": prompt,
            "system": system or "",
            "provider": decision["provider"],
            "model": decision.get("local_model"),
            "profile": decision.get("local_model_profile"),
            "json_mode": json_mode,
            "temperature": temperature,
        }
        data = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(data.encode("utf-8")).hexdigest()

    def _read_cache(self, key: str) -> dict[str, Any] | None:
        if not self.cache_path.exists():
            return None
        with self._cache_lock:
            for line in self.cache_path.read_text(encoding="utf-8").splitlines():
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if item.get("key") == key:
                    return item
        return None

    def _write_cache(self, key: str, result: dict[str, Any]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_result = {
            item: result[item]
            for item in (
                "provider",
                "model",
                "response",
                "done",
                "prompt_tokens",
                "completion_tokens",
                "total_tokens",
                "fallback_used",
                "local_fallback_used",
                "quality",
                "latency_ms",
            )
            if item in result
        }
        line = json.dumps(
            {"key": key, "stored_at": self._now(), "result": cache_result},
            ensure_ascii=True,
            separators=(",", ":"),
        )
        with self._cache_lock:
            with self.cache_path.open("a", encoding="utf-8") as stream:
                stream.write(f"{line}\n")

    def _record_gateway_event(
        self,
        *,
        request_id: str,
        project_id: str,
        agent_id: str,
        tool_name: str,
        decision: dict[str, Any],
        result: dict[str, Any],
        cache_hit: bool,
        elapsed_ms: float,
    ) -> None:
        event = {
            "timestamp": self._now(),
            "provider": result.get("provider"),
            "model": result.get("model"),
            "latency_ms": elapsed_ms or result.get("latency_ms", 0),
            "prompt_tokens": result.get("prompt_tokens", 0),
            "completion_tokens": result.get("completion_tokens", 0),
            "total_tokens": result.get("total_tokens", 0),
            "fallback_used": result.get("fallback_used", False),
            "local_fallback_used": result.get("local_fallback_used", False),
            "quality_passed": result.get("quality", {}).get("passed", True),
            "complex": decision.get("complex", False),
            "sensitive": decision.get("sensitive", False),
            "cache_hit": cache_hit,
            "gateway_request_id": request_id,
            "project_id": project_id,
            "agent_id": agent_id,
            "tool_name": tool_name,
        }
        if cache_hit:
            self.metrics.record(event)
        self._record_audit(
            {
                **event,
                "status": "completed",
                "routing_reason": decision.get("reason"),
                "local_model_profile": decision.get("local_model_profile"),
                "cloud_allowed": decision.get("cloud_allowed"),
                "prompt_hash": self._hash_text(str(result.get("gateway", {}).get("cache_key", ""))),
            }
        )

    def _record_audit(self, event: dict[str, Any]) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, ensure_ascii=True, separators=(",", ":"))
        with self._audit_lock:
            with self.audit_path.open("a", encoding="utf-8") as stream:
                stream.write(f"{line}\n")

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text or "") / 4))

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any

from app.core_config import Settings, get_settings
from app.services.llm_routing_metrics import LlmRoutingMetrics
from app.services.openai_service import OpenAiService, OpenAiServiceError


class HybridLlmRouterError(RuntimeError):
    pass


class HybridLlmRouter:
    """Routes every generation request to the cloud provider.

    Requests containing sensitive content are refused rather than sent to a
    cloud provider, since no local provider is available as a fallback.
    """

    COMPLEX_TERMS = (
        "arquitetura critica",
        "auditoria",
        "compliance",
        "lgpd",
        "producao",
        "seguranca",
        "ameaça",
        "threat model",
        "multiagente",
        "multi-agent",
        "workflow complexo",
        "decisao final",
        "migracao",
    )
    SENSITIVE_PATTERNS = (
        r"\b(api[_ -]?key|token|senha|password|secret|chave privada)\b",
        r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b",
        r"-----BEGIN [A-Z ]+PRIVATE KEY-----",
    )

    def __init__(
        self,
        settings: Settings | None = None,
        openai: OpenAiService | None = None,
        metrics: LlmRoutingMetrics | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.openai = openai or OpenAiService(self.settings)
        self.metrics = metrics or LlmRoutingMetrics(self.settings.llm_routing_metrics_path)

    def close(self) -> None:
        self.openai.close()

    def decide(self, prompt: str) -> dict[str, Any]:
        normalized = self._strip_accents(prompt.lower())
        sensitive = any(
            re.search(pattern, prompt, flags=re.IGNORECASE)
            for pattern in self.SENSITIVE_PATTERNS
        )
        if sensitive:
            raise HybridLlmRouterError(
                "Sensitive content was detected and cannot be sent to a cloud provider; "
                "no local provider is configured to handle it instead"
            )
        if not self.openai.configured:
            raise HybridLlmRouterError("OPENAI_API_KEY is not configured")

        complex_reasons = [term for term in self.COMPLEX_TERMS if term in normalized]
        long_context = len(prompt) > 6000 or len(prompt.split()) > 900
        complex_request = bool(complex_reasons or long_context)

        return {
            "provider": "openai",
            "reason": "cloud is the only configured provider",
            "sensitive": False,
            "complex": complex_request,
            "complexity_signals": complex_reasons + (["long_context"] if long_context else []),
            "reasoning_effort": "medium" if complex_request else "low",
        }

    def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        min_response_chars: int = 40,
    ) -> dict[str, Any]:
        decision = self.decide(prompt)
        started_at = time.perf_counter()
        retried = False

        try:
            result = self.openai.generate(
                prompt,
                system=system,
                reasoning_effort=decision["reasoning_effort"],
            )
            quality = self._validate_quality(
                str(result.get("response", "")),
                json_mode=json_mode,
                min_response_chars=min_response_chars,
            )
            if not quality["passed"] and decision["reasoning_effort"] != "high":
                retried = True
                result = self.openai.generate(prompt, system=system, reasoning_effort="high")
                quality = self._validate_quality(
                    str(result.get("response", "")),
                    json_mode=json_mode,
                    min_response_chars=min_response_chars,
                )
        except OpenAiServiceError as error:
            raise HybridLlmRouterError(str(error)) from error

        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": result["provider"],
            "model": result["model"],
            "latency_ms": elapsed_ms,
            "prompt_tokens": result.get("prompt_tokens", 0),
            "completion_tokens": result.get("completion_tokens", 0),
            "total_tokens": result.get(
                "total_tokens",
                int(result.get("prompt_tokens", 0)) + int(result.get("completion_tokens", 0)),
            ),
            "retried": retried,
            "quality_passed": quality["passed"],
            "complex": decision["complex"],
            "sensitive": decision["sensitive"],
        }
        self.metrics.record(event)
        return {
            **result,
            "routing": decision,
            "retried": retried,
            "quality": quality,
            "latency_ms": elapsed_ms,
        }

    @staticmethod
    def _validate_quality(
        response: str,
        *,
        json_mode: bool,
        min_response_chars: int,
    ) -> dict[str, Any]:
        reasons = []
        if len(response.strip()) < min_response_chars:
            reasons.append("response_too_short")
        if json_mode:
            try:
                json.loads(response)
            except json.JSONDecodeError:
                reasons.append("invalid_json")
        lowered = response.lower()
        if any(marker in lowered for marker in ("não posso ajudar", "i cannot help", "erro interno")):
            reasons.append("refusal_or_error_marker")
        return {"passed": not reasons, "reasons": reasons}

    @staticmethod
    def _strip_accents(value: str) -> str:
        return "".join(
            char
            for char in unicodedata.normalize("NFD", value)
            if unicodedata.category(char) != "Mn"
        )

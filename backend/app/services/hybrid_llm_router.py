import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any

from app.core_config import Settings, get_settings
from app.services.llm_routing_metrics import LlmRoutingMetrics
from app.services.ollama_service import OllamaService, OllamaServiceError
from app.services.openai_service import OpenAiService, OpenAiServiceError


class HybridLlmRouterError(RuntimeError):
    pass


class HybridLlmRouter:
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
    CODE_REVIEW_TERMS = (
        "code review",
        "revisao de codigo",
        "revisão de código",
        "debug",
        "bug",
        "stack trace",
        "refator",
        "vulnerabilidade",
        "analisar codigo",
        "analisar código",
    )

    GENERAL_TERMS = (
        "explique",
        "documente",
        "documentacao",
        "analise",
        "responda",
    )
    CODE_STRONG_TERMS = (
        "implemente",
        "implementacao",
        "endpoint",
        "script",
        "pipeline",
        "integracao",
    )
    PLANNING_STRONG_TERMS = (
        "arquitetura",
        "governanca",
        "agentic",
        "agente",
        "roadmap",
        "estrategia",
    )
    REASONING_STRONG_TERMS = (
        "raciocinio",
        "causa raiz",
        "root cause",
        "validacao logica",
        "decisao final",
    )
    CODE_CRITICAL_TERMS = (
        "codigo critico",
        "refatoracao grande",
        "revisao final",
        "antes de producao",
    )

    def _model_for_local_profile(self, profile: str) -> str:
        return {
            "fast": self.settings.ollama_model,
            "general": self.settings.ollama_general_model,
            "balanced": self.settings.ollama_balanced_model,
            "code_review": self.settings.ollama_code_review_model,
            "code_strong": self.settings.ollama_code_strong_model,
            "planning_strong": self.settings.ollama_planning_strong_model,
            "reasoning_strong": self.settings.ollama_reasoning_strong_model,
            "code_critical": self.settings.ollama_code_critical_model,
            "large": self.settings.ollama_large_model,
            "embeddings": self.settings.ollama_embedding_model,
        }[profile]

    def __init__(
        self,
        settings: Settings | None = None,
        ollama: OllamaService | None = None,
        openai: OpenAiService | None = None,
        metrics: LlmRoutingMetrics | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.ollama = ollama or OllamaService(self.settings)
        self.openai = openai or OpenAiService(self.settings)
        self.metrics = metrics or LlmRoutingMetrics(self.settings.llm_routing_metrics_path)

    def close(self) -> None:
        self.ollama.close()
        self.openai.close()

    def decide(
        self,
        prompt: str,
        *,
        allow_cloud: bool = False,
        force_provider: str | None = None,
        local_model_profile: str = "auto",
    ) -> dict[str, Any]:
        normalized = self._strip_accents(prompt.lower())
        sensitive = any(
            re.search(pattern, prompt, flags=re.IGNORECASE)
            for pattern in self.SENSITIVE_PATTERNS
        )
        complex_reasons = [term for term in self.COMPLEX_TERMS if term in normalized]
        long_context = len(prompt) > 6000 or len(prompt.split()) > 900
        code_review = any(term in normalized for term in self.CODE_REVIEW_TERMS)
        general = any(term in normalized for term in self.GENERAL_TERMS)
        code_strong = any(term in normalized for term in self.CODE_STRONG_TERMS)
        planning_strong = any(term in normalized for term in self.PLANNING_STRONG_TERMS)
        reasoning_strong = any(term in normalized for term in self.REASONING_STRONG_TERMS)
        code_critical = any(term in normalized for term in self.CODE_CRITICAL_TERMS)

        generation_profiles = set(OllamaService.MODEL_PROFILES) - {"embeddings"}
        if local_model_profile not in {"auto", *generation_profiles}:
            raise HybridLlmRouterError(
                "local_model_profile must be auto or a supported Ollama generation profile"
            )

        if force_provider:
            requested = force_provider.strip().lower()
            if requested not in {"ollama", "openai"}:
                raise HybridLlmRouterError("force_provider must be ollama or openai")
            if requested == "openai" and sensitive:
                raise HybridLlmRouterError("Sensitive content cannot be routed to a cloud provider")
            selected = requested
            reason = "provider explicitly selected"
        elif sensitive:
            selected = "ollama"
            reason = "sensitive content is restricted to the local provider"
        elif allow_cloud and self.openai.configured and (complex_reasons or long_context):
            selected = "openai"
            reason = "complex or long-context request qualifies for the strong provider"
        else:
            selected = "ollama"
            reason = "local-first policy for low-cost processing"

        if local_model_profile != "auto":
            selected_local_profile = local_model_profile
        elif code_critical:
            selected_local_profile = "code_critical"
        elif reasoning_strong:
            selected_local_profile = "reasoning_strong"
        elif planning_strong and (complex_reasons or long_context):
            selected_local_profile = "planning_strong"
        elif code_strong and (complex_reasons or long_context or len(prompt) > 1800):
            selected_local_profile = "code_strong"
        elif code_review:
            selected_local_profile = "code_review"
        elif not allow_cloud and (complex_reasons or long_context):
            selected_local_profile = "balanced"
        elif general:
            selected_local_profile = "general"
        else:
            selected_local_profile = "fast"

        return {
            "provider": selected,
            "reason": reason,
            "sensitive": sensitive,
            "complex": bool(complex_reasons or long_context),
            "complexity_signals": complex_reasons + (["long_context"] if long_context else []),
            "cloud_allowed": allow_cloud,
            "cloud_configured": self.openai.configured,
            "local_model_profile": selected_local_profile,
            "local_model": self._model_for_local_profile(selected_local_profile),
        }

    def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        allow_cloud: bool = False,
        force_provider: str | None = None,
        local_model_profile: str = "auto",
        json_mode: bool = False,
        temperature: float = 0.0,
        min_response_chars: int = 40,
    ) -> dict[str, Any]:
        decision = self.decide(
            prompt,
            allow_cloud=allow_cloud,
            force_provider=force_provider,
            local_model_profile=local_model_profile,
        )
        if (
            json_mode
            and local_model_profile == "auto"
            and decision["local_model_profile"] == "code_review"
        ):
            decision["local_model_profile"] = "balanced"
            decision["local_model"] = self._model_for_local_profile("balanced")
            decision["reason"] += "; balanced local profile selected for structured JSON output"
        started_at = time.perf_counter()
        fallback_used = False
        local_fallback_used = False
        quality: dict[str, Any]

        try:
            if decision["provider"] == "openai":
                result = self.openai.generate(
                    prompt,
                    system=system,
                    reasoning_effort="medium" if decision["complex"] else "low",
                )
            else:
                result = self.ollama.generate(
                    prompt,
                    system=system,
                    model=decision["local_model"],
                    json_mode=json_mode,
                    temperature=temperature,
                )
                quality = self._validate_quality(
                    str(result.get("response", "")),
                    json_mode=json_mode,
                    min_response_chars=min_response_chars,
                )
                if (
                    not quality["passed"]
                    and decision["local_model_profile"] in {"fast", "general", "code_review"}
                ):
                    local_fallback_used = True
                    decision["local_model_profile"] = (
                        "code_strong"
                        if decision["local_model_profile"] == "code_review"
                        else "balanced"
                    )
                    decision["local_model"] = self._model_for_local_profile(
                        decision["local_model_profile"]
                    )
                    result = self.ollama.generate(
                        prompt,
                        system=system,
                        model=decision["local_model"],
                        json_mode=json_mode,
                        temperature=temperature,
                    )
                    quality = self._validate_quality(
                        str(result.get("response", "")),
                        json_mode=json_mode,
                        min_response_chars=min_response_chars,
                    )
                if (
                    not quality["passed"]
                    and allow_cloud
                    and not decision["sensitive"]
                    and self.openai.configured
                ):
                    fallback_used = True
                    result = self.openai.generate(
                        prompt,
                        system=system,
                        reasoning_effort="low",
                    )
        except (OllamaServiceError, OpenAiServiceError) as error:
            if (
                decision["provider"] == "ollama"
                and allow_cloud
                and not decision["sensitive"]
                and self.openai.configured
            ):
                fallback_used = True
                result = self.openai.generate(prompt, system=system, reasoning_effort="low")
            else:
                raise HybridLlmRouterError(str(error)) from error

        quality = self._validate_quality(
            str(result.get("response", "")),
            json_mode=json_mode,
            min_response_chars=min_response_chars,
        )
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
            "fallback_used": fallback_used,
            "local_fallback_used": local_fallback_used,
            "quality_passed": quality["passed"],
            "complex": decision["complex"],
            "sensitive": decision["sensitive"],
        }
        self.metrics.record(event)
        return {
            **result,
            "routing": decision,
            "fallback_used": fallback_used,
            "local_fallback_used": local_fallback_used,
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

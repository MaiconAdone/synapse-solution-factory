"""LLM gateway: the only path from solution agents to a model ("via_llm_gateway_only").

Implements the ``llm_gateway`` of config/agent_blueprint_contract.json with the
rules of config/cost_optimization_policy.json and config/model_providers.json:

1. route: task type -> tier (model_routing) -> request profile (token budget)
   -> model of the selected provider (model_tiers, env override
   ``<PROVIDER>_MODEL_<TIER>``);
2. input guard: secrets always blocked, personal data blocked for external providers;
3. prompt layout for prompt caching: stable context first as a system block with
   ``cache_control``, dynamic context and the user message after the breakpoint;
   the stable context hash is traced so silent cache invalidation is visible;
4. token budget: dynamic context is trimmed from the end (least relevant last)
   to fit the profile budget; still over budget -> blocked;
5. provider call through an ``LlmAdapter`` (Anthropic adapter included);
6. output guard (guardrails/policy.yaml);
7. trace with input/output/cache-creation/cache-read tokens, latency and
   estimated cost, and an optional capture hook for the improvement loop.

Standard library only; the Anthropic SDK is imported lazily by ``AnthropicAdapter``.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from scripts.synapse_lib.agent_harness import redact
from scripts.synapse_lib.guardrails_runtime import InputGuard, OutputGuard

TIER_TO_PROFILE = {"economy": "simple", "balanced": "standard", "strong": "enterprise"}
LOCAL_PROVIDERS = {"ollama", "local"}


class LlmGatewayError(ValueError):
    pass


@dataclass
class LlmRequest:
    task_type: str
    user_message: str
    stable_context: str = ""
    dynamic_context: list[str] = field(default_factory=list)
    agent_id: str = "unknown-agent"
    prompt_id: str = ""
    prompt_version: str = ""
    profile: str | None = None
    max_output_tokens: int | None = None
    sources: list[str] = field(default_factory=list)
    output_schema: dict[str, Any] | None = None


@dataclass
class LlmResponse:
    text: str
    model: str
    stop_reason: str = "end_turn"
    usage: dict[str, int] = field(default_factory=dict)


class LlmAdapter(Protocol):
    provider: str

    def complete(self, prompt: dict[str, Any], model: str, max_tokens: int, effort: str | None) -> LlmResponse: ...


def estimate_tokens(text: str) -> int:
    """Rough budget estimate (~4 characters per token); providers report exact usage."""
    return max(1, len(text) // 4) if text else 0


def _load(root: Path, relative: str) -> dict[str, Any]:
    path = root / relative
    if not path.exists():
        path = Path(__file__).resolve().parents[2] / relative
    return json.loads(path.read_text(encoding="utf-8-sig"))


class ModelRouter:
    def __init__(self, root: Path | None = None) -> None:
        base = root or Path(__file__).resolve().parents[2]
        self.cost = _load(base, "config/cost_optimization_policy.json")
        self.providers = _load(base, "config/model_providers.json")

    def tier_for(self, task_type: str) -> str:
        for tier_key, tasks in self.cost.get("model_routing", {}).items():
            if task_type in tasks:
                return tier_key.replace("_tasks", "")
        return "balanced"

    def profile_for(self, tier: str, explicit: str | None = None) -> tuple[str, dict[str, Any]]:
        profiles = self.cost["request_profiles"]
        name = explicit or TIER_TO_PROFILE.get(tier, "standard")
        if name not in profiles:
            raise LlmGatewayError(f"unknown request profile {name}")
        return name, profiles[name]

    def model_for(self, provider: str, tier: str) -> str:
        override = os.getenv(f"{provider.upper()}_MODEL_{tier.upper()}")
        if override:
            return override
        tiers = self.providers.get("model_tiers", {}).get(provider, {})
        if not tiers.get(tier):
            raise LlmGatewayError(f"no {tier} model configured for provider {provider}")
        return tiers[tier]

    def route(self, provider: str, task_type: str, profile: str | None = None) -> dict[str, Any]:
        tier = self.tier_for(task_type)
        profile_name, profile_spec = self.profile_for(tier, profile)
        tier = profile_spec.get("model_tier", tier)
        effort = self.providers.get("llm_gateway", {}).get("effort_by_tier", {}).get(tier)
        return {
            "provider": provider,
            "tier": tier,
            "profile": profile_name,
            "token_budget": int(profile_spec["token_budget"]),
            "model": self.model_for(provider, tier),
            "effort": effort,
        }


def build_prompt(request: LlmRequest, dynamic: list[str]) -> dict[str, Any]:
    """Stable context first (cacheable prefix), volatile content after the breakpoint."""
    system = []
    if request.stable_context:
        system.append({"type": "text", "text": request.stable_context, "cache_control": {"type": "ephemeral"}})
    context = "\n\n".join(f"<context>\n{chunk}\n</context>" for chunk in dynamic)
    content = f"{context}\n\n{request.user_message}" if context else request.user_message
    return {"system": system, "messages": [{"role": "user", "content": content}]}


class LlmGateway:
    def __init__(
        self,
        adapters: dict[str, LlmAdapter],
        root: Path | None = None,
        provider: str | None = None,
        capture: Callable[[dict[str, Any]], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        self.router = ModelRouter(self.root)
        settings = self.router.providers.get("llm_gateway", {})
        self.settings = settings
        self.provider = provider or os.getenv(settings.get("default_provider_env", "SYNAPSE_LLM_PROVIDER")) or settings.get("default_provider", "anthropic")
        self.adapters = adapters
        sensitive = settings.get("sensitive_content", {})
        self.input_guard = InputGuard(block_pii_for_external=sensitive.get("block_pii_for_external_providers", True))
        self.output_guard = OutputGuard()
        self.capture = capture
        self.clock = clock
        self.trace: list[dict[str, Any]] = []

    def complete(self, request: LlmRequest) -> dict[str, Any]:
        request_id = uuid.uuid4().hex
        route = self.router.route(self.provider, request.task_type, request.profile)
        record: dict[str, Any] = {
            "request_id": request_id,
            "agent_id": request.agent_id,
            "prompt_id": request.prompt_id,
            "prompt_version": request.prompt_version,
            **{key: route[key] for key in ("provider", "model", "tier", "profile")},
            "stable_context_hash": hashlib.sha256(request.stable_context.encode("utf-8")).hexdigest()[:16],
        }

        external = self.provider not in LOCAL_PROVIDERS
        screened = self.input_guard.check(
            "\n".join([request.stable_context, *request.dynamic_context, request.user_message]), external_provider=external
        )
        if not screened.passed:
            return self._finish(record, "blocked_input", {"safety_result": screened.as_dict()})

        max_output = int(request.max_output_tokens or min(1024, route["token_budget"] // 2))
        dynamic = list(request.dynamic_context)
        trimmed = 0
        while dynamic and self._dynamic_tokens(request, dynamic) + max_output > route["token_budget"]:
            dynamic.pop()
            trimmed += 1
        if self._dynamic_tokens(request, dynamic) + max_output > route["token_budget"]:
            return self._finish(record, "blocked_budget", {"reason": f"request exceeds {route['profile']} budget {route['token_budget']}"})

        adapter = self.adapters.get(self.provider)
        if adapter is None:
            raise LlmGatewayError(f"no adapter registered for provider {self.provider}")
        prompt = build_prompt(request, dynamic)
        started = self.clock()
        response = adapter.complete(prompt, route["model"], max_output, route["effort"])
        latency_ms = round((self.clock() - started) * 1000, 3)
        usage = {
            key: int(response.usage.get(key, 0) or 0)
            for key in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        }
        record.update(usage)
        record.update({"latency_ms": latency_ms, "estimated_cost_usd": self._cost(route["model"], usage), "context_chunks_trimmed": trimmed})

        if response.stop_reason == "refusal":
            return self._finish(record, "refused_by_model", {"text": ""})
        verdict = self.output_guard.check(
            response.text,
            schema=request.output_schema,
            sources=request.sources or None,
            grounding_texts=dynamic if request.sources else None,
        )
        outcome = {"allow": "answered", "clarify": "needs_clarification", "block": "blocked_output"}[verdict.action]
        return self._finish(record, outcome, {"text": response.text if verdict.passed else "", "safety_result": verdict.as_dict()}, response)

    def export_trace(self, path: Path | None = None) -> Path:
        target = path or self.root / self.settings.get("trace_path", "artifacts/traces/llm_gateway.jsonl")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            for event in self.trace:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        self.trace.clear()
        return target

    def _dynamic_tokens(self, request: LlmRequest, dynamic: list[str]) -> int:
        return estimate_tokens(request.user_message) + sum(estimate_tokens(chunk) for chunk in dynamic)

    def _cost(self, model: str, usage: dict[str, int]) -> float | None:
        price = self.settings.get("pricing_usd_per_million_tokens", {}).get(model)
        if not price:
            return None
        multipliers = self.settings.get("cache_pricing_multipliers", {"cache_write": 1.25, "cache_read": 0.1})
        cache_read_rate = price.get("cache_read", price["input"] * multipliers["cache_read"])
        total = (
            usage["input_tokens"] * price["input"]
            + usage["cache_creation_input_tokens"] * price["input"] * multipliers["cache_write"]
            + usage["cache_read_input_tokens"] * cache_read_rate
            + usage["output_tokens"] * price["output"]
        )
        return round(total / 1_000_000, 6)

    def _finish(
        self, record: dict[str, Any], outcome: str, extra: dict[str, Any], response: LlmResponse | None = None
    ) -> dict[str, Any]:
        record["outcome"] = outcome
        record.setdefault("safety_result", extra.get("safety_result", {"action": "allow", "passed": True, "findings": []}))
        self.trace.append(redact(dict(record)))
        result = {**record, **{key: value for key, value in extra.items() if key != "safety_result"}}
        if self.capture is not None:
            self.capture(
                {
                    "agent_id": record["agent_id"],
                    "request_id": record["request_id"],
                    "outcome": outcome,
                    "quality_passed": outcome == "answered",
                    "model": record["model"],
                    "provider": record["provider"],
                    "response_excerpt": (response.text[:500] if response else ""),
                    "findings": record["safety_result"].get("findings", []),
                }
            )
        return result


class AnthropicAdapter:
    """Messages API adapter (requires: pip install anthropic in the generated project)."""

    provider = "anthropic"

    def __init__(self, client: Any = None) -> None:
        if client is None:
            import anthropic  # noqa: PLC0415 - optional dependency of generated projects

            client = anthropic.Anthropic()
        self.client = client

    def complete(self, prompt: dict[str, Any], model: str, max_tokens: int, effort: str | None) -> LlmResponse:
        kwargs: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": prompt["messages"]}
        if prompt.get("system"):
            kwargs["system"] = prompt["system"]
        if effort:
            kwargs["output_config"] = {"effort": effort}
        message = self.client.messages.create(**kwargs)
        text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
        usage = message.usage
        return LlmResponse(
            text=text,
            model=getattr(message, "model", model),
            stop_reason=message.stop_reason or "end_turn",
            usage={
                "input_tokens": getattr(usage, "input_tokens", 0) or 0,
                "output_tokens": getattr(usage, "output_tokens", 0) or 0,
                "cache_creation_input_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
                "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
            },
        )

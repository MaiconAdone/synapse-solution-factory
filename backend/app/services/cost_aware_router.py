from typing import Any

from app.agents.required import REQUIRED_PARALLEL_AGENTS, SPECIALIST_AGENT_POOL
from app.repositories.cost_optimization_policy import load_cost_optimization_policy


class CostAwareRouter:
    def __init__(self, policy: dict[str, Any] | None = None) -> None:
        self.policy = policy or load_cost_optimization_policy()

    def route(self, request: str, universe: str = "hybrid") -> dict[str, Any]:
        normalized_universe = self._normalize_universe(universe)
        text = request.lower()
        profile_id = self._profile_for(text, normalized_universe)
        profile = self.policy["activation_profiles"][profile_id]
        active_limit = int(profile["active_agent_limit"])
        specialist_limit = int(profile["specialist_limit"])

        specialists = self._specialists_for(text, normalized_universe, specialist_limit)
        core_limit = max(1, active_limit - len(specialists))
        core_agents = self._core_agents_for(text, normalized_universe, core_limit)
        active_agents = [*core_agents, *specialists]

        return {
            "active": True,
            "profile": profile_id,
            "universe": normalized_universe,
            "agent_architecture_decision": self._agent_architecture_decision(text, profile_id),
            "max_available_agents": self.policy["ruflo"]["max_available_agents"],
            "default_active_agents": self.policy["ruflo"]["default_active_agents"],
            "active_agent_count": len(active_agents),
            "active_agent_limit": active_limit,
            "specialist_limit": specialist_limit,
            "core_agents": core_agents,
            "specialist_agents": specialists,
            "all_60_agents_active": len(active_agents) == self.policy["ruflo"]["max_available_agents"],
            "token_budget": profile["token_budget"],
            "model_tier": profile["model_tier"],
            "rag_mode": profile["rag_mode"],
            "token_controls": self.policy["token_controls"],
            "model_routing": self.policy["model_routing"],
            "rag_cost_policy": self.policy["rag_cost_policy"],
            "reasons": self._reasons(text, profile_id, normalized_universe),
        }

    def _profile_for(self, text: str, universe: str) -> str:
        if any(term in text for term in ("todos os 60", "60 agents", "60 agentes", "extremo", "auditoria completa")):
            return "extreme"
        if any(term in text for term in ("producao", "enterprise", "lgpd", "seguranca", "compliance", "arquitetura critica")):
            return "enterprise"
        if any(term in text for term in ("rag", "mcp", "multiagente", "multi-agent", "agentic", "hibrido", "workflow complexo")):
            return "advanced"
        if universe == "ml" and any(term in text for term in ("treinar", "classificar", "prever", "baseline")):
            return "standard"
        if len(text.split()) <= 14:
            return "simple"
        return "standard"

    def _core_agents_for(self, text: str, universe: str, active_limit: int) -> list[str]:
        selected = ["orchestration-manager"]
        if universe == "chatbolt":
            selected.extend(["llm-engineering", "rag-engineering", "integration-automation"])
        selected.append("product-strategy")
        if universe in {"ml", "hybrid"} or any(term in text for term in ("dados", "dataset", "treinar", "prever")):
            selected.extend(["data-engineering", "data-science", "machine-learning"])
        if universe in {"ia", "hybrid", "chatbolt"} or any(term in text for term in ("agente", "llm", "rag", "mcp", "prompt", "chatbot", "chatbolt")):
            selected.extend(["llm-engineering", "rag-engineering", "integration-automation"])
        if any(term in text for term in ("producao", "api", "frontend", "deploy", "seguranca", "teste")):
            selected.extend(["backend-engineering", "security-compliance", "testing-qa", "observability-ops"])
        selected.extend(["documentation", "testing-qa"])
        return self._dedupe_known(selected, list(REQUIRED_PARALLEL_AGENTS))[:active_limit]

    def _specialists_for(self, text: str, universe: str, specialist_limit: int) -> list[str]:
        if specialist_limit <= 0:
            return []

        selected: list[str] = []
        if any(term in text for term in ("rag", "documento", "conhecimento", "busca")):
            selected.extend(["hybrid-search-engineer", "reranking-specialist", "context-compression-specialist"])
        if any(term in text for term in ("mcp", "tool", "function", "ferramenta")):
            selected.extend(["mcp-integration-specialist", "tool-calling-engineer", "function-schema-designer"])
        if universe == "chatbolt" or any(term in text for term in ("chatbot", "chatbolt", "conversa", "assistente")):
            selected.extend(["hybrid-search-engineer", "context-compression-specialist", "policy-guardrails-engineer"])
        if any(term in text for term in ("agente", "multiagente", "crewai", "swarms")):
            selected.extend(["agent-a2a-coordinator", "crewai-architect", "swarms-architect"])
        if any(
            term in text
            for term in ("transformacao", "transformação", "processo", "roi", "produtividade", "impacto")
        ):
            selected.extend(
                ["business-value-analyst", "metrics-instrumentation", "policy-guardrails-engineer"]
            )
        if any(term in text for term in ("custo", "token", "baixo custo", "barato")):
            cost_specialists = ["cost-optimizer", "token-budget-analyst", "latency-optimizer"]
            selected = (
                [selected[0], *cost_specialists, *selected[1:]]
                if selected
                else cost_specialists
            )
        if universe in {"ml", "hybrid"}:
            selected.extend(["feature-engineering-specialist", "model-evaluation-specialist"])
        return self._dedupe_known(selected, list(SPECIALIST_AGENT_POOL))[:specialist_limit]

    def _reasons(self, text: str, profile_id: str, universe: str) -> list[str]:
        reasons = [
            f"profile={profile_id}",
            f"universe={universe}",
            "60 agents remain available, but activation is gated by complexity and token budget.",
        ]
        if "custo" in text or "token" in text:
            reasons.append("cost and token terms detected, so cost specialists are prioritized.")
        return reasons

    def _agent_architecture_decision(self, text: str, profile_id: str) -> dict[str, str]:
        multi_keywords = ("rag", "mcp", "multiagente", "multi-agent", "seguranca", "compliance", "producao", "workflow")
        if profile_id in {"advanced", "enterprise", "extreme"} or any(term in text for term in multi_keywords):
            mode = "fleet" if profile_id in {"enterprise", "extreme"} else "multiagent"
            reason = "multiple domains, governed tools, RAG/MCP, or production quality gates are likely needed"
        else:
            mode = "single_agent"
            reason = "low-risk request should start with one agent and escalate only if validation fails"
        return {"mode": mode, "reason": reason}

    def _normalize_universe(self, value: str) -> str:
        normalized = value.strip().lower()
        if normalized in {"ia", "ai", "agents"}:
            return "ia"
        if normalized in {"chatbolt", "chat-bolt", "chat-bolt-system", "enterprise-chatbolt-agentic-system"}:
            return "chatbolt"
        if normalized in {"ml"}:
            return "ml"
        return "hybrid"

    def _dedupe_known(self, values: list[str], known: list[str]) -> list[str]:
        seen = set()
        result = []
        known_set = set(known)
        for value in values:
            if value in known_set and value not in seen:
                result.append(value)
                seen.add(value)
        return result

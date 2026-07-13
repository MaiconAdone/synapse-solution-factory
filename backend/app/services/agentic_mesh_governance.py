from typing import Any

from app.agents.catalog import AGENT_CATALOG
from app.repositories.agentic_mesh import load_agent_fleets, load_agent_trust_framework


class AgenticMeshGovernanceService:
    def __init__(
        self,
        trust_framework: dict[str, Any] | None = None,
        fleets: dict[str, Any] | None = None,
    ) -> None:
        self.trust_framework = trust_framework or load_agent_trust_framework()
        self.fleets = fleets or load_agent_fleets()

    def summary(self) -> dict[str, Any]:
        validation = self.validate()
        return {
            "enabled": validation["valid"],
            "trust_layers": len(self.trust_framework["layers"]),
            "fleets": len(self.fleets["fleets"]),
            "default_agent_certification": self.trust_framework["default_agent_certification"],
            "default_fleet_certification": self.trust_framework["default_fleet_certification"],
            "human_approval_required_for_all_60_agents": self.fleets["fleet_defaults"]["human_approval_required_for_all_60_agents"],
            "validation": validation,
        }

    def list_fleets(self, universe: str | None = None) -> list[dict[str, Any]]:
        fleets = list(self.fleets["fleets"])
        if universe:
            normalized = self._normalize_universe(universe)
            fleets = [fleet for fleet in fleets if normalized in fleet["universe"]]
        return fleets

    def trust(self) -> dict[str, Any]:
        return self.trust_framework

    def validate(self) -> dict[str, Any]:
        agent_ids = {agent["id"] for agent in AGENT_CATALOG}
        layer_ids = [layer["id"] for layer in self.trust_framework["layers"]]
        fleet_ids = [fleet["id"] for fleet in self.fleets["fleets"]]
        missing_agents: dict[str, list[str]] = {}

        for fleet in self.fleets["fleets"]:
            referenced = [fleet["lead_agent"], *fleet["core_agents"], *fleet["specialist_agents"]]
            missing = sorted({agent for agent in referenced if agent not in agent_ids})
            if missing:
                missing_agents[fleet["id"]] = missing

        required_layers = {
            "identity_authentication",
            "authorization_tools",
            "purpose_policy",
            "planning_explainability",
            "observability_sre",
            "certification_compliance",
            "lifecycle_governance",
        }
        valid = (
            len(layer_ids) == 7
            and required_layers.issubset(set(layer_ids))
            and len(fleet_ids) >= 6
            and not missing_agents
            and bool(self.fleets["fleet_defaults"]["human_approval_required_for_all_60_agents"])
        )
        return {
            "valid": valid,
            "trust_layer_ids": layer_ids,
            "fleet_ids": fleet_ids,
            "missing_agents_by_fleet": missing_agents,
        }

    def fleet_for_request(self, request: str, universe: str = "hybrid") -> dict[str, Any]:
        text = request.lower()
        normalized = self._normalize_universe(universe)
        candidates = self.list_fleets(normalized)
        scores = []
        for fleet in candidates:
            score = 0
            if any(
                term in text
                for term in (
                    "transformacao empresarial",
                    "transformação empresarial",
                    "redesenho de processo",
                    "processo empresarial",
                    "impacto de negocio",
                    "impacto de negócio",
                    "roi",
                    "produtividade",
                )
            ) and fleet["id"] == "business_transformation_fleet":
                score += 6
            if "rag" in text and fleet["id"] == "rag_fleet":
                score += 4
            if any(term in text for term in ("mcp", "tool", "function")) and fleet["id"] == "mcp_fleet":
                score += 4
            if any(term in text for term in ("chatbot", "chatbolt", "conversa", "assistente")) and fleet["id"] == "rag_fleet":
                score += 5
            if any(term in text for term in ("custo", "token", "cache", "latencia")) and fleet["id"] == "cost_optimization_fleet":
                score += 4
            if any(term in text for term in ("seguranca", "lgpd", "compliance", "trust")) and fleet["id"] == "security_fleet":
                score += 4
            if any(term in text for term in ("ml", "modelo", "treinar", "prever")) and fleet["id"] == "ml_fleet":
                score += 4
            if any(term in text for term in ("criar projeto", "novo projeto", "factory")) and fleet["id"] == "project_factory_fleet":
                score += 4
            score += 1 if fleet["id"] == "project_factory_fleet" else 0
            scores.append((score, fleet))
        scores.sort(key=lambda item: item[0], reverse=True)
        selected = scores[0][1] if scores else self.fleets["fleets"][0]
        return {
            "selected_fleet": selected,
            "trust_framework": "config/agent_trust_framework.json",
            "requires_human_approval_for_all_60_agents": True,
            "candidate_fleet_ids": [fleet["id"] for _, fleet in scores],
        }

    @staticmethod
    def compose_agents(
        fleet: dict[str, Any],
        cost_route: dict[str, Any],
    ) -> list[str]:
        active_limit = max(1, int(cost_route["active_agent_limit"]))
        specialist_limit = max(0, int(cost_route["specialist_limit"]))
        fleet_core = list(dict.fromkeys([fleet["lead_agent"], *fleet["core_agents"]]))
        fleet_specialists = list(dict.fromkeys(fleet["specialist_agents"]))
        preferred = [
            *cost_route.get("core_agents", []),
            *cost_route.get("specialist_agents", []),
        ]

        ranked_core = [
            fleet["lead_agent"],
            *(agent for agent in preferred if agent in fleet_core),
            *fleet_core,
        ]
        ranked_specialists = [
            *(agent for agent in preferred if agent in fleet_specialists),
            *fleet_specialists,
        ]
        core = list(dict.fromkeys(ranked_core))
        specialists = list(dict.fromkeys(ranked_specialists))

        selected_specialist_count = min(
            specialist_limit,
            len(specialists),
            max(0, active_limit - 1),
        )
        selected_core_count = max(1, active_limit - selected_specialist_count)
        selected = [
            *core[:selected_core_count],
            *specialists[:selected_specialist_count],
        ]
        return list(dict.fromkeys(selected))[:active_limit]

    def _normalize_universe(self, universe: str) -> str:
        normalized = universe.strip().lower()
        if normalized in {"ia", "ai", "agents"}:
            return "ia"
        if normalized in {"chatbolt", "chat-bolt", "chat-bolt-system", "enterprise-chatbolt-agentic-system"}:
            return "chatbolt"
        if normalized == "ml":
            return "ml"
        return "hybrid"

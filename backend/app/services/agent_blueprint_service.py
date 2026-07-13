import re
from typing import Any

from app.repositories.agent_blueprint import load_agent_blueprint_contract, load_agent_improvement_loop
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.cost_aware_router import CostAwareRouter


class AgentBlueprintService:
    def __init__(
        self,
        contract: dict[str, Any] | None = None,
        improvement_loop: dict[str, Any] | None = None,
        cost_router: CostAwareRouter | None = None,
        mesh: AgenticMeshGovernanceService | None = None,
    ) -> None:
        self.contract = contract or load_agent_blueprint_contract()
        self.improvement_loop = improvement_loop or load_agent_improvement_loop()
        self.cost_router = cost_router or CostAwareRouter()
        self.mesh = mesh or AgenticMeshGovernanceService()

    def validate_contracts(self) -> dict[str, Any]:
        required = set(self.contract["required_fields"])
        expected_required = {
            "agent_id",
            "objective",
            "model_strategy",
            "tools",
            "memory",
            "context",
            "boundaries",
            "success_criteria",
            "fleet",
            "evals",
            "observability",
            "cost_budget",
            "risk_level",
        }
        loop_steps = set(self.improvement_loop["loop_steps"])
        valid = (
            expected_required.issubset(required)
            and "teacher_review" in self.improvement_loop
            and "store_approved_example" in loop_steps
            and "sanitize_pii_before_learning" in self.improvement_loop["privacy_controls"]
        )
        return {
            "valid": valid,
            "required_fields": list(required),
            "loop_steps": self.improvement_loop["loop_steps"],
            "learning_scopes": self.improvement_loop["learning_scopes"],
        }

    def decide_architecture(self, request: str, universe: str = "hybrid") -> dict[str, Any]:
        route = self.cost_router.route(request, universe)
        text = request.lower()
        single_signals = self.contract["architecture_decision_gate"]["single_agent_when"]
        multi_signals = self.contract["architecture_decision_gate"]["multiagent_when"]

        multi_keywords = ("rag", "mcp", "seguranca", "compliance", "fleet", "multiagente", "multi-agent", "producao", "workflow")
        if route["profile"] in {"advanced", "enterprise", "extreme"} or any(term in text for term in multi_keywords):
            mode = "fleet" if route["profile"] in {"enterprise", "extreme"} else "multiagent"
            reason = "request needs multiple domains, governed fleet, or production-grade review"
        else:
            mode = "single_agent"
            reason = "request is low-risk and can start with one agent before escalating"

        return {
            "mode": mode,
            "reason": reason,
            "single_agent_first": self.contract["architecture_decision_gate"]["single_agent_first"],
            "single_agent_when": single_signals,
            "multiagent_when": multi_signals,
            "cost_route": route,
        }

    def build_blueprint(self, request: str, universe: str = "hybrid") -> dict[str, Any]:
        architecture = self.decide_architecture(request, universe)
        fleet_route = self.mesh.fleet_for_request(request, universe)
        selected_fleet = fleet_route["selected_fleet"]
        agent_id = self._slug(request) or "Synapse-generated-agent"
        risk_level = "high" if architecture["mode"] == "fleet" else "medium" if architecture["mode"] == "multiagent" else "low"

        return {
            "agent_id": agent_id,
            "objective": request.strip(),
            "model_strategy": {
                "local_first": True,
                "local_models": self.contract["model_strategy"]["free_local_models"],
                "teacher_review_models": self.contract["model_strategy"]["teacher_review_models"],
                "escalate_to_paid_model_when": self.contract["model_strategy"]["escalate_to_paid_model_when"],
            },
            "tools": ["context_filter", "cost_aware_router", "agentic_mesh_governance"],
            "memory": "semantic",
            "context": "Use only filtered request context, selected fleet policy, trust framework, and acceptance criteria.",
            "boundaries": [
                "Do not bypass SDD gates.",
                "Do not activate all 60 agents without human approval.",
                "Do not promote private learning examples across scopes without approval.",
            ],
            "success_criteria": [
                "Blueprint validates against agent_blueprint_contract.",
                "Selected fleet is valid.",
                "Evals and observability are defined before production use.",
            ],
            "fleet": selected_fleet["id"],
            "evals": ["schema_validation", "trust_framework_validation", "teacher_review_when_needed"],
            "observability": ["active_agent_count", "token_budget", "cost_per_request", "eval_pass_rate"],
            "cost_budget": architecture["cost_route"]["token_budget"],
            "risk_level": risk_level,
            "authority_level": "advisory",
            "allowed_model_profiles": ["fast", "balanced", "code_review"],
            "escalation_rule": "Escalate to a specialist fleet, reviewer gate, or human approval when risk, tool scope, or validation failure requires it.",
            "quality_gate": "Must pass schema, trust-framework, eval, observability and human-approval gates before production use.",
            "a2a_message_contract": self.contract.get("a2a_message_contract", {}),
            "lifecycle_callbacks": self.contract.get("lifecycle_callbacks", []),
            "architecture_decision": architecture,
            "improvement_loop": {
                "enabled": True,
                "memory_targets": self.improvement_loop["memory_targets"],
                "teacher_review": self.improvement_loop["teacher_review"],
            },
        }

    def _slug(self, value: str) -> str:
        normalized = value.encode("ascii", "ignore").decode("ascii").lower()
        normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
        return f"{normalized[:48].strip('-')}-agent" if normalized else ""

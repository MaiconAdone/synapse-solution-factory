from typing import Any

from app.agents.required import REQUIRED_PARALLEL_AGENTS, SCALABLE_SWARM_AGENTS, SPECIALIST_AGENT_POOL
from app.repositories.enterprise_spec import load_enterprise_spec


class EnterpriseSpecService:
    def spec(self) -> dict[str, Any]:
        return load_enterprise_spec()

    def execution_policy(self) -> dict[str, Any]:
        return self.spec()["execution_policy"]

    def required_request_steps(self) -> list[str]:
        return list(self.execution_policy()["required_steps_per_request"])

    def sdd_gate(self) -> dict[str, Any]:
        return self.spec()["sdd"]

    def project_creation_defaults(self) -> dict[str, Any]:
        policy = self.execution_policy()
        return {
            "ruflo_required": policy["ruflo_required_for_project_creation"],
            "parallel_agent_count": policy["parallel_agent_count"],
            "max_agent_count": policy.get("max_agent_count", len(SCALABLE_SWARM_AGENTS)),
            "specialist_agent_count": len(SPECIALIST_AGENT_POOL),
            "cost_aware_orchestration_required": policy.get("cost_aware_orchestration_required", False),
            "cost_optimization_policy_path": policy.get("cost_optimization_policy_path"),
            "default_active_agent_count": policy.get("default_active_agent_count"),
            "enterprise_active_agent_count": policy.get("enterprise_active_agent_count"),
            "activate_all_60_requires_explicit_high_complexity": policy.get(
                "activate_all_60_requires_explicit_high_complexity",
                True,
            ),
            "agents": list(REQUIRED_PARALLEL_AGENTS),
            "specialist_agents": list(SPECIALIST_AGENT_POOL),
            "token_strategy": policy["token_strategy"],
            "sdd_gate": self.sdd_gate()["gate"],
        }

    def validate_runtime_alignment(self) -> dict[str, Any]:
        policy = self.execution_policy()
        expected_count = int(policy["parallel_agent_count"])
        expected_max_count = int(policy.get("max_agent_count", expected_count))
        actual_count = len(REQUIRED_PARALLEL_AGENTS)
        actual_max_count = len(SCALABLE_SWARM_AGENTS)
        return {
            "aligned": actual_count == expected_count and actual_max_count == expected_max_count,
            "expected_parallel_agents": expected_count,
            "actual_parallel_agents": actual_count,
            "expected_max_agents": expected_max_count,
            "actual_max_agents": actual_max_count,
            "specialist_agent_count": len(SPECIALIST_AGENT_POOL),
            "ruflo_required": bool(policy["ruflo_required_for_project_creation"]),
            "sdd_required": bool(policy["specification_driven_development"]),
            "cost_aware_orchestration_required": bool(policy.get("cost_aware_orchestration_required", False)),
        }

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app.agents.required import SCALABLE_SWARM_AGENTS
from app.core_config import Settings, get_settings
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.cost_aware_router import CostAwareRouter
from app.services.continual_learning_service import ContinualLearningService
from app.services.llm_gateway import LlmGateway
from app.services.ruflo_service import RufloService


class GovernedSwarmExecutionError(RuntimeError):
    pass


class GovernedSwarmExecutionService:
    def __init__(
        self,
        settings: Settings | None = None,
        governance: AgenticMeshGovernanceService | None = None,
        cost_router: CostAwareRouter | None = None,
        llm_gateway: LlmGateway | None = None,
        ruflo: RufloService | None = None,
        learning: ContinualLearningService | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.governance = governance or AgenticMeshGovernanceService()
        self.cost_router = cost_router or CostAwareRouter()
        self.llm_gateway = llm_gateway or LlmGateway(self.settings)
        self.ruflo = ruflo or RufloService()
        self.learning = learning or ContinualLearningService(self.settings, self.ruflo)
        self.audit_path = Path(self.settings.governed_swarm_audit_path)
        self._audit_lock = Lock()

    def plan(
        self,
        prompt: str,
        *,
        universe: str = "hybrid",
        allow_cloud: bool = False,
        activate_all_60: bool = False,
        human_approved: bool = False,
    ) -> dict[str, Any]:
        governance_validation = self.governance.validate()
        if not governance_validation["valid"]:
            raise GovernedSwarmExecutionError("Agentic mesh governance is invalid")
        if activate_all_60 and not human_approved:
            raise GovernedSwarmExecutionError(
                "Human approval is required before activating all 60 agents"
            )
        simple_synapse_local_only = self._is_simple_synapse_question(prompt)
        effective_allow_cloud = False if simple_synapse_local_only else allow_cloud
        if effective_allow_cloud and not human_approved:
            raise GovernedSwarmExecutionError(
                "Human approval is required before enabling a paid cloud provider"
            )

        fleet = self.governance.fleet_for_request(prompt, universe)
        cost_route = self.cost_router.route(prompt, universe)
        selected_agents = (
            list(SCALABLE_SWARM_AGENTS)
            if activate_all_60
            else self.governance.compose_agents(fleet["selected_fleet"], cost_route)
        )
        local_model_profile = self._local_model_profile(prompt, cost_route)
        model_route = self.llm_gateway.decide(
            prompt,
            allow_cloud=effective_allow_cloud,
            force_provider="ollama" if simple_synapse_local_only else None,
            local_model_profile=local_model_profile,
            human_approved=human_approved,
        )
        if (
            model_route["provider"] == "openai"
            and len(selected_agents) > 15
            and not human_approved
        ):
            raise GovernedSwarmExecutionError(
                "Human approval is required for paid cloud execution above 15 agents"
            )

        controls = {
            "least_privilege_context": True,
            "single_consolidated_model_call": True,
            "sensitive_content_local_only": True,
            "paid_scale_requires_human_approval": True,
            "cloud_is_opt_in": True,
            "all_60_requires_human_approval": True,
            "deterministic_local_generation": True,
            "simple_synapse_local_only": simple_synapse_local_only,
        }
        coordination = {
            "mode": "consolidated_governed_advisory",
            "lead_agent": fleet["selected_fleet"]["lead_agent"],
            "conflict_resolver": "orchestration-manager",
            "handoff_contract": "objective_context_limits_success_criteria",
            "a2a_message_contract": "objective_from_to_context_evidence_decision_risk_budget_status",
            "selection_order": "fleet_lead_core_then_specialists",
            "parallel_runtime": "workflow_only",
        }
        lifecycle_callbacks = self._lifecycle_callbacks(
            human_approval_required=activate_all_60 or allow_cloud,
            validation_failed=False,
        )
        fingerprint_payload = {
            "fleet": fleet["selected_fleet"]["id"],
            "agents": selected_agents,
            "model_route": model_route,
            "cost_profile": cost_route["profile"],
            "token_budget": cost_route["token_budget"],
            "controls": controls,
            "coordination": coordination,
            "lifecycle_callbacks": lifecycle_callbacks,
        }
        plan = {
            "governance_valid": True,
            "trust_framework": "config/agent_trust_framework.json",
            "selected_fleet": fleet["selected_fleet"],
            "selected_agents": selected_agents,
            "active_agent_count": len(selected_agents),
            "max_available_agents": 60,
            "activate_all_60": activate_all_60,
            "human_approved": human_approved,
            "model_route": model_route,
            "effective_allow_cloud": effective_allow_cloud,
            "cost_route": cost_route,
            "coordination": coordination,
            "controls": controls,
            "lifecycle_callbacks": lifecycle_callbacks,
        }
        plan["decision_fingerprint"] = self._fingerprint(fingerprint_payload)
        return plan

    def execute(
        self,
        prompt: str,
        *,
        universe: str = "hybrid",
        allow_cloud: bool = False,
        activate_all_60: bool = False,
        human_approved: bool = False,
        json_mode: bool = False,
        min_response_chars: int = 40,
        project_id: str = "synapse-ai",
    ) -> dict[str, Any]:
        execution_id = str(uuid.uuid4())
        started_at = time.perf_counter()
        plan = self.plan(
            prompt,
            universe=universe,
            allow_cloud=allow_cloud,
            activate_all_60=activate_all_60,
            human_approved=human_approved,
        )
        agent_ids = plan["selected_agents"]
        fleet_id = plan["selected_fleet"]["id"]
        context = (
            f"fleet={fleet_id}; agents={','.join(agent_ids)}; "
            f"governance=config/agent_trust_framework.json; "
            f"provider={plan['model_route']['provider']}"
        )
        ruflo_route = self.ruflo.route_task(prompt, context, top_k=min(5, len(agent_ids)))

        pre_memory = self.ruflo.store_memory(
            "synapse-governed-execution",
            f"execution.{execution_id}.plan",
            json.dumps(
                {
                    "fleet": fleet_id,
                    "agents": agent_ids,
                    "model_route": plan["model_route"],
                    "controls": plan["controls"],
                },
                ensure_ascii=True,
            ),
        )

        prior_learning = self.learning.retrieve(prompt, project_id=project_id, limit=1)
        learning_context = self.learning.context_block(prior_learning)
        system = self._system_prompt(plan)
        if learning_context:
            system = f"{system}\n\n{learning_context}"
        result = self.llm_gateway.generate(
            prompt,
            system=system,
            allow_cloud=bool(plan["effective_allow_cloud"]),
            force_provider=str(plan["model_route"]["provider"]),
            local_model_profile=str(plan["model_route"]["local_model_profile"]),
            json_mode=json_mode,
            min_response_chars=min_response_chars,
            human_approved=human_approved,
            project_id=project_id,
            agent_id=fleet_id,
            tool_name="execute_governed_swarm",
            request_id=execution_id,
        )
        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)

        post_memory = self.ruflo.store_memory(
            "synapse-governed-execution",
            f"execution.{execution_id}.result",
            json.dumps(
                {
                    "provider": result["provider"],
                    "model": result["model"],
                    "quality": result["quality"],
                    "fallback_used": result["fallback_used"],
                    "latency_ms": elapsed_ms,
                },
                ensure_ascii=True,
            ),
        )
        learning = self.learning.capture_execution(
            execution_id=execution_id,
            project_id=project_id,
            prompt=prompt,
            response=str(result["response"]),
            provider=str(result["provider"]),
            model=str(result["model"]),
            fleet=fleet_id,
            agents=agent_ids,
            quality_passed=bool(result["quality"]["passed"]),
        )
        audit = {
            "execution_id": execution_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "fleet": fleet_id,
            "agents": agent_ids,
            "active_agent_count": len(agent_ids),
            "provider": result["provider"],
            "model": result["model"],
            "quality_passed": result["quality"]["passed"],
            "fallback_used": result["fallback_used"],
            "latency_ms": elapsed_ms,
            "human_approved": human_approved,
            "activate_all_60": activate_all_60,
            "decision_fingerprint": plan["decision_fingerprint"],
            "coordination_mode": plan["coordination"]["mode"],
            "project_id": project_id,
            "prior_learning_count": len(prior_learning["examples"]),
            "ruflo_route_available": bool(ruflo_route.get("available")),
            "ruflo_plan_memory_available": bool(pre_memory.get("available")),
            "ruflo_result_memory_available": bool(post_memory.get("available")),
            "lifecycle_callbacks": plan["lifecycle_callbacks"],
            "a2a_message_contract": plan["coordination"]["a2a_message_contract"],
        }
        self._record_audit(audit)

        return {
            "execution_id": execution_id,
            "status": "completed",
            "plan": plan,
            "ruflo": {
                "route": ruflo_route,
                "plan_memory": pre_memory,
                "result_memory": post_memory,
            },
            "learning": {
                "prior_experiences": prior_learning,
                "capture": learning,
            },
            "result": result,
            "audit": audit,
        }

    def audit_summary(self) -> dict[str, Any]:
        events = self._read_audit()
        return {
            "executions": len(events),
            "ollama_executions": sum(item.get("provider") == "ollama" for item in events),
            "openai_executions": sum(item.get("provider") == "openai" for item in events),
            "quality_passed": sum(bool(item.get("quality_passed")) for item in events),
            "all_60_executions": sum(bool(item.get("activate_all_60")) for item in events),
            "ruflo_memory_success": sum(
                bool(item.get("ruflo_plan_memory_available"))
                and bool(item.get("ruflo_result_memory_available"))
                for item in events
            ),
        }

    @staticmethod
    def _system_prompt(plan: dict[str, Any]) -> str:
        fleet = plan["selected_fleet"]
        agents = ", ".join(plan["selected_agents"])
        return (
            "Voce executa uma tarefa governada do Synapse em nome de um fleet Ruflo. "
            f"Fleet: {fleet['id']}. Proposito: {fleet['purpose']}. "
            f"Agentes consultivos ativos: {agents}. "
            "Consolide os pontos de vista relevantes sem simular dialogos ou afirmar "
            "que foram feitas chamadas separadas. Respeite menor privilegio, privacidade, "
            "SDD, criterios testaveis e explicite riscos e validacoes."
        )

    @staticmethod
    def _local_model_profile(prompt: str, cost_route: dict[str, Any]) -> str:
        if GovernedSwarmExecutionService._is_simple_synapse_question(prompt):
            return "fast"
        normalized = prompt.lower()
        if any(
            term in normalized
            for term in (
                "code review",
                "revisao de codigo",
                "revisÃ£o de cÃ³digo",
                "debug",
                "bug",
                "vulnerabilidade",
            )
        ):
            return "code_review"
        return {
            "economy": "fast",
            "balanced": "balanced",
            "strong": "balanced",
        }.get(str(cost_route["model_tier"]), "balanced")

    @staticmethod
    def _is_simple_synapse_question(prompt: str) -> bool:
        normalized = prompt.lower()
        if "synapse" not in normalized:
            return False
        if len(prompt) > 1200 or len(prompt.split()) > 180:
            return False
        if any(
            term in normalized
            for term in (
                "implemente",
                "corrija",
                "altere",
                "modifique",
                "delete",
                "deploy",
                "producao",
                "auditoria completa",
                "todos os 60",
            )
        ):
            return False
        return any(
            term in normalized
            for term in (
                "o que",
                "explique",
                "explica",
                "como funciona",
                "resuma",
                "status",
                "pergunta",
                "duvida",
                "dúvida",
                "referente",
                "sobre",
            )
        )

    @staticmethod
    def _lifecycle_callbacks(
        *,
        human_approval_required: bool,
        validation_failed: bool,
    ) -> list[str]:
        callbacks = [
            "on_plan_created",
            "on_agent_selected",
            "on_model_routed",
            "on_tool_called",
            "on_memory_read",
        ]
        if validation_failed:
            callbacks.append("on_validation_failed")
        if human_approval_required:
            callbacks.append("on_human_approval_required")
        callbacks.append("on_execution_completed")
        return callbacks

    @staticmethod
    def _fingerprint(payload: dict[str, Any]) -> str:
        canonical = json.dumps(
            payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _record_audit(self, event: dict[str, Any]) -> None:
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        with self._audit_lock:
            with self.audit_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=True) + "\n")

    def _read_audit(self) -> list[dict[str, Any]]:
        if not self.audit_path.exists():
            return []
        events = []
        with self._audit_lock:
            lines = self.audit_path.read_text(encoding="utf-8").splitlines()
        for line in lines:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events

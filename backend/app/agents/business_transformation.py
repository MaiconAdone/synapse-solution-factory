from abc import ABC, abstractmethod
from typing import Any

from app.schemas.business_transformation import (
    AgentDecision,
    AgentTask,
    BusinessObjective,
    RiskLevel,
)
from app.tools.business_transformation import BaseTool


class BaseAgent(ABC):
    name: str
    role: str
    goal: str
    allowed_tools: set[str]
    risk_level: RiskLevel
    ruflo_agent_id: str

    def __init__(self, tools: dict[str, BaseTool]) -> None:
        self.tools = tools

    def plan(self, objective: BusinessObjective) -> list[str]:
        return [
            f"Analisar {objective.business_area}",
            f"Contribuir para {objective.expected_outcome}",
            "Registrar premissas, riscos e validacoes",
        ]

    @abstractmethod
    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        raise NotImplementedError

    def validate(self, task: AgentTask) -> bool:
        return bool(task.output)

    def log_decision(
        self,
        decision: str,
        rationale: str,
        *,
        evidence: list[str] | None = None,
        risk_level: RiskLevel | None = None,
    ) -> AgentDecision:
        return AgentDecision(
            agent=self.name,
            decision=decision,
            rationale=rationale,
            evidence=evidence or [],
            risk_level=risk_level or self.risk_level,
        )

    def _task(self, objective: str, output: dict[str, Any]) -> AgentTask:
        return AgentTask(agent=self.name, objective=objective, status="completed", output=output)


class OrchestratorAgent(BaseAgent):
    name = "OrchestratorAgent"
    role = "orchestration"
    goal = "Decompor o objetivo, coordenar agentes e consolidar o workflow."
    allowed_tools = set()
    risk_level = RiskLevel.MEDIUM
    ruflo_agent_id = "orchestration-manager"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        return self._task(
            "orquestrar transformacao",
            {"stages": context.get("stages", []), "objective_id": objective.id},
        )


class BusinessTransformationAgent(BaseAgent):
    name = "BusinessTransformationAgent"
    role = "business_transformation"
    goal = "Diagnosticar e priorizar transformacao orientada a valor."
    allowed_tools = {"kpi_tool"}
    risk_level = RiskLevel.MEDIUM
    ruflo_agent_id = "product-strategy"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        return self._task(
            "diagnosticar contexto empresarial",
            {
                "business_area": objective.business_area,
                "problem": objective.description,
                "target": objective.expected_outcome,
                "value_hypothesis": "reduzir friccao operacional e melhorar decisoes com evidencias",
            },
        )


class ProcessMappingAgent(BaseAgent):
    name = "ProcessMappingAgent"
    role = "process_mapping"
    goal = "Mapear processo atual, gargalos e pontos automatizaveis."
    allowed_tools = {"process_tool"}
    risk_level = RiskLevel.LOW
    ruflo_agent_id = "business-value-analyst"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        result = self.tools["process_tool"].execute({"objective": objective.title})
        return self._task("mapear processo", result.model_dump())


class DataAnalysisAgent(BaseAgent):
    name = "DataAnalysisAgent"
    role = "data_analysis"
    goal = "Avaliar dados e produzir evidencias interpretaveis."
    allowed_tools = {"data_tool"}
    risk_level = RiskLevel.MEDIUM
    ruflo_agent_id = "data-science"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        return self._task(
            "avaliar dados",
            {
                "available_data": objective.available_data,
                "readiness": "partial" if not objective.available_data else "declared",
                "required_checks": ["qualidade", "linhagem", "vies", "baseline"],
            },
        )


class AutomationArchitectAgent(BaseAgent):
    name = "AutomationArchitectAgent"
    role = "automation_architecture"
    goal = "Projetar automacoes, tools e integracoes MCP governadas."
    allowed_tools = {"automation_tool"}
    risk_level = RiskLevel.HIGH
    ruflo_agent_id = "integration-automation"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        return self._task(
            "desenhar automacao",
            {
                "systems": objective.involved_systems,
                "mode": "simulation_first",
                "controls": ["idempotencia", "menor privilegio", "auditoria", "compensacao"],
            },
        )


class KPIMonitorAgent(BaseAgent):
    name = "KPIMonitorAgent"
    role = "kpi_monitoring"
    goal = "Definir KPIs, baseline, metas, desvios e recomendacoes."
    allowed_tools = {"kpi_tool"}
    risk_level = RiskLevel.LOW
    ruflo_agent_id = "metrics-instrumentation"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        return self._task(
            "definir indicadores",
            {
                "kpis": [
                    "tempo de ciclo",
                    "taxa de erro ou retrabalho",
                    "custo por caso",
                    "resultado empresarial principal",
                    "taxa de adocao",
                ]
            },
        )


class RiskGovernanceAgent(BaseAgent):
    name = "RiskGovernanceAgent"
    role = "risk_governance"
    goal = "Avaliar risco, autonomia, privacidade e conformidade."
    allowed_tools = set()
    risk_level = RiskLevel.HIGH
    ruflo_agent_id = "security-compliance"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        assessment = context["risk_assessment"]
        return self._task("avaliar risco", assessment.model_dump(mode="json"))


class HumanApprovalAgent(BaseAgent):
    name = "HumanApprovalAgent"
    role = "human_approval"
    goal = "Controlar decisoes que exigem validacao humana."
    allowed_tools = set()
    risk_level = RiskLevel.CRITICAL
    ruflo_agent_id = "policy-guardrails-engineer"

    def execute(self, objective: BusinessObjective, context: dict[str, Any]) -> AgentTask:
        assessment = context["risk_assessment"]
        return self._task(
            "controlar aprovacao",
            {
                "required": assessment.human_approval_required,
                "risk_level": assessment.level.value,
            },
        )


def transformation_agents(tools: dict[str, BaseTool]) -> list[BaseAgent]:
    return [
        OrchestratorAgent(tools),
        BusinessTransformationAgent(tools),
        ProcessMappingAgent(tools),
        DataAnalysisAgent(tools),
        AutomationArchitectAgent(tools),
        KPIMonitorAgent(tools),
        RiskGovernanceAgent(tools),
        HumanApprovalAgent(tools),
    ]

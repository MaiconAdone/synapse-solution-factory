from app.agents.business_transformation import BaseAgent, transformation_agents
from app.governance.business_transformation import TransformationRiskPolicy
from app.schemas.business_transformation import (
    AgentDecision,
    AuditEvent,
    BusinessImpact,
    BusinessObjective,
    BusinessProcess,
    ExecutionPlan,
    HumanApprovalRequest,
    KPI,
    ProcessStep,
    RiskLevel,
    TransformationOpportunity,
    WorkflowState,
    WorkflowStatus,
    utc_now,
)
from app.tools.business_transformation import BaseTool, default_transformation_tools


class TransformationWorkflow:
    STAGES = [
        "intake",
        "diagnosis",
        "process_mapping",
        "opportunity_identification",
        "prioritization",
        "execution_planning",
        "risk_governance",
        "human_approval",
        "simulation",
        "impact_evaluation",
    ]

    def __init__(
        self,
        *,
        tools: dict[str, BaseTool] | None = None,
        agents: list[BaseAgent] | None = None,
        risk_policy: TransformationRiskPolicy | None = None,
    ) -> None:
        self.tools = tools or default_transformation_tools()
        self.agents = agents or transformation_agents(self.tools)
        self.risk_policy = risk_policy or TransformationRiskPolicy()

    def start(self, objective: BusinessObjective) -> WorkflowState:
        state = WorkflowState(objective=objective, status=WorkflowStatus.RUNNING)
        self._audit(state, "workflow_started", "OrchestratorAgent")

        assessment = self.risk_policy.assess(objective)
        context = {"stages": self.STAGES, "risk_assessment": assessment}
        for agent in self.agents:
            task = agent.execute(objective, context)
            if not agent.validate(task):
                raise ValueError(f"Agent output failed validation: {agent.name}")
            state.agent_tasks.append(task)
            self._audit(
                state,
                "agent_completed",
                agent.name,
                {"ruflo_agent_id": agent.ruflo_agent_id, "task_id": task.id},
            )

        state.diagnosis = self._diagnosis(objective)
        state.process_map = self._process_map(objective)
        state.opportunities = self._opportunities(objective, state.process_map, assessment.level)
        state.risk_assessment = assessment
        state.execution_plan = self._execution_plan(objective, state.opportunities, assessment.level)
        state.kpis = self._kpis(objective)
        state.decisions.extend(self._decisions(state))
        self._audit(
            state,
            "governance_classified",
            "RiskGovernanceAgent",
            {"risk_level": assessment.level.value},
        )

        if assessment.human_approval_required:
            state.status = WorkflowStatus.APPROVAL_REQUIRED
            state.approval = HumanApprovalRequest(
                workflow_id=state.workflow_id,
                requested_action="Executar simulacao do plano de transformacao empresarial",
                risk_level=assessment.level,
                rationale="A politica de autonomia exige decisao humana para este nivel de risco.",
            )
            state.next_steps = [
                "revisar plano, riscos e controles",
                "registrar aprovacao ou rejeicao humana",
            ]
            self._audit(state, "approval_requested", "HumanApprovalAgent")
            state.updated_at = utc_now()
            return state

        return self.complete(state)

    def approve(
        self,
        state: WorkflowState,
        *,
        approved: bool,
        approver: str,
        notes: str = "",
    ) -> WorkflowState:
        if state.status != WorkflowStatus.APPROVAL_REQUIRED or state.approval is None:
            raise ValueError("Workflow is not waiting for human approval")

        state.approval.status = "approved" if approved else "rejected"
        state.approval.approver = approver
        state.approval.notes = notes
        state.approval.decided_at = utc_now()
        self._audit(
            state,
            "approval_granted" if approved else "approval_rejected",
            approver,
            {"notes": notes},
        )
        if not approved:
            state.status = WorkflowStatus.REJECTED
            state.next_steps = ["revisar escopo, controles e nivel de autonomia"]
            state.updated_at = utc_now()
            return state

        state.status = WorkflowStatus.APPROVED
        return self.complete(state)

    def complete(self, state: WorkflowState) -> WorkflowState:
        if state.risk_assessment is None:
            raise ValueError("Risk assessment is required")
        if state.risk_assessment.human_approval_required:
            if state.approval is None or state.approval.status != "approved":
                raise ValueError("Human approval is required")

        for tool_name in ("process_tool", "data_tool", "automation_tool", "kpi_tool"):
            result = self.tools[tool_name].execute({"objective": state.objective.title})
            state.tool_results.append(result)
            self._audit(
                state,
                "tool_called",
                "OrchestratorAgent",
                {"tool": tool_name, "simulated": result.simulated, "success": result.success},
            )

        state.expected_business_impact = self._impact(state)
        state.status = WorkflowStatus.COMPLETED
        state.next_steps = [
            "validar baseline com o owner do processo",
            "executar piloto assistido com dados reais",
            "integrar tools MCP somente apos testes e aprovacao",
            "comparar KPIs antes e depois do piloto",
        ]
        self._audit(state, "workflow_completed", "OrchestratorAgent")
        state.updated_at = utc_now()
        return state

    def diagnose(self, objective: BusinessObjective) -> dict[str, object]:
        assessment = self.risk_policy.assess(objective)
        return {
            "objective": objective,
            "diagnosis": self._diagnosis(objective),
            "risk_assessment": assessment,
            "recommended_agents": [agent.name for agent in self.agents],
        }

    def find_opportunities(self, objective: BusinessObjective) -> dict[str, object]:
        assessment = self.risk_policy.assess(objective)
        process = self._process_map(objective)
        return {
            "objective": objective,
            "process_map": process,
            "opportunities": self._opportunities(objective, process, assessment.level),
        }

    def _diagnosis(self, objective: BusinessObjective) -> dict[str, object]:
        return {
            "business_area": objective.business_area,
            "problem": objective.description,
            "expected_outcome": objective.expected_outcome,
            "data_readiness": "declared" if objective.available_data else "discovery_required",
            "systems": objective.involved_systems,
            "constraints": objective.constraints,
            "transformation_thesis": (
                "Redesenhar o processo com decisao assistida por dados, agentes "
                "governados e automacao progressiva."
            ),
        }

    def _process_map(self, objective: BusinessObjective) -> BusinessProcess:
        steps = [
            ProcessStep(
                name="Receber demanda ou evento",
                actor="area de negocio",
                activity_type="human",
                pain_points=["entrada pouco estruturada"],
                automatable=True,
            ),
            ProcessStep(
                name="Consolidar dados e contexto",
                actor="analista e sistemas",
                activity_type="hybrid",
                pain_points=["dados fragmentados", "retrabalho"],
                automatable=True,
            ),
            ProcessStep(
                name="Analisar e decidir",
                actor="responsavel pelo processo",
                activity_type="human",
                pain_points=["decisao lenta", "criterios variaveis"],
                decision_point=True,
                automatable=False,
            ),
            ProcessStep(
                name="Executar e monitorar resultado",
                actor="operacao",
                activity_type="hybrid",
                pain_points=["baixa rastreabilidade"],
                automatable=True,
            ),
        ]
        return BusinessProcess(
            name=f"Processo atual: {objective.title}",
            area=objective.business_area,
            steps=steps,
            bottlenecks=["dados dispersos", "decisoes manuais", "feedback tardio"],
            dependencies=objective.involved_systems,
        )

    def _opportunities(
        self,
        objective: BusinessObjective,
        process: BusinessProcess,
        risk_level: RiskLevel,
    ) -> list[TransformationOpportunity]:
        definitions = [
            (
                "agent",
                "Agente de diagnostico e recomendacao com evidencia e auditoria.",
                8.5,
                4.0,
                ["process_tool", "document_tool"],
            ),
            (
                "automation",
                "Automacao assistida das etapas repetitivas, com aprovacao por risco.",
                8.0,
                6.0,
                ["automation_tool"],
            ),
            (
                "analytics_ml",
                "Indicadores e modelos para antecipar desvios e apoiar decisoes.",
                7.5,
                6.5,
                ["data_tool", "kpi_tool"],
            ),
        ]
        opportunities = []
        for kind, description, impact, complexity, tools in definitions:
            priority = round(max(0, min(10, impact * 0.65 + (10 - complexity) * 0.35)), 2)
            opportunities.append(
                TransformationOpportunity(
                    process_id=process.id,
                    opportunity_type=kind,
                    description=description,
                    expected_impact=objective.expected_outcome,
                    impact_score=impact,
                    complexity_score=complexity,
                    risk_level=risk_level,
                    required_data=objective.available_data or ["baseline do processo", "historico de resultados"],
                    required_tools=tools,
                    human_approval_required=risk_level in {RiskLevel.HIGH, RiskLevel.CRITICAL},
                    priority_score=priority,
                )
            )
        return sorted(opportunities, key=lambda item: item.priority_score, reverse=True)

    def _execution_plan(
        self,
        objective: BusinessObjective,
        opportunities: list[TransformationOpportunity],
        risk_level: RiskLevel,
    ) -> ExecutionPlan:
        tools = sorted({tool for opportunity in opportunities for tool in opportunity.required_tools})
        data = sorted({item for opportunity in opportunities for item in opportunity.required_data})
        approval_points = []
        if risk_level in {RiskLevel.HIGH, RiskLevel.CRITICAL}:
            approval_points.append("antes da execucao ou integracao com sistemas")
        return ExecutionPlan(
            agents=[agent.name for agent in self.agents],
            tools=tools,
            required_data=data,
            integrations=objective.involved_systems,
            technical_steps=[
                "confirmar objetivo, owner e baseline",
                "validar dados e contrato de acesso",
                "executar piloto em modo simulacao",
                "avaliar qualidade, risco, custo e impacto",
                "habilitar integracoes MCP por menor privilegio",
                "monitorar KPIs e melhorar o processo",
            ],
            approval_points=approval_points,
            owners=["owner do processo", "owner de dados", "seguranca e governanca"],
            timeline=["descoberta", "piloto assistido", "validacao", "escala controlada"],
        )

    def _kpis(self, objective: BusinessObjective) -> list[KPI]:
        return [
            KPI(
                name="tempo_de_ciclo",
                description="Tempo entre entrada e conclusao do processo.",
                unit="horas",
                direction="decrease",
            ),
            KPI(
                name="taxa_de_retrabalho",
                description="Percentual de casos que exigem correcao.",
                unit="percentual",
                direction="decrease",
            ),
            KPI(
                name="resultado_empresarial",
                description=objective.expected_outcome,
                unit="indice",
                direction="increase",
            ),
            KPI(
                name="adocao_assistida",
                description="Uso correto do fluxo por operadores.",
                unit="percentual",
                direction="increase",
            ),
        ]

    def _decisions(self, state: WorkflowState) -> list[AgentDecision]:
        assert state.risk_assessment is not None
        return [
            AgentDecision(
                agent="BusinessTransformationAgent",
                decision="Priorizar piloto assistido antes de automacao integral.",
                rationale="Permite provar valor e aprender com menor risco.",
                evidence=[state.objective.expected_outcome],
                risk_level=state.risk_assessment.level,
            ),
            AgentDecision(
                agent="RiskGovernanceAgent",
                decision=f"Aplicar autonomia {state.risk_assessment.level.value}.",
                rationale="Classificacao calculada pela politica de risco do Synapse.",
                evidence=state.risk_assessment.reasons,
                risk_level=state.risk_assessment.level,
            ),
        ]

    def _impact(self, state: WorkflowState) -> BusinessImpact:
        average_priority = (
            sum(item.priority_score for item in state.opportunities) / len(state.opportunities)
            if state.opportunities
            else 0
        )
        data_confidence = 0.75 if state.objective.available_data else 0.5
        return BusinessImpact(
            summary=f"Impacto esperado para {state.objective.expected_outcome}.",
            expected_benefits=[
                "menor tempo de ciclo",
                "decisoes mais consistentes",
                "maior rastreabilidade",
                "aprendizado operacional continuo",
            ],
            estimated_value_score=round(average_priority, 2),
            confidence=data_confidence,
            assumptions=[
                "baseline sera validado com dados reais",
                "owners e usuarios participarao do piloto",
                "integracoes reais seguirao a politica MCP e de aprovacao",
            ],
        )

    @staticmethod
    def _audit(
        state: WorkflowState,
        event_type: str,
        actor: str,
        details: dict[str, object] | None = None,
    ) -> None:
        state.audit.append(
            AuditEvent(
                workflow_id=state.workflow_id,
                event_type=event_type,
                actor=actor,
                details=details or {},
            )
        )

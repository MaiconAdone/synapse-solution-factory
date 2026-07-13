import re
from typing import Any

from app.agents.required import REQUIRED_PARALLEL_AGENTS
from app.schemas.projects import ProjectBriefingRequest
from app.services.agent_blueprint_service import AgentBlueprintService
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.ai_framework_selector import AiFrameworkSelector
from app.services.business_solution_analyzer import BusinessSolutionAnalyzer
from app.services.cost_aware_router import CostAwareRouter
from app.services.enterprise_spec_service import EnterpriseSpecService
from app.services.ruflo_service import RufloService


class ProjectBriefingService:
    def __init__(
        self,
        ruflo: RufloService | None = None,
        enterprise_spec: EnterpriseSpecService | None = None,
        framework_selector: AiFrameworkSelector | None = None,
        cost_router: CostAwareRouter | None = None,
        mesh_governance: AgenticMeshGovernanceService | None = None,
        blueprint_service: AgentBlueprintService | None = None,
        solution_analyzer: BusinessSolutionAnalyzer | None = None,
    ) -> None:
        self.ruflo = ruflo or RufloService()
        self.enterprise_spec = enterprise_spec or EnterpriseSpecService()
        self.framework_selector = framework_selector or AiFrameworkSelector()
        self.cost_router = cost_router or CostAwareRouter()
        self.mesh_governance = mesh_governance or AgenticMeshGovernanceService()
        self.blueprint_service = blueprint_service or AgentBlueprintService()
        self.solution_analyzer = solution_analyzer or BusinessSolutionAnalyzer()

    def answer(self, request: ProjectBriefingRequest) -> dict[str, Any]:
        goal = (request.project_goal or request.message).strip()
        business_problem = (request.business_problem or "").strip()
        success_metric = (request.success_metric_or_acceptance_criteria or "").strip()
        data_sources = (request.available_data_or_knowledge_sources or "").strip()
        risk_level = (request.risk_level or "").strip()
        focus = self._infer_focus(request.solution_focus, goal, business_problem)
        missing = self._missing_fields(goal, business_problem, focus, success_metric, data_sources, risk_level)
        ready = not missing
        phase = "validacao_de_negocio" if business_problem else "descoberta"
        status = self.ruflo.swarm_status()
        project_defaults = self.enterprise_spec.project_creation_defaults()
        framework_selection = self.framework_selector.select(
            f"{goal} {business_problem}",
            universe=focus,
        )
        cost_aware_activation = self.cost_router.route(
            f"{goal} {business_problem}",
            universe=focus,
        )
        agentic_mesh = self.mesh_governance.fleet_for_request(
            f"{goal} {business_problem}",
            universe=focus,
        )
        agent_blueprint = self.blueprint_service.build_blueprint(
            f"{goal} {business_problem}",
            universe=focus,
        )
        business_solution_analysis = self.solution_analyzer.analyze(
            project_goal=goal,
            business_problem=business_problem,
            requested_universe=focus,
            solution_focus=focus,
            success_metric_or_acceptance_criteria=success_metric,
            available_data_or_knowledge_sources=data_sources,
            risk_level=risk_level,
        )

        return {
            "agent": "orchestration-manager",
            "phase": phase,
            "message": self._compose_message(goal, business_problem, focus, ready),
            "llm_response": self._compose_llm_response(goal, business_problem, focus, ready),
            "suggested_project_name": self._suggest_project_name(goal),
            "solution_focus": focus,
            "next_question": self._next_question(missing, focus),
            "missing_questions": self._missing_questions(missing, focus),
            "ready_to_create": ready,
            "required_fields": missing,
            "recommendations": self._recommendations(focus),
            "foundation_principles": self._foundation_principles(focus),
            "parallel_agents": self._parallel_agents(focus),
            "execution_plan": self._execution_plan(focus, ready),
            "token_strategy": project_defaults["token_strategy"],
            "cost_aware_activation": cost_aware_activation,
            "agentic_mesh": agentic_mesh,
            "agent_blueprint": agent_blueprint,
            "business_solution_analysis": business_solution_analysis,
            "enterprise_spec": {
                "version": self.enterprise_spec.spec()["version"],
                "sdd_gate": project_defaults["sdd_gate"],
                "required_request_steps": self.enterprise_spec.required_request_steps(),
                "ruflo_required": project_defaults["ruflo_required"],
                "parallel_agent_count": project_defaults["parallel_agent_count"],
                "max_agent_count": project_defaults["max_agent_count"],
                "specialist_agent_count": project_defaults["specialist_agent_count"],
                "agents": project_defaults["agents"],
                "specialist_agents": project_defaults["specialist_agents"],
            },
            "ai_framework_selection": framework_selection,
            "ruflo": {
                "source": status.get("source", "ruflo_mcp"),
                "available": bool(status.get("available")),
                "tool": status.get("tool"),
                "parallel_default": True,
                "workflow": "new-ai-project",
            },
        }

    def _compose_message(self, goal: str, business_problem: str, focus: str, ready: bool) -> str:
        if ready:
            return (
                "Ruflo recebeu o objetivo e o problema de negocio. O swarm pode criar o projeto completo "
                "com dados, experimentos, MLflow quando aplicavel, testes ML/IA, governanca e briefing operacional."
            )
        if business_problem:
            return "Ruflo entendeu o problema inicial. Antes de implementar, preciso fechar as informacoes faltantes pela conversa."
        if goal:
            return (
                "Ruflo entendeu o tipo de projeto solicitado. Antes de criar modelos de ML ou agentes de IA, "
                "precisamos registrar o problema de negocio que a solucao deve resolver."
            )
        return "Descreva o projeto para que o swarm Ruflo consiga iniciar o briefing."

    def _compose_llm_response(self, goal: str, business_problem: str, focus: str, ready: bool) -> str:
        if not ready:
            return (
                "Vou transformar sua ideia em um projeto de ML/IA pela conversa, sem depender de task. "
                "Antes de implementar, preciso perguntar objetivamente as informacoes que faltam: problema de negocio, "
                "metrica de sucesso, dados ou fontes disponiveis e nivel de risco. Depois disso aplico o analisador de solucoes."
            )
        return (
            f"Projeto pronto para criacao guiada com foco em {focus}. O fluxo vai gerar a estrutura, preparar a pasta de dados, "
            "definir contrato de dados, planejar modelo/agentes, criar avaliacoes e acionar o swarm em paralelo. "
            "Nenhuma programacao manual e necessaria para iniciar."
        )

    def _next_question(self, missing: list[str], focus: str) -> str:
        if missing:
            return self._question_for_field(missing[0], focus)
        return "Confirme o nome do projeto e clique em criar projeto completo."

    def _missing_questions(self, missing: list[str], focus: str) -> list[str]:
        return [self._question_for_field(field, focus) for field in missing]

    def _question_for_field(self, field: str, focus: str) -> str:
        if field == "project_goal":
            return "O que voce quer criar ou implementar com o Synapse?"
        if field == "business_problem":
            if focus == "ml":
                return "Qual problema de negocio o modelo deve prever, classificar ou otimizar?"
            if focus == "agents":
                return "Qual processo de negocio os agentes devem executar ou apoiar?"
            if focus == "rag":
                return "Qual base de conhecimento, documento ou duvida precisa ser respondida com RAG?"
            if focus == "chatbots":
                return "Qual conversa, atendimento ou triagem o Chatbolt precisa resolver?"
            return "Qual problema de negocio essa solucao precisa resolver?"
        if field == "success_metric_or_acceptance_criteria":
            return "Qual metrica de sucesso ou criterio de aceite define que a solucao funcionou?"
        if field == "available_data_or_knowledge_sources":
            return "Quais dados, arquivos, documentos, sistemas ou fontes de conhecimento estao disponiveis?"
        if field == "risk_level":
            return "Qual e o nivel de risco esperado: baixo, medio, alto ou critico?"
        if field == "requested_universe":
            return "Qual universo voce quer usar: ML, IA/RAG/agentes, Chatbolt ou hibrido?"
        return f"Informe o campo faltante: {field}."

    def _recommendations(self, focus: str) -> list[str]:
        base = [
            "Definir metrica de sucesso antes da criacao do modelo ou agente.",
            "Registrar experimentos e avaliacoes no MLflow.",
            "Rodar testes separados para ML e IA antes da liberacao.",
        ]
        if focus == "ml":
            return [
                "Mapear fonte de dados, variavel alvo e baseline de comparacao.",
                "Criar dataset de avaliacao antes do primeiro treino.",
                *base,
            ]
        if focus == "agents":
            return [
                "Definir ferramentas permitidas, limites de autonomia e aprovacoes humanas.",
                "Criar casos de teste para prompts, memoria e execucao de workflows.",
                *base,
            ]
        if focus == "rag":
            return [
                "Definir colecoes, politica de chunking e criterios de relevancia.",
                "Criar avaliacoes de recuperacao antes de expor respostas ao usuario.",
                *base,
            ]
        return [
            "Separar claramente o que sera ML, agente de IA, RAG e automacao tradicional.",
            "Criar gates de qualidade para dados, prompts, modelos e workflows.",
            *base,
        ]

    def _foundation_principles(self, focus: str) -> list[str]:
        principles = [
            "AI Engineering: definir evals, custo, latencia e seguranca antes de otimizar.",
            "Designing ML Systems: declarar contrato de dados, baseline, monitoramento e drift.",
            "Prompt/LLM Engineering: versionar prompts, ferramentas, saidas e casos de regressao.",
            "Production LLMs: registrar fallback, observabilidade, guardrails e release checklist.",
            "Mathematics for ML: explicitar metricas, incerteza, similaridade e criterio de aceite.",
            "Agentic Coding: dividir tarefas entre agentes especializados com memoria e validacao.",
            "Product Strategy: converter conversa em objetivo, metrica de sucesso e criterio de aceite.",
            "Security/Compliance: validar privacidade, permissao, limites de autonomia e uso seguro.",
            "Observability: medir custo, latencia, tokens, drift e qualidade durante o ciclo completo.",
        ]
        if focus == "rag":
            principles.append("RAG: medir recuperacao, relevancia e fidelidade antes de expor respostas.")
        return principles

    def _parallel_agents(self, focus: str) -> list[str]:
        return list(REQUIRED_PARALLEL_AGENTS)

    def _execution_plan(self, focus: str, ready: bool) -> list[str]:
        if not ready:
            return [
                "Coletar objetivo, problema de negocio, publico, dados disponiveis e metrica de sucesso.",
                "Classificar se o projeto exige ML, agentes de IA, RAG ou uma combinacao.",
                "Liberar criacao somente quando o briefing minimo estiver completo.",
            ]
        plan = [
            "Criar projeto local no VS Code com pasta data/ para CSV, Excel e outros dados.",
            "Acionar Ruflo no workflow new-ai-project com Codex, subconjunto economico de core agents em paralelo e pool escalavel ate 60 agentes.",
            "Gerar contrato de dados, casos de avaliacao, model card e guardrails.",
        ]
        if focus in {"ml", "ai-ml-agents"}:
            plan.append("Preparar baseline de ML, MLflow e metricas antes do primeiro treino.")
        if focus in {"agents", "ai-ml-agents"}:
            plan.append("Definir agentes, ferramentas permitidas, memoria e limites de autonomia.")
        if focus in {"rag", "ai-ml-agents"}:
            plan.append("Preparar pipeline RAG com chunking, embeddings, indice e avaliacao de recuperacao.")
        plan.append("Consolidar resposta final do LLM com riscos, proximas acoes e checks de qualidade.")
        return plan

    def _missing_fields(
        self,
        goal: str,
        business_problem: str,
        focus: str,
        success_metric: str,
        data_sources: str,
        risk_level: str,
    ) -> list[str]:
        missing = []
        if not goal:
            missing.append("project_goal")
        if not business_problem:
            missing.append("business_problem")
        if focus not in {"ml", "agents", "rag", "chatbots", "ai-ml-agents"}:
            missing.append("requested_universe")
        if not success_metric:
            missing.append("success_metric_or_acceptance_criteria")
        if not data_sources:
            missing.append("available_data_or_knowledge_sources")
        if not risk_level:
            missing.append("risk_level")
        return missing

    def _infer_focus(self, selected: str, goal: str, business_problem: str) -> str:
        if selected in {"ml", "agents", "rag", "chatbots", "ai-ml-agents"}:
            return selected
        text = f"{goal} {business_problem}".lower()
        if any(term in text for term in ("rag", "busca", "documento", "conhecimento")):
            return "rag"
        if any(term in text for term in ("modelo", "prever", "classificar", "score", "churn")):
            return "ml"
        if any(term in text for term in ("agente", "workflow", "automacao", "autonom")):
            return "agents"
        return "ai-ml-agents"

    def _suggest_project_name(self, text: str) -> str:
        normalized = (
            text.encode("ascii", "ignore")
            .decode("ascii")
            .lower()
        )
        normalized = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
        return (normalized[:48].strip("_") or "novo_projeto_ai_ml")

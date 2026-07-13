import json
import sys
from pathlib import Path
from mcp.server.fastmcp import FastMCP


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.services.ollama_service import OllamaService, OllamaServiceError  # noqa: E402
from app.services.governed_swarm_execution import (  # noqa: E402
    GovernedSwarmExecutionError,
    GovernedSwarmExecutionService,
)
from app.services.continual_learning_service import (  # noqa: E402
    ContinualLearningError,
    ContinualLearningService,
)


mcp = FastMCP(
    "Synapse-ollama",
    instructions=(
        "Prefira estas ferramentas para triagem, resumo, planejamento inicial, "
        "revisao de codigo e processamento sem API paga. Cloud permanece desativada "
        "por padrao. Sempre informe que o conteudo foi gerado pelo Ollama local."
    ),
)


@mcp.tool()
def ollama_status():
    """Verifica disponibilidade, versao e modelos instalados no Ollama local."""
    return OllamaService().status()


@mcp.tool()
def ask_ollama(
    prompt: str,
    system: str = (
        "Synapse e a plataforma corporativa de engenharia de IA e ML deste "
        "repositorio, com RAG, MCP, agentes, tratamento de dados e Ruflo. "
        "Voce e seu especialista local. Responda de forma objetiva, segura "
        "e orientada a producao."
    ),
    model: str | None = None,
    model_profile: str | None = "fast",
    json_mode: bool = False,
    temperature: float = 0.15,
    seed: int | None = None,
    context_window: int = 2048,
    max_output_tokens: int = 256,
):
    """Envia uma solicitacao ao Ollama local e devolve resposta e metricas."""
    try:
        result = OllamaService().generate(
            prompt,
            system=system,
            model=model,
            model_profile=model_profile,
            json_mode=json_mode,
            temperature=temperature,
            seed=seed if seed is not None or json_mode or temperature == 0.0 else None,
            context_window=context_window,
            max_output_tokens=max_output_tokens,
        )
    except OllamaServiceError as error:
        return {
            "ok": False,
            "provider": "ollama",
            "error": str(error),
        }

    response = result.get("response", "")
    if json_mode:
        try:
            result["parsed_response"] = json.loads(str(response))
        except json.JSONDecodeError:
            result["json_valid"] = False
        else:
            result["json_valid"] = True
    result["ok"] = True
    result["source_notice"] = "Resposta gerada pelo Ollama local."
    return result


@mcp.tool()
def execute_governed_swarm(
    prompt: str,
    universe: str = "hybrid",
    allow_cloud: bool = False,
    activate_all_60: bool = False,
    human_approved: bool = False,
    json_mode: bool = False,
    project_id: str = "synapse-ai",
):
    """Executa Ruflo, governanca e roteamento Ollama/OpenAI em um unico fluxo."""
    service = GovernedSwarmExecutionService()
    try:
        return service.execute(
            prompt,
            universe=universe,
            allow_cloud=allow_cloud,
            activate_all_60=activate_all_60,
            human_approved=human_approved,
            json_mode=json_mode,
            project_id=project_id,
        )
    except GovernedSwarmExecutionError as error:
        return {"status": "blocked_by_governance", "error": str(error)}
    finally:
        service.llm_router.close()


@mcp.tool()
def learning_summary():
    """Mostra experiencias, feedback e exemplos aprovados para treinamento local."""
    return ContinualLearningService().summary()


@mcp.tool()
def approve_learning_example(
    execution_id: str,
    project_id: str = "synapse-ai",
    score: float = 0.9,
    notes: str = "",
    scope: str = "project",
):
    """Aprova uma experiencia governada para o dataset local do Synapse."""
    if scope == "global":
        return {
            "approved_for_training": False,
            "error": "Global promotion is only available through authenticated admin APIs",
        }
    service = ContinualLearningService()
    try:
        return service.apply_feedback(
            execution_id=execution_id,
            project_id=project_id,
            approved=True,
            score=score,
            notes=notes,
            scope=scope,
            approver="mcp-local-operator",
        )
    except ContinualLearningError as error:
        return {"approved_for_training": False, "error": str(error)}


if __name__ == "__main__":
    mcp.run(transport="stdio")

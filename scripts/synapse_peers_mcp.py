import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.services.peer_messaging_service import (  # noqa: E402
    PeerMessagingError,
    PeerMessagingService,
)


def _peer_type() -> str:
    return os.getenv("SYNAPSE_PEER_TYPE", "codex").strip().lower() or "codex"


def _capabilities() -> list[str]:
    raw = os.getenv("SYNAPSE_PEER_CAPABILITIES", "")
    return [item.strip() for item in raw.split(",") if item.strip()]


service = PeerMessagingService()
registered_peer = service.register(
    peer_type=_peer_type(),
    cwd=os.getcwd(),
    summary=os.getenv("SYNAPSE_PEER_SUMMARY", ""),
    role=os.getenv("SYNAPSE_PEER_ROLE", ""),
    capabilities=_capabilities(),
    model_profile=os.getenv("SYNAPSE_PEER_MODEL_PROFILE", ""),
    active_agents=int(os.getenv("SYNAPSE_PEER_ACTIVE_AGENTS", "0") or "0") or None,
)

mcp = FastMCP(
    "synapse-peers",
    instructions=(
        "Use these local peer tools to coordinate Codex, Claude, Ruflo, and human "
        "operator sessions while reducing repeated context. AdoneX should register "
        "as peer_type=adonex and route Synapse system questions through Ruflo/Ollama "
        "local-first. Prefer list_peers and short summaries before requesting details. "
        "Do not send secrets or large file contents. All messages stay local in SQLite."
    ),
)


@mcp.tool()
def my_peer():
    """Mostra a identidade local desta sessao no barramento Synapse Peers."""
    return {
        "ok": True,
        "peer": registered_peer,
        "cost_policy": {
            "send_summaries_first": True,
            "max_message_chars": service.settings.peer_messaging_max_message_chars,
            "max_summary_chars": service.settings.peer_messaging_max_summary_chars,
            "cloud_used": False,
        },
    }


@mcp.tool()
def list_peers(scope: str = "repo", limit: int = 10):
    """Lista peers locais por maquina, diretorio ou repositorio."""
    try:
        return {
            "ok": True,
            **service.list_peers(
                scope=scope,
                cwd=os.getcwd(),
                exclude_id=registered_peer["id"],
                limit=limit,
            ),
        }
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def set_summary(summary: str):
    """Define um resumo curto do trabalho atual desta sessao."""
    try:
        peer = service.set_summary(registered_peer["id"], summary)
        return {
            "ok": True,
            "peer": peer,
            "source_notice": "Resumo salvo localmente pelo Synapse Peers.",
        }
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def publish_context(
    summary: str,
    role: str = "",
    capabilities_csv: str = "",
    model_profile: str = "",
    active_agents: int = 0,
    status: str = "active",
):
    """Publica contexto estruturado desta sessao para AdoneX, Ruflo e Codex."""
    try:
        capabilities = [
            item.strip()
            for item in capabilities_csv.split(",")
            if item.strip()
        ]
        peer = service.publish_context(
            registered_peer["id"],
            summary=summary,
            role=role,
            capabilities=capabilities,
            model_profile=model_profile,
            active_agents=active_agents or None,
            status=status,
        )
        return {
            "ok": True,
            "peer": peer,
            "source_notice": "Contexto salvo localmente pelo Synapse Peers; nenhum LLM externo foi chamado.",
        }
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def send_message(to_id: str, message: str):
    """Envia uma mensagem curta a outro peer local."""
    try:
        return service.send_message(
            from_id=registered_peer["id"],
            to_id=to_id,
            message=message,
        )
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def check_messages(mark_delivered: bool = True, limit: int = 10):
    """Verifica mensagens locais pendentes para esta sessao."""
    try:
        return {
            "ok": True,
            **service.check_messages(
                registered_peer["id"],
                mark_delivered=mark_delivered,
                limit=limit,
            ),
        }
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def announce_task(objective: str, target_peer_type: str = "ruflo", required_agents_csv: str = ""):
    """Anuncia uma tarefa local para peers de um tipo, sem disparar cloud ou LLM externo."""
    try:
        required_agents = [
            item.strip()
            for item in required_agents_csv.split(",")
            if item.strip()
        ]
        return service.announce_task(
            from_id=registered_peer["id"],
            objective=objective,
            target_peer_type=target_peer_type,
            required_agents=required_agents,
        )
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def route_to_ruflo_agents(objective: str, required_agents_csv: str = "", max_agents: int = 60):
    """Prepara a rota AdoneX -> Ruflo local para ate 60 agentes com Ollama consolidado."""
    try:
        requested = [
            item.strip()
            for item in required_agents_csv.split(",")
            if item.strip()
        ][:60]
        agent_count = max(1, min(int(max_agents), 60))
        selected = requested[:agent_count] if requested else ["auto"]
        announcement = service.announce_task(
            from_id=registered_peer["id"],
            objective=objective,
            target_peer_type="ruflo",
            required_agents=selected if selected != ["auto"] else [],
        )
        return {
            "ok": True,
            "route": "adonex-ruflo-local",
            "provider": "ollama",
            "cloud_used": False,
            "max_agents": 60,
            "active_agent_budget": agent_count,
            "selected_agents": selected,
            "llm_policy": "Consolidar o conselho Ruflo em poucas chamadas Ollama locais; nao executar 60 geracoes paralelas.",
            "announcement": announcement,
        }
    except PeerMessagingError as error:
        return {"ok": False, "error": str(error)}


if __name__ == "__main__":
    mcp.run(transport="stdio")

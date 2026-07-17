from pathlib import Path
import subprocess
import json
import zipfile
import base64
import sys
from io import BytesIO

import pytest
import httpx
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.agents.catalog import AGENT_CATALOG
from app.agents.required import REQUIRED_PARALLEL_AGENTS, SCALABLE_SWARM_AGENTS, SPECIALIST_AGENT_POOL
from app.core_config import Settings, get_settings
from app.main import app
from app.orchestration.workflows import WORKFLOW_CATALOG
from app.rag.pipeline import RagPipeline
from app.routes import models as model_routes
from app.services.ai_framework_selector import AiFrameworkSelector
from app.services.agent_blueprint_service import AgentBlueprintService
from app.services.cost_aware_router import CostAwareRouter
from app.services.business_solution_analyzer import BusinessSolutionAnalyzer
from app.services.eval_service import EvalService
from app.services.enterprise_spec_service import EnterpriseSpecService
from app.services.memory_service import MemoryService
from app.services.mlflow_service import MlflowService
from app.services.model_service import ModelService
from app.services.project_briefing_service import ProjectBriefingService
from app.services.project_factory_service import PROJECT_SWARM_AGENTS, PROJECT_UNIVERSES, ProjectFactoryError, ProjectFactoryService
from app.schemas.projects import ProjectBriefingRequest, ProjectCreateRequest
from app.schemas.models import ModelPredictionRequest, ModelTrainingRequest
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.swarm_service import SwarmService
from app.repositories.runtime_manifest import load_runtime_manifest
from app.security import require_api_key
from app.security import AuthContext, _require_approved_supabase_user
from app.services.ruflo_service import RufloService
from app.services.ollama_service import OllamaService
from app.services.hybrid_llm_router import HybridLlmRouter, HybridLlmRouterError
from app.services.llm_gateway import LlmGateway, LlmGatewayError
from app.services.llm_routing_metrics import LlmRoutingMetrics
from app.services.peer_messaging_service import PeerMessagingError, PeerMessagingService
from app.services.governed_swarm_execution import (
    GovernedSwarmExecutionError,
    GovernedSwarmExecutionService,
)
from app.services.continual_learning_service import (
    ContinualLearningError,
    ContinualLearningService,
)
from scripts.treat_dataset import treat_dataset
from scripts.context_filter import filter_context, is_ignored_path, load_context_policy
from scripts.market_radar import collect_signals, write_outputs


def _read_factory_sources(root: Path) -> str:
    """Concatenate the project-factory entry script with its dot-sourced modules.

    create_ai_project.ps1 is an orchestrator that dot-sources the helpers under
    scripts/project_factory/, so content assertions must look across all of them.
    """
    sources = [root / "scripts" / "create_ai_project.ps1"]
    sources.extend(sorted((root / "scripts" / "project_factory").glob("*.ps1")))
    return "\n".join(path.read_text(encoding="utf-8-sig") for path in sources)


class FailingClient:
    def call_tool(self, tool_name, arguments=None):
        raise OSError("mcp unavailable")


class RecordingClient:
    def __init__(self):
        self.calls = []

    def call_tool(self, tool_name, arguments=None):
        self.calls.append((tool_name, arguments))
        return {"ok": True, "tool": tool_name, "arguments": arguments}


class MissingWorkflowClient:
    def call_tool(self, tool_name, arguments=None):
        raise OSError("Workflow not found")


def test_ollama_service_reports_models_and_generation_metrics():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.30.6"})
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen2.5-coder:3b"}]})
        if request.url.path == "/api/generate":
            payload = json.loads(request.content)
            assert payload["model"] == "qwen2.5-coder:3b"
            assert payload["format"] == "json"
            assert payload["options"]["temperature"] == 0.0
            assert payload["options"]["seed"] == 42
            assert payload["options"]["num_ctx"] == 4096
            assert payload["options"]["num_predict"] == 512
            return httpx.Response(
                200,
                json={
                    "model": payload["model"],
                    "response": '{"universe":"ML"}',
                    "done": True,
                    "prompt_eval_count": 12,
                    "eval_count": 20,
                    "eval_duration": 2_000_000_000,
                    "total_duration": 3_000_000_000,
                },
            )
        return httpx.Response(404)

    settings = Settings(
        ollama_base_url="http://ollama.test",
        ollama_model="qwen2.5-coder:3b",
    )
    client = httpx.Client(
        base_url=settings.ollama_base_url,
        transport=httpx.MockTransport(handler),
    )
    service = OllamaService(settings=settings, client=client)

    status = service.status()
    result = service.generate("planeje", json_mode=True)

    assert status["available"] is True
    assert status["default_model_installed"] is True
    assert status["general_model"] == "qwen3:8b"
    assert status["large_model"] == "qwen2.5-coder:32b"
    assert status["large_model_installed"] is False
    assert status["balanced_model"] == "deepseek-coder-v2:lite"
    assert status["code_review_model"] == "deepseek-coder-v2:lite"
    assert status["embedding_model"] == "nomic-embed-text:latest"
    assert result["provider"] == "ollama"
    assert result["prompt_tokens"] == 12
    assert result["completion_tokens"] == 20
    assert result["tokens_per_second"] == 10.0


def test_ollama_service_does_not_seed_open_temperature_questions():
    captured_payloads = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/generate":
            payload = json.loads(request.content)
            captured_payloads.append(payload)
            return httpx.Response(
                200,
                json={
                    "model": payload["model"],
                    "response": "resposta aberta",
                    "done": True,
                    "prompt_eval_count": 1,
                    "eval_count": 2,
                    "eval_duration": 1_000_000_000,
                },
            )
        return httpx.Response(404)

    settings = Settings(
        ollama_base_url="http://ollama.test",
        ollama_model="qwen2.5-coder:3b",
    )
    client = httpx.Client(
        base_url=settings.ollama_base_url,
        transport=httpx.MockTransport(handler),
    )
    service = OllamaService(settings=settings, client=client)

    service.generate("explique o Synapse", temperature=0.2, json_mode=False)
    service.generate("retorne json", temperature=0.2, json_mode=True)

    assert "seed" not in captured_payloads[0]["options"]
    assert captured_payloads[1]["options"]["seed"] == 42


def test_local_llm_status_endpoint_is_available(monkeypatch):
    monkeypatch.setattr(
        "app.routes.local_llm.OllamaService.status",
        lambda _self: {
            "enabled": True,
            "provider": "ollama",
            "available": True,
            "models": ["qwen2.5-coder:3b", "deepseek-coder-v2:lite"],
        },
    )
    response = TestClient(app).get("/local-llm/status")
    assert response.status_code == 200
    assert response.json()["provider"] == "ollama"


def test_peer_messaging_service_routes_short_local_messages(tmp_path, monkeypatch):
    monkeypatch.setattr(PeerMessagingService, "_pid_alive", staticmethod(lambda _pid: True))
    settings = Settings(
        peer_messaging_db_path=str(tmp_path / "peers.db"),
        peer_messaging_max_message_chars=80,
        peer_messaging_max_summary_chars=60,
    )
    service = PeerMessagingService(settings)

    codex = service.register(
        peer_type="codex",
        cwd=str(tmp_path),
        summary="Codex is checking local model routing.",
        pid=101,
    )
    claude = service.register(
        peer_type="claude",
        cwd=str(tmp_path),
        summary="Claude is reviewing frontend copy.",
        pid=102,
    )

    peers = service.list_peers(scope="directory", cwd=str(tmp_path), exclude_id=codex["id"])
    sent = service.send_message(
        from_id=codex["id"],
        to_id=claude["id"],
        message="Need only the summary of your current files.",
    )
    inbox = service.check_messages(claude["id"])

    assert peers["peers"][0]["id"] == claude["id"]
    assert sent["ok"] is True
    assert sent["estimated_tokens"] < 20
    assert inbox["message_count"] == 1
    assert inbox["messages"][0]["from_id"] == codex["id"]

    with pytest.raises(PeerMessagingError):
        service.send_message(from_id=codex["id"], to_id=claude["id"], message="x" * 81)


def test_peer_messaging_supports_adonex_ruflo_and_local_task_routes(tmp_path, monkeypatch):
    monkeypatch.setattr(PeerMessagingService, "_pid_alive", staticmethod(lambda _pid: True))
    settings = Settings(
        peer_messaging_db_path=str(tmp_path / "peers.db"),
        peer_messaging_max_message_chars=240,
        peer_messaging_max_summary_chars=120,
    )
    service = PeerMessagingService(settings)

    adonex = service.register(
        peer_type="adonex",
        cwd=str(tmp_path),
        summary="AdoneX answering Synapse questions locally.",
        pid=201,
        capabilities=["synapse-system-questions", "ollama-local-models"],
        model_profile="ollama:qwen2.5-coder:3b+qwen3:8b",
        active_agents=60,
    )
    ruflo = service.register(
        peer_type="ruflo",
        cwd=str(tmp_path),
        summary="Ruflo 60-agent council ready.",
        pid=202,
        capabilities=["60-agent-council", "local-routing"],
        active_agents=60,
    )

    published = service.publish_context(
        adonex["id"],
        summary="AdoneX routes simple Synapse questions through Ruflo and Ollama local.",
        role="AdoneX local assistant",
        capabilities=["synapse-system-questions", "ruflo-60-agent-routing"],
        model_profile="ollama-local",
        active_agents=60,
    )
    announced = service.announce_task(
        from_id=adonex["id"],
        objective="Responder quais modelos a Synapse usa.",
        target_peer_type="ruflo",
        required_agents=["orchestration-manager", "llm-engineering"],
    )
    inbox = service.check_messages(ruflo["id"])

    assert published["peer_type"] == "adonex"
    assert published["capabilities"] == ["synapse-system-questions", "ruflo-60-agent-routing"]
    assert published["active_agents"] == 60
    assert announced["targeted_count"] == 1
    assert announced["cost_control"].startswith("Task announcement stayed local")
    assert inbox["message_count"] == 1
    assert "provider=ollama cloud=false" in inbox["messages"][0]["text"]


def test_synapse_peers_mcp_is_declared_as_manual_local_server():
    config = json.loads(Path(".mcp.json").read_text(encoding="utf-8"))
    peers = config["mcpServers"]["synapse-peers"]

    assert peers["command"] == "python"
    assert peers["args"] == ["scripts/synapse_peers_mcp.py"]
    assert peers["autoStart"] is False
    assert peers["env"]["SYNAPSE_PEER_TYPE"] == "codex"
    assert peers["env"]["PEER_MESSAGING_MAX_MESSAGE_CHARS"] == "1200"


def test_claude_peers_mcp_is_declared_for_claude_code_channels():
    config = json.loads(Path(".mcp.json").read_text(encoding="utf-8"))
    peers = config["mcpServers"]["claude-peers"]

    assert peers["command"].endswith("bun.exe")
    assert peers["args"] == [
        "C:\\Users\\malves\\.claude\\mcp\\claude-peers-mcp\\server.ts"
    ]
    assert peers["env"]["CLAUDE_PEERS_PORT"] == "7899"
    assert peers["env"]["CLAUDE_PEERS_DB"] == "C:/Users/malves/.claude-peers.db"
    assert peers["env"]["HOME"] == "C:/Users/malves"
    assert peers["env"]["OPENAI_API_KEY"] == ""
    assert peers["autoStart"] is False


class FakeLlmProvider:
    def __init__(self, provider, response, configured=True):
        self.provider = provider
        self.response = response
        self.configured = configured
        self.calls = []

    def generate(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return {
            "provider": self.provider,
            "model": f"{self.provider}-test",
            "response": self.response,
            "done": True,
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
        }

    def close(self):
        return None


class FakeHybridRouter:
    def __init__(self, provider="ollama"):
        self.provider = provider
        self.calls = []

    def decide(
        self,
        prompt,
        allow_cloud=True,
        force_provider=None,
        local_model_profile="auto",
        human_approved=False,
    ):
        return {
            "provider": force_provider or self.provider,
            "reason": "test route",
            "sensitive": False,
            "complex": self.provider == "openai",
            "complexity_signals": [],
            "cloud_allowed": allow_cloud,
            "cloud_configured": True,
            "local_model_profile": (
                "fast" if local_model_profile == "auto" else local_model_profile
            ),
            "local_model": "test-local-model",
        }

    def generate(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        return {
            "provider": kwargs.get("force_provider") or self.provider,
            "model": "test-model",
            "response": "Resposta governada suficientemente completa para validacao.",
            "quality": {"passed": True, "reasons": []},
            "fallback_used": False,
            "prompt_tokens": 10,
            "completion_tokens": 20,
        }


class FakeGovernedRuflo:
    def __init__(self):
        self.routes = []
        self.memories = []

    def route_task(self, task, context, top_k=5):
        self.routes.append((task, context, top_k))
        return {"available": True, "source": "ruflo_mcp", "data": {"agent": "orchestration-manager"}}

    def store_memory(self, namespace, key, value, upsert=True):
        self.memories.append((namespace, key, value, upsert))
        return {"available": True, "source": "ruflo_mcp", "data": {"stored": True}}

    def search_memory(self, query, namespace, limit=5, threshold=0.35):
        return {"available": True, "source": "ruflo_mcp", "data": {"results": []}}

    def record_task_outcome(self, task_id, task, agent, success, quality):
        return {
            "available": True,
            "source": "ruflo_mcp",
            "data": {"task_id": task_id, "success": success, "quality": quality},
        }


def test_continual_learning_sanitizes_and_requires_feedback_for_training(tmp_path):
    ruflo = FakeGovernedRuflo()
    settings = Settings(
        learning_events_path=str(tmp_path / "learning.jsonl"),
        local_training_dataset_path=str(tmp_path / "training.jsonl"),
    )
    service = ContinualLearningService(settings, ruflo)
    captured = service.capture_execution(
        execution_id="run-1",
        project_id="project-a",
        prompt="Use api_key=super-secret e email pessoa@example.com",
        response="Solucao aprovada sem segredo.",
        provider="ollama",
        model="qwen2.5-coder:3b",
        fleet="project_factory_fleet",
        agents=["orchestration-manager"],
        quality_passed=True,
    )

    assert "super-secret" not in captured["event"]["prompt"]
    assert "pessoa@example.com" not in captured["event"]["prompt"]
    assert service.summary()["training_examples"] == 0

    feedback = service.apply_feedback(
        execution_id="run-1",
        project_id="project-a",
        approved=True,
        score=0.9,
        notes="Validado em testes.",
        scope="project",
        approver="qa-user",
    )
    assert feedback["approved_for_training"] is True
    assert service.summary()["training_examples"] == 1


def test_continual_learning_rejects_unidentified_global_promotion(tmp_path):
    settings = Settings(
        learning_events_path=str(tmp_path / "learning.jsonl"),
        local_training_dataset_path=str(tmp_path / "training.jsonl"),
    )
    service = ContinualLearningService(settings, FakeGovernedRuflo())
    service.capture_execution(
        execution_id="run-global",
        project_id="project-a",
        prompt="Projeto aprovado",
        response="Resposta aprovada e detalhada.",
        provider="ollama",
        model="qwen2.5-coder:3b",
        fleet="project_factory_fleet",
        agents=["orchestration-manager"],
        quality_passed=True,
    )
    with pytest.raises(ContinualLearningError):
        service.apply_feedback(
            execution_id="run-global",
            project_id="project-a",
            approved=True,
            score=1.0,
            notes="",
            scope="global",
            approver="system",
        )


def test_continual_learning_requires_admin_for_global_promotion(tmp_path):
    settings = Settings(
        learning_events_path=str(tmp_path / "learning.jsonl"),
        local_training_dataset_path=str(tmp_path / "training.jsonl"),
    )
    service = ContinualLearningService(settings, FakeGovernedRuflo())
    service.capture_execution(
        execution_id="run-admin",
        project_id="project-a",
        prompt="Projeto aprovado",
        response="Resposta aprovada e detalhada.",
        provider="ollama",
        model="qwen2.5-coder:3b",
        fleet="project_factory_fleet",
        agents=["orchestration-manager"],
        quality_passed=True,
    )

    with pytest.raises(ContinualLearningError, match="administrator"):
        service.apply_feedback(
            execution_id="run-admin",
            project_id="project-a",
            approved=True,
            score=1.0,
            notes="",
            scope="global",
            approver="approved-user",
        )


def test_all_60_agents_have_governed_model_router_tool():
    assert len(AGENT_CATALOG) == 60
    assert all("governed_llm_router" in agent["tools"] for agent in AGENT_CATALOG)


def test_governed_swarm_requires_human_approval_for_all_60(tmp_path):
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=FakeHybridRouter(),
        ruflo=FakeGovernedRuflo(),
    )
    with pytest.raises(GovernedSwarmExecutionError):
        service.plan("Execute uma auditoria completa.", activate_all_60=True)

    plan = service.plan(
        "Execute uma auditoria completa.",
        activate_all_60=True,
        human_approved=True,
        allow_cloud=False,
    )
    assert plan["active_agent_count"] == 60
    assert plan["model_route"]["provider"] == "ollama"


def test_governed_swarm_aligns_agents_with_security_fleet(tmp_path):
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=FakeHybridRouter(),
        ruflo=FakeGovernedRuflo(),
    )

    plan = service.plan(
        "FaÃ§a uma auditoria de seguranÃ§a, LGPD e compliance.",
        universe="ia",
    )

    assert plan["selected_fleet"]["id"] == "security_fleet"
    assert plan["selected_agents"][0] == "security-compliance"
    assert set(plan["selected_agents"]).issubset(
        {
            "security-compliance",
            "testing-qa",
            "observability-ops",
            "documentation",
            "privacy-lgpd-reviewer",
            "threat-modeling-specialist",
            "policy-guardrails-engineer",
            "qa-adversarial-tester",
        }
    )
    assert plan["coordination"]["conflict_resolver"] == "orchestration-manager"


def test_governed_swarm_aligns_rag_agents_and_model_profile(tmp_path):
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=FakeHybridRouter(),
        ruflo=FakeGovernedRuflo(),
    )

    plan = service.plan(
        "Crie um RAG com busca hÃ­brida, reranking e MCP com baixo custo.",
        universe="ia",
    )

    assert plan["selected_fleet"]["id"] == "rag_fleet"
    assert plan["selected_agents"][0] == "rag-engineering"
    assert "hybrid-search-engineer" in plan["selected_agents"]
    assert plan["model_route"]["local_model_profile"] == "balanced"


def test_governed_swarm_plan_is_deterministic_for_equivalent_input(tmp_path):
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=FakeHybridRouter(),
        ruflo=FakeGovernedRuflo(),
    )

    first = service.plan("Crie um projeto simples.", universe="ia")
    second = service.plan("Crie um projeto simples.", universe="ia")

    assert first["selected_agents"] == second["selected_agents"]
    assert first["decision_fingerprint"] == second["decision_fingerprint"]
    assert first["controls"]["deterministic_local_generation"] is True


def test_governed_swarm_routes_model_and_persists_ruflo_memory(tmp_path):
    ruflo = FakeGovernedRuflo()
    llm = FakeHybridRouter("ollama")
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=llm,
        ruflo=ruflo,
    )

    result = service.execute(
        "Crie um resumo simples para reduzir custo.",
        universe="ia",
        allow_cloud=False,
    )

    assert result["result"]["provider"] == "ollama"
    assert result["audit"]["ruflo_route_available"] is True
    assert result["audit"]["ruflo_plan_memory_available"] is True
    assert result["audit"]["ruflo_result_memory_available"] is True
    assert "on_plan_created" in result["plan"]["lifecycle_callbacks"]
    assert "on_execution_completed" in result["audit"]["lifecycle_callbacks"]
    assert result["plan"]["coordination"]["a2a_message_contract"] == (
        "objective_from_to_context_evidence_decision_risk_budget_status"
    )
    assert len(ruflo.routes) == 1
    assert len(ruflo.memories) == 3
    assert result["learning"]["capture"]["memory"]["available"] is True
    assert service.audit_summary()["ollama_executions"] == 1


def test_simple_synapse_questions_force_ruflo_and_local_ollama(tmp_path):
    ruflo = FakeGovernedRuflo()
    llm = FakeHybridRouter("openai")
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=llm,
        ruflo=ruflo,
    )

    result = service.execute(
        "Explique em poucas linhas como funciona o sistema Synapse.",
        universe="ia",
        allow_cloud=True,
        human_approved=True,
    )

    assert result["result"]["provider"] == "ollama"
    assert result["plan"]["model_route"]["provider"] == "ollama"
    assert result["plan"]["model_route"]["cloud_allowed"] is False
    assert result["plan"]["model_route"]["local_model_profile"] == "fast"
    assert result["plan"]["controls"]["simple_synapse_local_only"] is True
    assert llm.calls[0][1]["allow_cloud"] is False
    assert llm.calls[0][1]["force_provider"] == "ollama"
    assert len(ruflo.routes) == 1
    assert len(ruflo.memories) == 3


def test_governed_swarm_requires_human_approval_for_cloud(tmp_path):
    service = GovernedSwarmExecutionService(
        settings=Settings(governed_swarm_audit_path=str(tmp_path / "audit.jsonl")),
        llm_gateway=FakeHybridRouter("openai"),
        ruflo=FakeGovernedRuflo(),
    )

    with pytest.raises(GovernedSwarmExecutionError, match="paid cloud provider"):
        service.plan("Revise a arquitetura.", allow_cloud=True)


def test_hybrid_router_keeps_simple_and_sensitive_requests_local(tmp_path):
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
    )
    local = FakeLlmProvider("ollama", "Resposta local suficientemente completa para o teste.")
    cloud = FakeLlmProvider("openai", "Resposta cloud suficientemente completa para o teste.")
    router = HybridLlmRouter(
        settings,
        ollama=local,
        openai=cloud,
        metrics=LlmRoutingMetrics(str(tmp_path / "events.jsonl")),
    )

    simple = router.generate("Resuma este texto curto.")
    sensitive = router.generate("Analise esta senha secreta: abc123", allow_cloud=True)

    assert simple["provider"] == "ollama"
    assert sensitive["provider"] == "ollama"
    assert sensitive["routing"]["sensitive"] is True


def test_hybrid_router_selects_offline_model_profiles(tmp_path):
    settings = Settings(
        openai_api_key="",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
    )
    local = FakeLlmProvider("ollama", "Resposta local suficientemente completa para o teste.")
    cloud = FakeLlmProvider("openai", "Resposta cloud.", configured=False)
    router = HybridLlmRouter(
        settings,
        ollama=local,
        openai=cloud,
        metrics=LlmRoutingMetrics(str(tmp_path / "events.jsonl")),
    )

    simple = router.decide("Resuma este texto.", allow_cloud=False)
    complex_task = router.decide(
        "Defina uma arquitetura critica de producao.",
        allow_cloud=False,
    )
    code_review = router.decide(
        "Faca code review e encontre o bug neste codigo.",
        allow_cloud=False,
    )
    explicit_large = router.decide(
        "Analise o sistema.",
        allow_cloud=False,
        local_model_profile="large",
    )

    assert simple["local_model_profile"] == "fast"
    assert simple["local_model"] == "qwen2.5-coder:3b"
    assert complex_task["local_model_profile"] == "planning_strong"
    assert complex_task["local_model"] == "qwen3:14b"
    assert code_review["local_model_profile"] == "code_review"
    assert code_review["local_model"] == "deepseek-coder-v2:lite"
    assert explicit_large["local_model"] == "qwen2.5-coder:32b"
    assert not cloud.calls


def test_hybrid_router_uses_openai_for_complex_request_when_allowed(tmp_path):
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
    )
    local = FakeLlmProvider("ollama", "Resposta local.")
    cloud = FakeLlmProvider("openai", "Revisao de arquitetura critica com detalhes suficientes.")
    router = HybridLlmRouter(
        settings,
        ollama=local,
        openai=cloud,
        metrics=LlmRoutingMetrics(str(tmp_path / "events.jsonl")),
    )

    result = router.generate(
        "Realize uma arquitetura critica de producao com compliance.",
        allow_cloud=True,
    )

    assert result["provider"] == "openai"
    assert result["routing"]["complex"] is True
    assert not local.calls
    assert len(cloud.calls) == 1


def test_hybrid_router_escalates_low_quality_local_response(tmp_path):
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
    )
    local = FakeLlmProvider("ollama", "curta")
    cloud = FakeLlmProvider("openai", "Resposta corrigida pela nuvem e aprovada pelo validador.")
    metrics = LlmRoutingMetrics(str(tmp_path / "events.jsonl"))
    router = HybridLlmRouter(settings, ollama=local, openai=cloud, metrics=metrics)

    result = router.generate(
        "Explique este conceito.",
        allow_cloud=True,
        min_response_chars=30,
    )

    assert result["provider"] == "openai"
    assert result["fallback_used"] is True
    assert metrics.summary()["fallbacks"] == 1
    assert metrics.summary()["cloud_tokens"] == 30


def test_hybrid_router_rejects_forced_cloud_for_sensitive_content(tmp_path):
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
    )
    router = HybridLlmRouter(
        settings,
        ollama=FakeLlmProvider("ollama", "local"),
        openai=FakeLlmProvider("openai", "cloud"),
    )
    with pytest.raises(HybridLlmRouterError):
        router.decide("Minha API key e secreta", force_provider="openai")


def test_llm_gateway_caches_local_deterministic_generation_and_audits(tmp_path):
    settings = Settings(
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
        llm_gateway_cache_path=str(tmp_path / "cache.jsonl"),
        llm_gateway_audit_path=str(tmp_path / "audit.jsonl"),
    )
    local = FakeLlmProvider("ollama", "Resposta local suficientemente completa para cache.")
    router = HybridLlmRouter(
        settings,
        ollama=local,
        openai=FakeLlmProvider("openai", "cloud", configured=False),
        metrics=LlmRoutingMetrics(str(tmp_path / "events.jsonl")),
    )
    gateway = LlmGateway(settings, router=router)

    first = gateway.generate(
        "Resuma este documento interno.",
        project_id="project-a",
        agent_id="documentation",
        tool_name="unit-test",
    )
    second = gateway.generate(
        "Resuma este documento interno.",
        project_id="project-a",
        agent_id="documentation",
        tool_name="unit-test",
    )

    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert len(local.calls) == 1
    assert first["gateway"]["policy_enforced"] is True
    assert "project-a" in (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
    assert gateway.metrics.summary()["requests"] == 2


def test_llm_gateway_blocks_cloud_without_human_approval(tmp_path):
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(tmp_path / "events.jsonl"),
        llm_gateway_cache_path=str(tmp_path / "cache.jsonl"),
        llm_gateway_audit_path=str(tmp_path / "audit.jsonl"),
    )
    gateway = LlmGateway(
        settings,
        router=HybridLlmRouter(
            settings,
            ollama=FakeLlmProvider("ollama", "local"),
            openai=FakeLlmProvider("openai", "cloud"),
            metrics=LlmRoutingMetrics(str(tmp_path / "events.jsonl")),
        ),
    )

    with pytest.raises(LlmGatewayError, match="human_approved"):
        gateway.generate("Realize uma arquitetura critica de producao.", allow_cloud=True)


def test_llm_gateway_enforces_cloud_token_budget(tmp_path):
    events = tmp_path / "events.jsonl"
    events.write_text(
        json.dumps({"provider": "openai", "total_tokens": 95}) + "\n",
        encoding="utf-8",
    )
    settings = Settings(
        openai_api_key="configured",
        llm_routing_metrics_path=str(events),
        llm_gateway_cache_path=str(tmp_path / "cache.jsonl"),
        llm_gateway_audit_path=str(tmp_path / "audit.jsonl"),
        llm_gateway_daily_cloud_token_budget=100,
        llm_gateway_per_request_cloud_token_budget=1000,
    )
    gateway = LlmGateway(
        settings,
        router=HybridLlmRouter(
            settings,
            ollama=FakeLlmProvider("ollama", "local"),
            openai=FakeLlmProvider("openai", "cloud"),
            metrics=LlmRoutingMetrics(str(events)),
        ),
    )

    with pytest.raises(LlmGatewayError, match="Daily cloud token budget"):
        gateway.decide(
            "Realize uma arquitetura critica de producao.",
            allow_cloud=True,
            human_approved=True,
        )


def test_required_agent_roles_are_registered():
    expected = set(SCALABLE_SWARM_AGENTS)
    ids = {agent["id"] for agent in AGENT_CATALOG}
    assert len(ids) == 60
    assert ids == expected
    core_ids = {agent["id"] for agent in AGENT_CATALOG if agent["tier"] == "core"}
    specialist_ids = {agent["id"] for agent in AGENT_CATALOG if agent["tier"] == "specialist"}
    assert core_ids == set(REQUIRED_PARALLEL_AGENTS)
    assert specialist_ids == set(SPECIALIST_AGENT_POOL)
    required_fields = {"objective", "tools", "memory", "context", "boundaries", "success_criteria"}
    for agent in AGENT_CATALOG:
        assert required_fields.issubset(agent)
        assert agent["tools"]
        assert agent["success_criteria"]


def test_memory_is_hybrid_and_semantic_ready():
    status = MemoryService().status()
    assert status["backend"] == "hybrid"
    assert status["semantic_search"]["enabled"] is True


def test_swarm_contract_is_enterprise_ready():
    status = SwarmService().status()
    assert status["topology"] == "hierarchical-mesh"
    assert status["coordination"] == "distributed"
    assert status["max_agents"] == 60
    assert status["core_agent_count"] == 15
    assert status["specialist_agent_count"] == 45
    assert status["model_routing"]["mode"] == "governed_on_demand"
    assert status["model_routing"]["local_provider"] == "ollama"


def test_project_factory_workflow_exists():
    ids = {workflow["id"] for workflow in WORKFLOW_CATALOG}
    assert "new-ai-project" in ids


def test_runtime_manifest_matches_required_agent_count():
    manifest = load_runtime_manifest()
    assert manifest["swarm"]["topology"] == "hierarchical-mesh"
    assert manifest["swarm"]["max_agents"] == 60
    assert manifest["swarm"]["core_agent_count"] == 15
    assert manifest["swarm"]["specialist_agent_count"] == 45
    assert manifest["swarm"]["activation_policy"] == "cost_aware_core_subset_and_route_specialists_on_demand"
    assert len(manifest["validation"]["required_agents"]) == 15
    assert len(manifest["validation"]["specialist_agents"]) == 45
    assert tuple(manifest["validation"]["required_agents"]) == REQUIRED_PARALLEL_AGENTS
    assert tuple(manifest["validation"]["specialist_agents"]) == SPECIALIST_AGENT_POOL
    assert PROJECT_SWARM_AGENTS == list(REQUIRED_PARALLEL_AGENTS)
    assert "config/ai_ml_enterprise_spec.json" in manifest["validation"]["required_practice_paths"]
    assert "config/context_policy.json" in manifest["validation"]["required_practice_paths"]
    assert "config/data_treatment_policy.json" in manifest["validation"]["required_practice_paths"]
    assert "prompts/master_data_treatment.md" in manifest["validation"]["required_practice_paths"]
    assert "prompts/codex_data_treatment_dialog.md" in manifest["validation"]["required_practice_paths"]
    assert "config/cost_optimization_policy.json" in manifest["validation"]["required_practice_paths"]
    assert "config/agent_trust_framework.json" in manifest["validation"]["required_practice_paths"]
    assert "config/agent_fleets.json" in manifest["validation"]["required_practice_paths"]
    assert "config/agent_blueprint_contract.json" in manifest["validation"]["required_practice_paths"]
    assert "config/agentic_architectural_patterns.json" in manifest["validation"]["required_practice_paths"]
    assert "config/agent_improvement_loop.json" in manifest["validation"]["required_practice_paths"]
    assert "config/llm_solution_factory_policy.json" in manifest["validation"]["required_practice_paths"]
    assert "config/ml_foundations_policy.json" in manifest["validation"]["required_practice_paths"]
    assert "config/business_solution_catalog.json" in manifest["validation"]["required_practice_paths"]
    assert "docs/specifications/llm_solution_factory_governance.md" in manifest["validation"]["required_practice_paths"]
    assert "docs/specifications/technology_layer.md" in manifest["validation"]["required_practice_paths"]
    assert "docs/specifications/ml_foundations.md" in manifest["validation"]["required_practice_paths"]
    assert "scripts/analyze_business_solution.py" in manifest["validation"]["required_practice_paths"]
    assert "scripts/context_filter.py" in manifest["validation"]["required_practice_paths"]
    assert "scripts/market_radar.py" in manifest["validation"]["required_practice_paths"]
    assert "scripts/test_local_llm.py" in manifest["validation"]["required_practice_paths"]
    assert "scripts/synapse_ollama_mcp.py" in manifest["validation"]["required_practice_paths"]
    assert ".codex/config.toml" in manifest["validation"]["required_practice_paths"]
    assert "config/model_providers.json" in manifest["validation"]["required_practice_paths"]
    assert manifest["local_llm"]["provider"] == "ollama"
    assert manifest["local_llm"]["routing_strategy"] == "local_first"
    assert manifest["local_llm"]["all_60_agents_model_access"] == "governed_on_demand"
    assert manifest["local_llm"]["ruflo_shared_memory_namespace"] == "synapse-governed-execution"
    assert "docs/radar/README.md" in manifest["validation"]["required_practice_paths"]
    assert "docs/architecture/agentic-mesh-governance.md" in manifest["validation"]["required_practice_paths"]
    assert "docs/architecture/agentic-architectural-patterns.md" in manifest["validation"]["required_practice_paths"]
    assert manifest["cost_optimization"]["enabled"] is True
    assert manifest["cost_optimization"]["activate_all_60_requires_explicit_high_complexity"] is True
    assert manifest["agentic_mesh"]["enabled"] is True
    assert manifest["agentic_mesh"]["trust_layers"] == 7
    assert manifest["agentic_mesh"]["fleet_count"] >= 6
    assert manifest["agentic_mesh"]["agent_blueprint_contract_file"] == "config/agent_blueprint_contract.json"
    assert manifest["agentic_mesh"]["architectural_patterns_file"] == "config/agentic_architectural_patterns.json"
    assert manifest["agentic_architectural_patterns"]["enabled"] is True
    assert "model-router" in manifest["agentic_architectural_patterns"]["patterns"]
    assert manifest["agentic_mesh"]["improvement_loop_file"] == "config/agent_improvement_loop.json"
    assert manifest["agentic_mesh"]["human_approval_required_for_all_60_agents"] is True
    assert manifest["assistant_channels"]["enabled"] is True
    assert manifest["assistant_channels"]["authorized_user_request_channels"] == [
        "VS Code Chat",
        "AdoneX",
        "Claude Code",
        "Codex",
    ]
    assert "chat channels before using tasks" in manifest["assistant_channels"]["content_collection_rule"]
    assert manifest["assistant_channels"]["shared_solution_factory_access"]["technology_catalog"] == "config/ai_framework_selection.json"
    assert manifest["assistant_channels"]["shared_solution_factory_access"]["business_analyzer"] == "backend/app/services/business_solution_analyzer.py"
    assert manifest["assistant_channels"]["shared_solution_factory_access"]["ml_foundations_policy"] == "config/ml_foundations_policy.json"
    assert manifest["assistant_channels"]["shared_solution_factory_access"]["shared_dialog_memory"] == ".adonex/memory/SHARED_DIALOG_MEMORY.md"


def test_llm_solution_factory_policy_guides_all_dialog_assistants():
    root = Path(__file__).resolve().parents[1]
    policy = json.loads((root / "config" / "llm_solution_factory_policy.json").read_text(encoding="utf-8-sig"))
    governance = (root / "docs" / "specifications" / "llm_solution_factory_governance.md").read_text(encoding="utf-8-sig")
    agents = (root / "AGENTS.md").read_text(encoding="utf-8-sig")
    claude = (root / "CLAUDE.md").read_text(encoding="utf-8-sig")
    codex_config = (root / ".codex" / "config.toml").read_text(encoding="utf-8-sig")
    adonex_orchestrator = (root / "adonex" / "src" / "agent" / "agentOrchestrator.ts").read_text(encoding="utf-8-sig")
    adonex_memory = (root / "adonex" / "src" / "memory" / "memoryFiles.ts").read_text(encoding="utf-8-sig")

    assert policy["dialog_first"]["required"] is True
    assert policy["dialog_first"]["authorized_user_request_channels"] == [
        "VS Code Chat",
        "AdoneX chat participant",
        "Claude Code chat/terminal",
        "Codex chat",
    ]
    assert "goals, constraints, files, decisions, approvals" in policy["dialog_first"]["content_collection_rule"]
    assert "browser UI" in policy["dialog_first"]["non_primary_channels"]
    assert policy["missing_information_protocol"]["required"] is True
    assert "business_problem" in policy["missing_information_protocol"]["do_not_guess"]
    assert "success_metric_or_acceptance_criteria" in policy["missing_information_protocol"]["do_not_guess"]
    assert "Codex" in policy["applies_to"]
    assert "Claude Code" in policy["applies_to"]
    assert "AdoneX" in policy["applies_to"]
    assert "VS Code chat" in policy["applies_to"]
    assert "scripts/analyze_business_solution.py" in policy["source_of_truth"]["analyzer_cli"]
    assert policy["source_of_truth"]["technology_catalog"] == "config/ai_framework_selection.json"
    assert policy["source_of_truth"]["technology_layer_spec"] == "docs/specifications/technology_layer.md"
    assert policy["source_of_truth"]["ml_foundations_policy"] == "config/ml_foundations_policy.json"
    assert "config/business_solution_analysis.json" in policy["validation"]["project_required_paths"]
    assert "config/ml_foundations_policy.json" in policy["validation"]["project_required_paths"]
    assert "caixa de dialogo" in governance
    assert "Canais autorizados para conteudo solicitado pelo usuario" in governance
    assert "antes de implementar" in governance
    assert "config/llm_solution_factory_policy.json" in agents
    assert "Canais autorizados para conteudo solicitado pelo usuario" in agents
    assert "pergunte ao usuario" in agents
    assert "config/llm_solution_factory_policy.json" in claude
    assert "Canais autorizados para conteudo solicitado pelo usuario" in claude
    assert "pergunte ao usuario" in claude
    assert "config/llm_solution_factory_policy.json" in codex_config
    assert "canais autorizados para conteudo solicitado pelo usuario" in codex_config
    assert "pergunte ao usuario" in codex_config
    assert "config/llm_solution_factory_policy.json" in adonex_orchestrator
    assert "pergunte ao usuario" in adonex_orchestrator
    assert "config/llm_solution_factory_policy.json" in adonex_memory
    assert "Authorized channels for user-requested corporate solution content" in adonex_memory
    assert "ask the user before implementation" in adonex_memory


def test_enterprise_ai_ml_spec_declares_required_execution_contract():
    service = EnterpriseSpecService()
    spec = service.spec()
    alignment = service.validate_runtime_alignment()

    assert spec["execution_policy"]["specification_driven_development"] is True
    assert spec["execution_policy"]["ruflo_required_for_project_creation"] is True
    assert spec["execution_policy"]["ruflo_15_agents_required_for_all_universes"] is True
    assert spec["execution_policy"]["data_treatment_required_for_all_universes"] is True
    assert spec["execution_policy"]["parallel_agent_count"] == 15
    assert spec["execution_policy"]["max_agent_count"] == 60
    assert spec["execution_policy"]["specialist_agent_count"] == 45
    assert spec["execution_policy"]["cost_aware_orchestration_required"] is True
    assert spec["execution_policy"]["default_active_agent_count"] == 1
    assert spec["execution_policy"]["activate_all_60_requires_explicit_high_complexity"] is True
    assert spec["cost_aware_orchestration"]["enabled"] is True
    assert "define_architecture" in service.required_request_steps()
    assert "multi_query_retrieval" in spec["rag_advanced"]["strategies"]
    assert "graph_rag" in spec["rag_advanced"]["strategies"]
    assert "drift_monitoring" in spec["ml_systems"]["required_design_fields"]
    assert spec["ml_systems"]["foundations_policy_path"] == "config/ml_foundations_policy.json"
    assert "learning_problem_mapping" in spec["ml_systems"]["required_design_fields"]
    assert "statistical_validation_complete" in spec["ml_systems"]["quality_gates"]
    assert "structured_logs" in spec["production_readiness"]["required_validations"]
    assert spec["ai_framework_selection"]["catalog_path"] == "config/ai_framework_selection.json"
    assert len(spec["ai_framework_selection"]["required_frameworks"]) == 14
    assert "openai-agents-sdk" in spec["ai_framework_selection"]["required_frameworks"]
    assert "autogen" in spec["ai_framework_selection"]["required_frameworks"]
    assert "mcp-sdks" in spec["ai_framework_selection"]["required_frameworks"]
    assert spec["technology_layer"]["enabled"] is True
    assert spec["technology_layer"]["catalog_section"] == "technology_catalog"
    assert "firecrawl" in spec["technology_layer"]["required_technologies"]
    assert "architecture_blueprint" in spec["technology_layer"]["selection_outputs"]
    assert alignment["aligned"] is True
    assert alignment["actual_max_agents"] == 60
    assert alignment["specialist_agent_count"] == 45
    assert alignment["cost_aware_orchestration_required"] is True


def test_ml_foundations_policy_translates_user_book_into_operational_gates():
    root = Path(__file__).resolve().parents[1]
    policy = json.loads((root / "config" / "ml_foundations_policy.json").read_text(encoding="utf-8-sig"))
    spec = (root / "docs" / "specifications" / "ml_foundations.md").read_text(encoding="utf-8-sig")
    model_card = (root / "ml_systems" / "model_card_template.md").read_text(encoding="utf-8-sig")
    book_map = (root / "docs" / "books" / "implementation_map.md").read_text(encoding="utf-8-sig")

    gate_ids = {gate["id"] for gate in policy["required_reasoning_gates"]}
    assert policy["schema"] == "synapse-ml-foundations-policy.v1"
    assert {"learning_problem_mapping", "hypothesis_space_and_bias", "statistical_validation"} <= gate_ids
    assert "classification_scoring" in policy["algorithm_guidance"]
    assert "naive_bayes_baseline" in policy["algorithm_guidance"]["classification_scoring"]["missing_candidates_to_consider"]
    assert "docs/specifications/ml_foundations.md" in policy["required_artifacts"]
    assert "Required Gates" in spec
    assert "Learning Problem" in model_card
    assert "Foundations of Machine Learning" in book_map


def test_cost_aware_router_keeps_60_available_without_defaulting_to_60_active():
    router = CostAwareRouter()
    route = router.route("Criar projeto IA com RAG, MCP e baixo custo de tokens", universe="IA")

    assert route["max_available_agents"] == 60
    assert route["active_agent_count"] < 60
    assert route["active_agent_count"] <= route["active_agent_limit"]
    assert route["active_agent_count"] == len(route["core_agents"]) + len(route["specialist_agents"])
    assert route["profile"] in {"advanced", "enterprise"}
    assert route["agent_architecture_decision"]["mode"] in {"multiagent", "fleet"}
    assert route["token_controls"]["prefer_prompt_cache"] is True
    assert route["token_controls"]["compress_context_before_llm"] is True
    assert "cost-optimizer" in route["specialist_agents"]


def test_agentic_mesh_governance_validates_trust_layers_and_fleets():
    service = AgenticMeshGovernanceService()
    validation = service.validate()
    route = service.fleet_for_request("Criar novo projeto IA com RAG, MCP e baixo custo", universe="IA")

    assert validation["valid"] is True
    assert len(validation["trust_layer_ids"]) == 7
    assert "project_factory_fleet" in validation["fleet_ids"]
    assert "rag_fleet" in validation["fleet_ids"]
    assert route["selected_fleet"]["id"] in {"project_factory_fleet", "rag_fleet", "mcp_fleet", "cost_optimization_fleet"}
    assert route["requires_human_approval_for_all_60_agents"] is True


def test_agent_blueprint_contract_decides_single_agent_and_multiagent_modes():
    service = AgentBlueprintService()
    validation = service.validate_contracts()
    simple = service.decide_architecture("corrigir uma funcao simples", universe="IA")
    advanced = service.build_blueprint("criar RAG com MCP e seguranca", universe="IA")

    assert validation["valid"] is True
    assert simple["mode"] == "single_agent"
    assert advanced["architecture_decision"]["mode"] in {"multiagent", "fleet"}
    assert advanced["model_strategy"]["local_first"] is True
    assert advanced["authority_level"] == "advisory"
    assert "on_model_routed" in advanced["lifecycle_callbacks"]
    assert advanced["a2a_message_contract"]["transport"] == "synapse-peers"
    assert "claude" in advanced["improvement_loop"]["teacher_review"]["providers"]


def test_rag_pipeline_plan_uses_advanced_enterprise_strategies():
    plan = RagPipeline().plan()

    assert "multi_query_retrieval" in plan["retrieval"]
    assert "hybrid_search" in plan["retrieval"]
    assert "graph_rag" in plan["retrieval"]
    assert plan["chunking"]["parent_child_enabled"] is True
    assert "qdrant" in plan["compatible_vector_databases"]
    assert "faithfulness" in plan["evaluation"]


def test_runtime_enterprise_spec_endpoint_is_available():
    client = TestClient(app)
    spec_response = client.get("/runtime/enterprise-spec")
    alignment_response = client.get("/runtime/enterprise-spec/alignment")

    assert spec_response.status_code == 200
    assert spec_response.json()["execution_policy"]["parallel_agent_count"] == 15
    assert spec_response.json()["execution_policy"]["max_agent_count"] == 60
    assert alignment_response.status_code == 200
    assert alignment_response.json()["aligned"] is True


def test_ai_framework_selector_has_required_frameworks_and_selects_by_scenario():
    selector = AiFrameworkSelector()
    framework_ids = [framework["id"] for framework in selector.list_frameworks()]
    technology_ids = [technology["id"] for technology in selector.list_technologies()]

    assert framework_ids == [
        "langgraph",
        "llamaindex",
        "haystack",
        "openai-agents-sdk",
        "pydantic-ai",
        "crewai",
        "autogen",
        "microsoft-agent-framework-semantic-kernel",
        "dify",
        "flowise",
        "ragflow",
        "r2r",
        "mcp-sdks",
        "swarms",
    ]
    assert {
        "crewai",
        "swarms",
        "langchain",
        "langgraph",
        "langflow",
        "flowise",
        "dify",
        "n8n",
        "firecrawl",
        "deep-research",
        "awesome-lists",
        "vector-dbs",
        "rag-frameworks",
        "kag-knowledge-graph",
        "mlflow",
        "fastapi",
        "ollama",
        "mcp-servers",
    }.issubset(set(technology_ids))

    rag_selection = selector.select(
        "Criar agentes com RAG, documentos, citations, MCP e tool calling",
        universe="hybrid",
    )
    assert rag_selection["active"] is True
    assert "llamaindex" in rag_selection["recommended_framework_ids"]
    assert "haystack" in rag_selection["recommended_framework_ids"]
    assert "mcp-sdks" in rag_selection["recommended_framework_ids"]
    assert rag_selection["rag_blueprint"]["candidate_frameworks"]
    assert "rag-frameworks" in rag_selection["technology_layer"]["recommended_technology_ids"]
    assert "mcp-servers" in rag_selection["technology_layer"]["recommended_technology_ids"]
    assert rag_selection["architecture_blueprint"]["local_first"] is True
    assert any(pipeline["id"] == "rag" for pipeline in rag_selection["pipeline_blueprints"])

    ml_selection = selector.select("Treinar um classificador de churn", universe="ml")
    assert ml_selection["active"] is False
    assert ml_selection["technology_layer"]["active"] is True
    assert "mlflow" in ml_selection["technology_layer"]["recommended_technology_ids"]


def test_runtime_ai_framework_endpoints_are_available():
    client = TestClient(app)
    catalog_response = client.get("/runtime/ai-frameworks")
    select_response = client.get(
        "/runtime/ai-frameworks/select",
        params={"q": "workflow com agentes, RAG e MCP", "universe": "IA"},
    )

    assert catalog_response.status_code == 200
    assert len(catalog_response.json()["frameworks"]) == 14
    assert len(catalog_response.json()["technology_catalog"]) >= 18
    assert select_response.status_code == 200
    assert select_response.json()["active"] is True
    assert "mcp-sdks" in select_response.json()["recommended_framework_ids"]
    assert "technology_layer" in select_response.json()


def test_runtime_cost_aware_endpoints_are_available():
    client = TestClient(app)
    policy_response = client.get("/runtime/cost-policy")
    route_response = client.get(
        "/runtime/cost-aware-route",
        params={"q": "criar solucao hibrida com RAG e reduzir tokens", "universe": "hybrid"},
    )

    assert policy_response.status_code == 200
    assert policy_response.json()["ruflo"]["max_available_agents"] == 60
    assert policy_response.json()["ruflo"]["default_active_agents"] == 1
    assert route_response.status_code == 200
    assert route_response.json()["active_agent_count"] < 60
    assert route_response.json()["token_controls"]["prefer_prompt_cache"] is True


def test_agentic_mesh_endpoints_are_available():
    client = TestClient(app)
    trust_response = client.get("/agents/trust-framework")
    fleets_response = client.get("/agents/fleets", params={"universe": "IA"})
    governance_response = client.get("/agents/governance")
    route_response = client.get(
        "/agents/fleets/route",
        params={"q": "criar RAG com MCP e seguranca", "universe": "IA"},
    )
    blueprint_contract_response = client.get("/agents/blueprint-contract")
    blueprint_response = client.get(
        "/agents/blueprints/build",
        params={"q": "criar RAG com MCP e seguranca", "universe": "IA"},
    )

    assert trust_response.status_code == 200
    assert len(trust_response.json()["layers"]) == 7
    assert fleets_response.status_code == 200
    assert any(fleet["id"] == "rag_fleet" for fleet in fleets_response.json())
    assert governance_response.status_code == 200
    assert governance_response.json()["enabled"] is True
    assert route_response.status_code == 200
    assert route_response.json()["requires_human_approval_for_all_60_agents"] is True
    assert blueprint_contract_response.status_code == 200
    assert blueprint_contract_response.json()["valid"] is True
    assert blueprint_response.status_code == 200
    assert blueprint_response.json()["fleet"]
    assert blueprint_response.json()["architecture_decision"]["mode"] in {"multiagent", "fleet"}


def test_ruflo_service_reports_unavailable_when_mcp_fails():
    service = RufloService(client=FailingClient())
    result = service.swarm_status()
    assert result["available"] is False
    assert result["tool"] == "swarm_status"


def test_ruflo_service_calls_workflow_execution_tool():
    client = RecordingClient()
    service = RufloService(client=client)
    result = service.execute_workflow("rag-build", ["rag-engineering"], True)
    assert result["available"] is True
    assert client.calls == [
        (
            "daa_workflow_execute",
            {
                "workflowId": "rag-build",
                "agentIds": ["rag-engineering"],
                "parallelExecution": True,
            },
        )
    ]


def test_ruflo_workflow_files_exist_for_required_workflows():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    for workflow_id in ("new-ai-project", "rag-build", "ml-release"):
        assert (root / "config" / "workflows" / "ruflo" / f"{workflow_id}.json").exists()


def test_new_project_workflow_declares_parallel_agent_activation():
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    workflow = json.loads((root / "config" / "workflows" / "ruflo" / "new-ai-project.json").read_text())
    assert workflow["execution"]["parallelAgentActivation"] is True
    parallel_agent_list = [
        agent
        for group in workflow["execution"]["parallelGroups"]
        for agent in group
    ]
    parallel_agents = set(parallel_agent_list)
    assert len(parallel_agents) == 15
    assert len(parallel_agent_list) == len(parallel_agents)
    assert parallel_agents == set(REQUIRED_PARALLEL_AGENTS)
    step_agents = {step["agent"] for step in workflow["steps"]}
    assert set(REQUIRED_PARALLEL_AGENTS).issubset(step_agents)
    manifest = load_runtime_manifest()
    yaml_text = (root / "agents" / "definitions" / "enterprise_agents.yaml").read_text(encoding="utf-8-sig")
    for agent_id in manifest["validation"]["specialist_agents"]:
        assert f"id: {agent_id}" in yaml_text


def test_project_factory_script_creates_solution_projects_without_platform_stack():
    root = Path(__file__).resolve().parents[1]
    script = _read_factory_sources(root)
    assert "max_agents: 60" in script
    assert "specialist_agent_count: 45" in script
    assert "LocalMemoryOnly" in script
    assert "ActiveAgentLimit" in script
    assert "activation_policy: cost_aware_core_subset_and_route_specialists_on_demand" in script
    assert "Configure-EnterpriseSpec" in script
    assert "ai_ml_enterprise_spec.json" in script
    assert "ai_framework_selection.json" in script
    assert "cost_optimization_policy.json" in script
    assert "Configure-CostOptimizationPolicy" in script
    assert "agent_trust_framework.json" in script
    assert "agent_fleets.json" in script
    assert "agent_blueprint_contract.json" in script
    assert "agentic_architectural_patterns.json" in script
    assert "agent_improvement_loop.json" in script
    assert "Configure-AgenticMeshGovernance" in script
    assert "Configure-LocalAiRuntime" in script
    assert "OLLAMA_MODEL=qwen2.5-coder:3b" in script
    assert "OLLAMA_GENERAL_MODEL=qwen3:8b" in script
    assert "OLLAMA_BALANCED_MODEL=deepseek-coder-v2:lite" in script
    assert "OLLAMA_CODE_REVIEW_MODEL=deepseek-coder-v2:lite" in script
    assert "OLLAMA_CODE_STRONG_MODEL=qwen2.5-coder:14b" in script
    assert "OLLAMA_PLANNING_STRONG_MODEL=qwen3:14b" in script
    assert "OLLAMA_REASONING_STRONG_MODEL=deepseek-r1:14b" in script
    assert "OLLAMA_LARGE_MODEL=qwen2.5-coder:32b" in script
    assert "docs/ollama-offline-models.md" in script
    assert "governed_on_demand" in script
    assert "continual_learning" in script
    assert "automatic_weight_updates = $false" in script
    assert "docs\\specifications\\agentic_mesh_governance.md" in script
    assert "docs\\specifications\\agentic_architectural_patterns.md" in script
    assert "docs\\checklists\\agent_fleet_certification.md" in script
    assert "docs\\runbooks\\agent_sre.md" in script
    assert "docs\\specifications\\ai_framework_selection.md" in script
    assert "docs\\specifications\\ai_ml_execution_spec.md" in script
    assert "docs/specifications/llm_solution_factory_governance.md" in script
    assert "config/llm_solution_factory_policy.json" in script
    assert "Resolve-ProjectUniverse" in script
    assert "config\\project_universe.json" in script
    assert '"backend",' in script
    assert '"frontend",' in script
    assert '"create_ai_project.ps1",' in script
    assert "Finalize-SynapseSolutionProject" in script
    assert "Configure-SolutionVsCodeTasks" in script
    assert '"Synapse: Ollama offline"' in script
    assert "factory_capable = $false" in script
    assert "contains_backend = $false" in script
    assert "contains_frontend = $false" in script


def test_vscode_eval_tasks_run_locally_and_specialists_use_one_catalog():
    root = Path(__file__).resolve().parents[1]
    ml_eval = (root / "scripts" / "run_ml_evals.ps1").read_text(encoding="utf-8-sig")
    ai_eval = (root / "scripts" / "run_ai_evals.ps1").read_text(encoding="utf-8-sig")
    swarm = (root / "scripts" / "start_ruflo_swarm.ps1").read_text(encoding="utf-8-sig")

    assert "run_evals.py" in ml_eval
    assert "run_evals.py" in ai_eval
    assert "[switch]$UseApi" in ml_eval
    assert "[switch]$UseApi" in ai_eval
    assert '-ErrorAction Stop' in ml_eval
    assert '-ErrorAction Stop' in ai_eval
    assert '"specialist.pool"' in swarm
    assert '"specialist.$($Agent.id)"' not in swarm


def test_codex_data_treatment_dialog_is_available_in_vscode_tasks():
    import json

    root = Path(__file__).resolve().parents[1]
    assert (root / "scripts" / "codex_data_treatment_dialog.ps1").exists()
    assert (root / "scripts" / "diagnose_project.ps1").exists()
    assert (root / "scripts" / "import_project_file.ps1").exists()
    assert (root / "prompts" / "codex_data_treatment_dialog.md").exists()
    tasks = json.loads((root / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    labels = {task["label"] for task in tasks["tasks"]}
    factory_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "AI Factory: Criar projeto com Codex + Ruflo economico + tratamento dados"
    )
    assert "-ActivateRuflo" in factory_task["args"]
    project_type_input = next(item for item in tasks["inputs"] if item["id"] == "projectType")
    assert project_type_input["type"] == "pickString"
    assert project_type_input["options"] == ["ML", "IA", "ML + IA (Hibrido)", "Chatbolt"]
    assert "tratamento de dados" in factory_task["detail"]
    assert "Codex: Tratar dados com Ruflo economico" in labels
    assert "AI Factory: Anexar foto ou arquivo ao projeto" in labels
    assert "Synapse: Diagnosticar projeto criado" in labels
    assert "Synapse: Market Radar + Context Filter" in labels
    assert "Synapse: Filtrar contexto para LLM/Ruflo" in labels
    diagnose_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "Synapse: Diagnosticar projeto criado"
    )
    assert "diagnose_project.ps1" in " ".join(diagnose_task["args"])
    attachment_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "AI Factory: Anexar foto ou arquivo ao projeto"
    )
    attachment_input = next(item for item in tasks["inputs"] if item["id"] == "attachmentPath")
    assert attachment_input["type"] == "promptString"
    assert "import_project_file.ps1" in " ".join(attachment_task["args"])
    radar_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "Synapse: Market Radar + Context Filter"
    )
    assert "market_radar.py" in " ".join(radar_task["args"])
    context_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "Synapse: Filtrar contexto para LLM/Ruflo"
    )
    assert "context_filter.py" in " ".join(context_task["args"])


def test_vscode_factory_task_enables_complete_bundle_for_every_universe():
    root = Path(__file__).resolve().parents[1]
    tasks = json.loads((root / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    factory_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "AI Factory: Criar projeto com Codex + Ruflo economico + tratamento dados"
    )
    project_type_input = next(item for item in tasks["inputs"] if item["id"] == "projectType")
    script = _read_factory_sources(root)

    assert project_type_input["options"] == ["ML", "IA", "ML + IA (Hibrido)", "Chatbolt"]
    assert factory_task["args"][-1] == "-ActivateRuflo"
    for capability in (
        "data_treatment_enabled = $true",
        "ruflo_max_agents = 60",
        "ruflo_specialist_agents = 45",
        "cost_aware_orchestration = $true",
        "prompts/codex_data_treatment_dialog.md",
        "config/ai_ml_enterprise_spec.json",
        "config/ai_framework_selection.json",
        "config/agent_trust_framework.json",
        "config/agent_fleets.json",
        "config/agent_blueprint_contract.json",
        "config/agent_improvement_loop.json",
        "Create-BusinessSolutionAnalysis",
        "config/business_solution_analysis.json",
        "docs/briefings/business_solution_analysis.md",
    ):
        assert capability in script
    assert any(item["id"] == "businessProblem" for item in tasks["inputs"])
    assert "-BusinessProblem" in factory_task["args"]


def test_business_solution_analyzer_maps_business_problem_to_architecture():
    analyzer = BusinessSolutionAnalyzer(root=Path(__file__).resolve().parents[1])

    churn = analyzer.analyze(
        project_goal="Criar modelo de churn",
        business_problem="Identificar clientes com risco de cancelamento e priorizar acao comercial.",
        requested_universe="ML",
        solution_focus="ml",
    )
    assert churn["recommended_universe"] == "ml"
    assert churn["ml_archetype"]["id"] == "classification_scoring"
    assert "tests/test_ml_contract.py" in churn["test_strategy"]
    assert "mlflow" in churn["technology_layer"]["recommended_technology_ids"]
    assert churn["ml_foundations"]["active"] is True
    assert churn["ml_foundations"]["policy_path"] == "config/ml_foundations_policy.json"
    assert any(gate["id"] == "learning_problem_mapping" for gate in churn["ml_foundations"]["required_reasoning_gates"])
    assert "naive_bayes_baseline" in churn["ml_foundations"]["algorithm_guidance"]["missing_candidates_to_consider"]
    assert "config/ml_foundations_policy.json" in churn["required_artifacts"]
    assert any(pipeline["id"] == "mlops" for pipeline in churn["pipeline_blueprints"])
    assert any("Designing ML Systems" in item for item in churn["book_alignment"])

    service_agent = analyzer.analyze(
        project_goal="Criar assistente de atendimento",
        business_problem="Cliente pergunta status do pedido atrasado, a IA consulta documentos, verifica sistema e abre ocorrencia.",
        requested_universe="Chatbolt",
        solution_focus="chatbots",
    )
    assert service_agent["recommended_universe"] in {"chatbolt", "hybrid"}
    assert "chatbot" in service_agent["solution_stack"]
    assert "rag" in service_agent["solution_stack"]
    assert "agents" in service_agent["solution_stack"]
    assert "rag-frameworks" in service_agent["technology_layer"]["recommended_technology_ids"]
    assert "mcp-servers" in service_agent["technology_layer"]["recommended_technology_ids"]
    assert service_agent["architecture_blueprint"]["local_first"] is True
    assert service_agent["ml_foundations"]["active"] is False


def test_business_solution_analyzer_recognizes_voice_coding_agents():
    analyzer = BusinessSolutionAnalyzer(root=Path(__file__).resolve().parents[1])

    voice_agent = analyzer.analyze(
        project_goal="Melhorar Vick e AdoneX para programacao por voz",
        business_problem="Reconhecimento de voz e edicao de codigo agentiva no IDE com testes e rollback.",
        requested_universe="hybrid",
        solution_focus="voice coding agent",
        success_metric_or_acceptance_criteria="wake abaixo de 500 ms, transcricao acima de 90%, tarefas aprovadas acima de 85%",
        available_data_or_knowledge_sources="casos de voz pt-BR e repositorios do Synapse",
        risk_level="alto",
    )

    assert voice_agent["domain"]["id"] == "developer_productivity"
    assert voice_agent["ml_archetype"]["id"] == "speech_recognition"
    assert voice_agent["ai_archetype"]["id"] == "voice_coding_agent"
    assert "wake_word_detection" in voice_agent["solution_stack"]
    assert "docs/specifications/voice_agentic_coding.md" in voice_agent["required_artifacts"]
    assert any("Speech and Language Processing" in item for item in voice_agent["book_alignment"])


def test_context_filter_reduces_noise_and_preserves_relevant_lines():
    noisy_context = "\n".join(
        [
            "DEBUG repeated setup",
            "DEBUG repeated setup",
            "node_modules/package/index.js",
            "ERROR cost token budget exceeded",
            "def important_function():",
            "A" * 200,
            "TODO add MCP observability",
        ]
    )

    filtered, report = filter_context(noisy_context, max_chars=160)

    assert "ERROR cost token budget exceeded" in filtered
    assert "important_function" in filtered
    assert "TODO add MCP observability" in filtered
    assert "node_modules" not in filtered
    assert report.output_chars <= 260
    assert report.removed_lines > 0


def test_browser_tools_match_vscode_context_data_and_radar_capabilities():
    client = TestClient(app)

    context_response = client.post(
        "/tools/context-filter",
        json={"text": "DEBUG noise\nERROR token budget\nTODO revisar MCP", "max_chars": 12000},
    )
    data_response = client.post(
        "/tools/data-treatment",
        json={
            "records": [
                {"cliente_id": 1, "receita": 100, "segmento": "A"},
                {"cliente_id": 2, "receita": None, "segmento": "B"},
                {"cliente_id": 3, "receita": 9999, "segmento": "Raro"},
            ]
        },
    )
    radar_response = client.post("/tools/market-radar", json={"offline": True})

    assert context_response.status_code == 200
    assert "ERROR token budget" in context_response.json()["filtered_text"]
    assert "DEBUG noise" not in context_response.json()["filtered_text"]
    assert data_response.status_code == 200
    assert data_response.json()["summary"]["rows_after"] == 3
    assert data_response.json()["records"]
    assert radar_response.status_code == 200
    assert radar_response.json()["fallback_used"] is True
    assert radar_response.json()["signals"]


def test_market_radar_offline_generates_prioritized_report(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    signals, raw_sources = collect_signals(offline=True)
    outputs = write_outputs(signals)

    assert raw_sources == {}
    assert signals
    assert any("cost_optimization" in signal.categories for signal in signals)
    assert any("observability" in signal.categories for signal in signals)
    assert Path(outputs["markdown"]).exists()
    assert Path(outputs["json"]).exists()
    assert "Lowfat" in Path(outputs["markdown"]).read_text(encoding="utf-8")


def test_ai_factory_menu_defaults_to_real_ruflo_activation():
    root = Path(__file__).resolve().parents[1]
    menu = (root / "scripts" / "ai_factory_menu.ps1").read_text(encoding="utf-8-sig")
    assert "Criar projeto IA/ML completo com Ruflo real + 60 agents" in menu
    assert "Criar projeto IA/ML offline apenas com memoria local" in menu
    assert "Read-ProjectUniverse" in menu
    assert "-ActivateRuflo" in menu
    assert "-LocalMemoryOnly" in menu


def test_model_service_trains_registers_and_predicts(tmp_path):
    service = ModelService(root=tmp_path)
    training = service.train(
        ModelTrainingRequest(
            model_name="Revenue Baseline",
            feature_columns=["leads", "price"],
            target_column="revenue",
            dataset=[
                {"leads": 1, "price": 10, "revenue": 20},
                {"leads": 2, "price": 10, "revenue": 30},
                {"leads": 3, "price": 10, "revenue": 40},
            ],
        )
    )

    registry = service.list_models()
    prediction = service.predict(
        training["model_id"],
        ModelPredictionRequest(features={"leads": 4, "price": 10}),
    )

    assert registry["models"][0]["id"] == training["model_id"]
    assert training["metrics"]["training_rows"] == 3
    assert training["mlflow"]["available"] in (True, False)
    assert prediction["prediction"] == pytest.approx(50)


def test_model_service_supports_jsonl_training_data(tmp_path):
    dataset_path = tmp_path / "data" / "training.jsonl"
    dataset_path.parent.mkdir(parents=True)
    dataset_path.write_text(
        "\n".join(
            [
                '{"x": 1, "target": 3}',
                '{"x": 2, "target": 5}',
                '{"x": 3, "target": 7}',
            ]
        ),
        encoding="utf-8",
    )

    service = ModelService(root=tmp_path)
    training = service.train(
        ModelTrainingRequest(
            model_name="Jsonl Baseline",
            feature_columns=["x"],
            target_column="target",
            dataset_path="data/training.jsonl",
        )
    )

    assert (tmp_path / training["artifact_path"]).exists()


def test_data_treatment_script_outputs_treated_dataset_and_report(tmp_path):
    raw_path = tmp_path / "data" / "raw" / "clientes.csv"
    output_path = tmp_path / "data" / "processed" / "clientes_treated.csv"
    report_path = tmp_path / "output" / "data_treatment" / "clientes_report.md"
    raw_path.parent.mkdir(parents=True)
    raw_path.write_text(
        "\n".join(
            [
                "Cliente ID,Receita,Segmento",
                "1,100,A",
                "2,,B",
                "2,,B",
                "3,9999,Raro",
                "4,120,A",
            ]
        ),
        encoding="utf-8",
    )

    result = treat_dataset(raw_path, output_path=output_path, report_path=report_path)

    assert result.rows_before == 5
    assert result.rows_after == 4
    assert output_path.exists()
    assert report_path.exists()
    treated = output_path.read_text(encoding="utf-8")
    report = report_path.read_text(encoding="utf-8")
    assert "receita_was_missing" in treated
    assert "receita_is_outlier_iqr" in treated
    assert "Relatorio de Tratamento Estatistico" in report
    assert "Alinhamento com prompt mestre" in report
    assert "Cobertura da politica de tratamento" in report
    assert "z_score_outlier_analysis" in report
    assert "Outliers" in report


def test_context_policy_filters_workspace_noise_before_llm_calls():
    policy = load_context_policy()
    assert is_ignored_path("node_modules/pkg/index.js", policy)
    assert is_ignored_path("frontend/.next/dev/cache/turbopack/blob.sst", policy)
    assert is_ignored_path("adonex/dist/extension.js.map", policy)
    assert is_ignored_path("output/data/report.json", policy)
    assert is_ignored_path(".codex/config.toml", policy)
    assert not is_ignored_path("backend/app/services/llm_gateway.py", policy)

    filtered, report = filter_context(
        "\n".join(
            [
                "DEBUG noisy line",
                "ERROR important failure",
                "normal useful line",
                "normal useful line",
                "A" * 180,
            ]
        ),
        max_chars=200,
        policy=policy,
    )

    assert "DEBUG noisy line" not in filtered
    assert "ERROR important failure" in filtered
    assert filtered.count("normal useful line") == 1
    assert report.removed_lines >= 2


def test_import_project_file_task_copies_image_and_writes_manifest(tmp_path):
    root = Path(__file__).resolve().parents[1]
    project = tmp_path / "attached_project"
    project.mkdir()
    source = tmp_path / "Minha Foto.PNG"
    source.write_bytes(b"fake-image")

    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(root / "scripts" / "import_project_file.ps1"),
            "-ProjectName",
            project.name,
            "-InputPath",
            str(source),
            "-DestinoBase",
            str(tmp_path),
        ],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    copied = project / "data" / "uploads" / "images" / "minha-foto.png"
    manifest = project / "docs" / "briefings" / "codex_attachments_manifest.json"
    assert copied.exists()
    assert manifest.exists()
    manifest_text = manifest.read_text(encoding="utf-8-sig")
    assert "data/uploads/images/minha-foto.png" in manifest_text
    assert '"kind":  "image"' in manifest_text or '"kind": "image"' in manifest_text


def test_diagnose_project_script_validates_generated_ia_project(tmp_path):
    root = Path(__file__).resolve().parents[1]
    project_name = "diagnose_ia_project"

    create_result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(root / "scripts" / "create_ai_project.ps1"),
            "-NomeProjeto",
            project_name,
            "-TipoProjeto",
            "IA",
            "-DestinoBase",
            str(tmp_path),
            "-SkipValidation",
            "-SkipActivation",
        ],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert create_result.returncode == 0, create_result.stderr

    diagnose_result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(root / "scripts" / "diagnose_project.ps1"),
            "-ProjectName",
            project_name,
            "-DestinoBase",
            str(tmp_path),
        ],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    project = tmp_path / project_name
    diagnostics_json = project / "output" / "project_diagnostics.json"
    diagnostics_md = project / "output" / "project_diagnostics.md"
    agentic_mesh_spec = project / "docs" / "specifications" / "agentic_mesh_governance.md"
    agentic_patterns_spec = project / "docs" / "specifications" / "agentic_architectural_patterns.md"
    fleet_certification = project / "docs" / "checklists" / "agent_fleet_certification.md"
    agent_sre = project / "docs" / "runbooks" / "agent_sre.md"
    assert diagnose_result.returncode == 0, diagnose_result.stderr
    assert not (project / "backend").exists()
    assert not (project / "frontend").exists()
    assert not (project / "scripts" / "create_ai_project.ps1").exists()
    assert (project / "agents" / "definitions" / "enterprise_agents.yaml").exists()
    assert (project / "scripts" / "start_ruflo_swarm.ps1").exists()
    assert (project / ".mcp.json").exists()
    assert (project / "config" / "data_treatment_policy.json").exists()
    assert (project / "config" / "context_policy.json").exists()
    assert (project / "config" / "agentic_architectural_patterns.json").exists()
    assert (project / "config" / "business_solution_analysis.json").exists()
    assert (project / "config" / "llm_solution_factory_policy.json").exists()
    assert (project / "docs" / "briefings" / "business_solution_analysis.md").exists()
    assert (project / "docs" / "specifications" / "llm_solution_factory_governance.md").exists()
    assert (project / "prompts" / "master_data_treatment.md").exists()
    assert (project / "tests" / "test_project_contract.py").exists()
    assert (project / "tests" / "test_evals_contract.py").exists()
    assert (project / "tests" / "test_data_contract.py").exists()
    assert (project / "AGENTS.md").exists()
    assert (project / "CLAUDE.md").exists()
    assert (project / ".adonex" / "memory" / "SHARED_DIALOG_MEMORY.md").exists()
    assert (project / ".adonex" / "memory" / "CHAT_TASKS.md").exists()
    assert (project / ".adonex" / "memory" / "AGENT_CONTEXT.md").exists()
    assert (project / ".adonex" / "memory" / "CURRENT_STATE.md").exists()
    assert (project / "docs" / "runbooks" / "adonex.md").exists()
    assert (project / "docs" / "runbooks" / "peer_messaging.md").exists()
    assert (project / "scripts" / "synapse_solution_peers_mcp.py").exists()
    assert (project / "scripts" / "start_vick.py").exists()
    assert not (project / "scripts" / "synapse_peers_mcp.py").exists()
    assert (project / "tests" / "test_project_contract.py").exists()
    assert (project / "tests" / "test_evals_contract.py").exists()
    assert (project / "tests" / "test_data_contract.py").exists()
    assert (project / ".vscode" / "settings.json").exists()
    assert (project / ".vscode" / "extensions.json").exists()
    tasks = json.loads((project / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    assert any(task["label"] == "Synapse: Rodar testes do projeto" for task in tasks["tasks"])
    vick_task = next(task for task in tasks["tasks"] if task["label"] == "Vick: Abrir assistente web automaticamente")
    assert vick_task["runOptions"]["runOn"] == "folderOpen"
    assert "--open-browser" in vick_task["args"]
    env_example = (project / ".env.example").read_text(encoding="utf-8-sig")
    assert "PROJECT_DEFAULT_ACTIVE_AGENTS=1" in env_example
    assert "PROJECT_ENTERPRISE_ACTIVE_AGENTS=8" in env_example
    mcp = json.loads((project / ".mcp.json").read_text(encoding="utf-8-sig"))
    assert mcp["mcpServers"]["synapse-peers"]["args"] == ["scripts/synapse_solution_peers_mcp.py"]
    assert mcp["mcpServers"]["synapse-peers"]["env"]["PEER_MESSAGING_MAX_MESSAGE_CHARS"] == "1200"
    settings = json.loads((project / ".vscode" / "settings.json").read_text(encoding="utf-8-sig"))
    assert settings["adonex.agent.defaultMode"] == "local"
    assert settings["adonex.ollama.model"] == "qwen2.5-coder:3b"
    assert settings["adonex.ollama.modelReasoning"] == "deepseek-coder-v2:lite"
    assert settings["adonex.ollama.modelGeneral"] == "qwen3:8b"
    assert settings["adonex.ollama.modelCodeStrong"] == "qwen2.5-coder:14b"
    assert settings["adonex.ollama.modelPlanningStrong"] == "qwen3:14b"
    assert settings["adonex.ollama.modelReasoningStrong"] == "deepseek-r1:14b"
    assert settings["adonex.ollama.modelCodeCritical"] == "qwen2.5-coder:32b"
    assert settings["adonex.ollama.embeddingModel"] == "nomic-embed-text:latest"
    assert settings["adonex.synapse.rufloCouncil.maxAgents"] == 8
    assert settings["adonex.synapse.rufloCouncil.maxChars"] == 8000
    assert settings["adonex.synapse.llmGateway.enabled"] is True
    assert settings["adonex.synapse.llmGateway.projectId"] == project_name
    assert settings["adonex.voice.startWithVSCode"] is True
    assert settings["adonex.voice.autoOpenCockpit"] is True
    assert settings["adonex.voice.wakeWord"] == "Vick"
    assert (project / "adonex" / "package.json").exists()
    assert (project / "adonex" / "src" / "extension.ts").exists()
    assert (project / "adonex" / "src" / "agent" / "agentOrchestrator.ts").exists()
    assert (project / "adonex" / "src" / "patch" / "patchEngine.ts").exists()
    assert (project / "adonex" / "src" / "patch" / "patchUtils.ts").exists()
    assert (project / "adonex" / "src" / "llm" / "localModels.ts").exists()
    assert (project / "adonex" / "src" / "tasks" / "taskFinalizer.ts").exists()
    assert (project / "adonex" / "test").exists()
    assert not (project / "adonex" / "node_modules").exists()
    assert not (project / "adonex" / "dist").exists()
    assert not (project / "config" / "workflows" / "ruflo" / "new-ai-project.json").exists()
    solution_contract = json.loads(
        (project / "config" / "synapse_solution_contract.json").read_text(encoding="utf-8-sig")
    )
    assert solution_contract["managed_by"] == "synapse"
    assert solution_contract["factory_capable"] is False
    assert solution_contract["contains_backend"] is False
    assert solution_contract["contains_frontend"] is False
    assert solution_contract["ruflo_runtime"] == "inherited"
    assert solution_contract["agents_runtime"] == "inherited"
    assert solution_contract["capabilities"] == {
        "ml": False,
        "ai": True,
        "rag": True,
        "data_treatment": True,
        "tests": True,
        "evals": True,
        "agentic_business_transformation": True,
        "human_approval_by_risk": True,
    }
    assert not (project / "ml_systems" / "model_card.md").exists()
    assert (project / "rag_pipelines").exists()
    assert diagnostics_json.exists()
    assert diagnostics_md.exists()
    assert agentic_mesh_spec.exists()
    assert agentic_patterns_spec.exists()
    assert fleet_certification.exists()
    assert agent_sre.exists()
    diagnostics = diagnostics_json.read_text(encoding="utf-8-sig")
    assert '"overall_status":  "passed"' in diagnostics or '"overall_status": "passed"' in diagnostics
    assert "ai_framework_count" in diagnostics
    assert "blueprint_contract_json" in diagnostics
    assert "improvement_loop_json" in diagnostics
    assert "agentic_mesh_spec" in diagnostics
    assert "agentic_patterns_spec" in diagnostics
    assert "agent_fleet_certification" in diagnostics
    assert "agent_sre_runbook" in diagnostics
    assert "business_solution_analysis_json" in diagnostics
    assert "business_solution_analysis_md" in diagnostics
    assert "llm_solution_factory_policy" in diagnostics
    assert "llm_solution_factory_governance" in diagnostics
    assert "runtime_assistant_inheritance" in diagnostics
    assert "runtime_shared_dialog_memory" in diagnostics
    assert "shared_dialog_memory" in diagnostics
    assert "chat_tasks_memory" in diagnostics
    assert "mcp_peer_standalone_script" in diagnostics
    assert "adonex_local_mode" in diagnostics
    assert "master_data_treatment_prompt" in diagnostics


@pytest.mark.parametrize(
    ("project_type", "project_name", "expected_capabilities"),
    [
        ("ML", "generated_ml_project", {"ml": True, "ai": False, "rag": False, "data_treatment": True}),
        (
            "ML + IA (Hibrido)",
            "generated_hybrid_project",
            {"ml": True, "ai": True, "rag": True, "data_treatment": True},
        ),
        (
            "Chatbolt",
            "generated_chatbolt_project",
            {"ml": False, "ai": True, "rag": True, "data_treatment": True},
        ),
    ],
)
def test_generated_solution_project_matches_selected_universe(
    tmp_path,
    project_type,
    project_name,
    expected_capabilities,
):
    root = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(root / "scripts" / "create_ai_project.ps1"),
            "-NomeProjeto",
            project_name,
            "-TipoProjeto",
            project_type,
            "-DestinoBase",
            str(tmp_path),
            "-SkipActivation",
        ],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    project = tmp_path / project_name
    contract = json.loads((project / "config" / "synapse_solution_contract.json").read_text(encoding="utf-8-sig"))
    assert {
        key: contract["capabilities"][key]
        for key in ("ml", "ai", "rag", "data_treatment")
    } == expected_capabilities
    assert contract["capabilities"]["agentic_business_transformation"] is True
    assert contract["capabilities"]["human_approval_by_risk"] is True
    assert not (project / "backend").exists()
    assert not (project / "frontend").exists()
    assert not (project / "scripts" / "create_ai_project.ps1").exists()
    assert (project / "scripts" / "start_ruflo_swarm.ps1").exists()
    assert (project / "agents" / "definitions" / "enterprise_agents.yaml").exists()
    assert (project / ".mcp.json").exists()
    assert (project / "config" / "data_treatment_policy.json").exists()
    assert (project / "config" / "context_policy.json").exists()
    assert (project / "config" / "business_solution_analysis.json").exists()
    assert (project / "config" / "llm_solution_factory_policy.json").exists()
    assert (project / "docs" / "briefings" / "business_solution_analysis.md").exists()
    assert (project / "docs" / "specifications" / "llm_solution_factory_governance.md").exists()
    assert (project / "prompts" / "master_data_treatment.md").exists()
    assert (project / "AGENTS.md").exists()
    assert (project / "CLAUDE.md").exists()
    assert (project / ".adonex" / "memory" / "SHARED_DIALOG_MEMORY.md").exists()
    assert (project / ".adonex" / "memory" / "CHAT_TASKS.md").exists()
    assert (project / "docs" / "runbooks" / "adonex.md").exists()
    assert (project / "docs" / "runbooks" / "peer_messaging.md").exists()
    assert (project / "scripts" / "synapse_solution_peers_mcp.py").exists()
    assert (project / "scripts" / "start_vick.py").exists()
    assert not (project / "scripts" / "synapse_peers_mcp.py").exists()
    assert (project / ".vscode" / "settings.json").exists()
    assert (project / ".vscode" / "extensions.json").exists()
    tasks = json.loads((project / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    assert any(task["label"] == "Synapse: Rodar testes do projeto" for task in tasks["tasks"])
    assert any(
        task["label"] == "Vick: Abrir assistente web automaticamente"
        and task["runOptions"]["runOn"] == "folderOpen"
        and "--open-browser" in task["args"]
        for task in tasks["tasks"]
    )
    env_example = (project / ".env.example").read_text(encoding="utf-8-sig")
    assert "PROJECT_DEFAULT_ACTIVE_AGENTS=1" in env_example
    assert "PROJECT_ENTERPRISE_ACTIVE_AGENTS=8" in env_example
    mcp = json.loads((project / ".mcp.json").read_text(encoding="utf-8-sig"))
    assert mcp["mcpServers"]["synapse-peers"]["args"] == ["scripts/synapse_solution_peers_mcp.py"]
    assert "scripts/synapse_peers_mcp.py" not in mcp["mcpServers"]["synapse-peers"]["args"]
    runtime = json.loads((project / "config" / "runtime_manifest.json").read_text(encoding="utf-8-sig"))
    assert runtime["assistant_inheritance"]["enabled"] is True
    assert runtime["assistant_inheritance"]["user_request_channels"] == [
        "VS Code Chat",
        "AdoneX",
        "Claude Code",
        "Codex",
    ]
    assert "chats autorizados antes de usar tasks" in runtime["assistant_inheritance"]["content_collection_rule"]
    assert runtime["assistant_inheritance"]["shared_solution_factory_access"]["policy"] == "config/llm_solution_factory_policy.json"
    assert runtime["assistant_inheritance"]["shared_solution_factory_access"]["technology_catalog"] == "config/ai_framework_selection.json"
    assert runtime["assistant_inheritance"]["shared_solution_factory_access"]["shared_dialog_memory"] == ".adonex/memory/SHARED_DIALOG_MEMORY.md"
    assert runtime["assistant_inheritance"]["peer_messaging"]["script"] == "scripts/synapse_solution_peers_mcp.py"
    assert runtime["assistant_inheritance"]["shared_dialog_memory"]["enabled"] is True
    assert runtime["assistant_inheritance"]["shared_dialog_memory"]["persistent_context"] == ".adonex/memory/SHARED_DIALOG_MEMORY.md"
    assert runtime["assistant_inheritance"]["shared_dialog_memory"]["chat_tasks"] == ".adonex/memory/CHAT_TASKS.md"
    assert runtime["assistant_inheritance"]["vick"]["enabled"] is True
    assert runtime["assistant_inheritance"]["vick"]["browser_assistant"] == "scripts/start_vick.py"
    assert runtime["assistant_inheritance"]["vick"]["wake_word"] == "Vick"
    assert "config/business_solution_analysis.json" in runtime["validation"]["required_practice_paths"]
    assert "scripts/start_vick.py" in runtime["validation"]["required_practice_paths"]
    assert ".adonex/memory/SHARED_DIALOG_MEMORY.md" in runtime["validation"]["required_practice_paths"]
    assert ".adonex/memory/CHAT_TASKS.md" in runtime["validation"]["required_practice_paths"]
    assert "config/llm_solution_factory_policy.json" in runtime["validation"]["required_practice_paths"]
    assert "docs/specifications/llm_solution_factory_governance.md" in runtime["validation"]["required_practice_paths"]
    generated_agents = (project / "AGENTS.md").read_text(encoding="utf-8-sig")
    generated_claude = (project / "CLAUDE.md").read_text(encoding="utf-8-sig")
    generated_adonex = (project / "docs" / "runbooks" / "adonex.md").read_text(encoding="utf-8-sig")
    assert "Canais autorizados para conteudo solicitado pelo usuario" in generated_agents
    assert "Canais autorizados para conteudo solicitado pelo usuario" in generated_claude
    assert "Canais autorizados para conteudo solicitado pelo usuario" in generated_adonex
    analysis = json.loads((project / "config" / "business_solution_analysis.json").read_text(encoding="utf-8-sig"))
    assert analysis["requested_universe"] in {"ml", "ia", "chatbolt", "hybrid"}
    assert analysis["architecture_decision"]
    assert "tests/test_project_contract.py" in analysis["test_strategy"]
    settings = json.loads((project / ".vscode" / "settings.json").read_text(encoding="utf-8-sig"))
    assert settings["adonex.agent.defaultMode"] == "local"
    assert settings["adonex.ollama.model"] == "qwen2.5-coder:3b"
    assert settings["adonex.ollama.modelReasoning"] == "deepseek-coder-v2:lite"
    assert settings["adonex.ollama.modelGeneral"] == "qwen3:8b"
    assert settings["adonex.ollama.modelCodeReview"] == "deepseek-coder-v2:lite"
    assert settings["adonex.ollama.modelCodeStrong"] == "qwen2.5-coder:14b"
    assert settings["adonex.ollama.modelPlanningStrong"] == "qwen3:14b"
    assert settings["adonex.ollama.modelReasoningStrong"] == "deepseek-r1:14b"
    assert settings["adonex.ollama.modelCodeCritical"] == "qwen2.5-coder:32b"
    assert settings["adonex.ollama.embeddingModel"] == "nomic-embed-text:latest"
    assert settings["adonex.synapse.rufloCouncil.maxAgents"] == 8
    assert settings["adonex.synapse.llmGateway.enabled"] is True
    assert settings["adonex.synapse.llmGateway.projectId"] == project_name
    assert settings["adonex.voice.startWithVSCode"] is True
    assert settings["adonex.voice.autoOpenCockpit"] is True
    assert settings["adonex.voice.wakeWord"] == "Vick"
    assert runtime["assistant_inheritance"]["adonex"]["complete_runtime"] is True
    assert runtime["assistant_inheritance"]["adonex"]["package"] == "adonex/package.json"
    assert "incremental_patch_operations" in runtime["assistant_inheritance"]["adonex"]["coding_capabilities"]
    assert "adonex/package.json" in runtime["validation"]["required_practice_paths"]
    assert "adonex/src/patch/patchEngine.ts" in runtime["validation"]["required_practice_paths"]
    assert (project / "adonex" / "package.json").exists()
    assert (project / "adonex" / "src" / "extension.ts").exists()
    assert (project / "adonex" / "src" / "patch" / "patchUtils.ts").exists()
    assert (project / "adonex" / "test").exists()
    assert not (project / "adonex" / "node_modules").exists()
    assert not (project / "adonex" / "dist").exists()

    if expected_capabilities["ai"]:
        assert (project / "config" / "ai_framework_selection.json").exists()
        assert (project / "docs" / "specifications" / "technology_layer.md").exists()
        assert "docs/specifications/technology_layer.md" in runtime["validation"]["required_practice_paths"]
        assert (project / "rag_pipelines").exists()
        assert (project / "tests" / "test_ai_contract.py").exists()
    else:
        assert not (project / "config" / "ai_framework_selection.json").exists()
        assert not (project / "rag_pipelines").exists()
        assert not (project / "tests" / "test_ai_contract.py").exists()

    if expected_capabilities["ml"]:
        assert (project / "config" / "ml_foundations_policy.json").exists()
        assert (project / "docs" / "specifications" / "ml_foundations.md").exists()
        assert "config/ml_foundations_policy.json" in runtime["validation"]["required_practice_paths"]
        assert "docs/specifications/ml_foundations.md" in runtime["validation"]["required_practice_paths"]
        assert (project / "ml_systems" / "model_card.md").exists()
        assert (project / "evals" / "ml_cases.jsonl").exists()
        assert (project / "tests" / "test_ml_contract.py").exists()
    else:
        assert not (project / "config" / "ml_foundations_policy.json").exists()
        assert not (project / "docs" / "specifications" / "ml_foundations.md").exists()
        assert not (project / "ml_systems" / "model_card.md").exists()
        assert not (project / "evals" / "ml_cases.jsonl").exists()
        assert not (project / "tests" / "test_ml_contract.py").exists()

    if project_type == "Chatbolt":
        assert (project / "prompts" / "chatbot_assistant.md").exists()
        assert (project / "docs" / "specifications" / "chatbot_design_spec.md").exists()
        assert (project / "docs" / "runbooks" / "chatbot_operations.md").exists()
        assert (project / "docs" / "checklists" / "chatbot_quality_checklist.md").exists()
        assert (project / "evals" / "chatbot_cases.jsonl").exists()
        assert (project / "config" / "chatbot_config.yaml").exists()
        assert (project / "tests" / "test_chatbot_contract.py").exists()

    test_run = subprocess.run(
        [sys.executable, "-m", "pytest", "tests"],
        cwd=project,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert test_run.returncode == 0, test_run.stdout + test_run.stderr


def test_managed_project_artifact_manifest_inherits_assistant_and_cost_contracts():
    service = ProjectFactoryService(root=Path(__file__).resolve().parents[1])
    manifest = service._managed_artifact_manifest("managed_chatbolt", PROJECT_UNIVERSES["chatbolt"])
    ml_manifest = service._managed_artifact_manifest("managed_ml", PROJECT_UNIVERSES["ml"])

    assert manifest["universe"] == "chatbolt"
    assert manifest["assistant_inheritance"]["codex"]["instructions"] == "AGENTS.md"
    assert manifest["assistant_inheritance"]["claude"]["instructions"] == "CLAUDE.md"
    assert manifest["assistant_inheritance"]["user_request_channels"] == [
        "VS Code Chat",
        "AdoneX",
        "Claude Code",
        "Codex",
    ]
    assert "authorized assistant chats before tasks" in manifest["assistant_inheritance"]["content_collection_rule"]
    assert manifest["assistant_inheritance"]["shared_solution_factory_access"]["policy"] == "config/llm_solution_factory_policy.json"
    assert manifest["assistant_inheritance"]["shared_solution_factory_access"]["technology_catalog"] == "config/ai_framework_selection.json"
    assert manifest["assistant_inheritance"]["shared_solution_factory_access"]["ml_foundations_policy"] == "config/ml_foundations_policy.json"
    assert manifest["assistant_inheritance"]["shared_solution_factory_access"]["business_analysis"] == "config/business_solution_analysis.json"
    assert manifest["assistant_inheritance"]["adonex"]["default_mode"] == "local"
    assert manifest["assistant_inheritance"]["adonex"]["complete_runtime"] is True
    assert manifest["assistant_inheritance"]["adonex"]["package"] == "adonex/package.json"
    assert manifest["assistant_inheritance"]["adonex"]["source"] == "adonex/src"
    assert "workspace_conflict_detection" in manifest["assistant_inheritance"]["adonex"]["coding_capabilities"]
    assert "adonex/dist" in manifest["assistant_inheritance"]["adonex"]["excluded_runtime_paths"]
    assert manifest["assistant_inheritance"]["vick"]["enabled"] is True
    assert manifest["assistant_inheritance"]["vick"]["browser_assistant"] == "scripts/start_vick.py"
    assert manifest["assistant_inheritance"]["vick"]["wake_word"] == "Vick"
    assert manifest["assistant_inheritance"]["peer_messaging"]["script"] == "scripts/synapse_solution_peers_mcp.py"
    assert manifest["assistant_inheritance"]["shared_dialog_memory"]["enabled"] is True
    assert manifest["assistant_inheritance"]["shared_dialog_memory"]["persistent_context"] == ".adonex/memory/SHARED_DIALOG_MEMORY.md"
    assert manifest["assistant_inheritance"]["shared_dialog_memory"]["chat_tasks"] == ".adonex/memory/CHAT_TASKS.md"
    assert manifest["local_model_policy"]["allowed_models"] == [
        "nomic-embed-text:latest",
        "qwen2.5-coder:3b",
        "qwen3:8b",
        "deepseek-coder-v2:lite",
        "qwen2.5-coder:14b",
        "qwen3:14b",
        "deepseek-r1:14b",
        "qwen2.5-coder:32b",
    ]
    assert manifest["cost_policy"]["default_active_agents"] == 1
    assert manifest["cost_policy"]["enterprise_active_agents"] == 8
    assert "docs/runbooks/adonex.md" in manifest["required_paths"]
    assert "adonex/package.json" in manifest["required_paths"]
    assert "adonex/src/extension.ts" in manifest["required_paths"]
    assert "adonex/src/patch/patchEngine.ts" in manifest["required_paths"]
    assert "adonex/src/llm/localModels.ts" in manifest["required_paths"]
    assert "adonex/test" in manifest["required_paths"]
    assert "docs/runbooks/peer_messaging.md" in manifest["required_paths"]
    assert ".vscode/tasks.json" in manifest["required_paths"]
    assert "scripts/start_vick.py" in manifest["required_paths"]
    assert ".adonex/memory/SHARED_DIALOG_MEMORY.md" in manifest["required_paths"]
    assert ".adonex/memory/CHAT_TASKS.md" in manifest["required_paths"]
    assert "config/agentic_architectural_patterns.json" in manifest["required_paths"]
    assert "docs/specifications/agentic_architectural_patterns.md" in manifest["required_paths"]
    assert "lifecycle-callbacks" in manifest["agentic_architectural_patterns"]["patterns"]
    assert "config/data_treatment_policy.json" in manifest["required_paths"]
    assert "config/context_policy.json" in manifest["required_paths"]
    assert "config/business_solution_analysis.json" in manifest["required_paths"]
    assert "config/llm_solution_factory_policy.json" in manifest["required_paths"]
    assert "docs/briefings/business_solution_analysis.md" in manifest["required_paths"]
    assert "docs/specifications/technology_layer.md" in manifest["required_paths"]
    assert "prompts/master_data_treatment.md" in manifest["required_paths"]
    assert manifest["test_layer"]["run_command"] == "python -m pytest tests"
    assert "tests/test_project_contract.py" in manifest["required_paths"]
    assert "tests/test_evals_contract.py" in manifest["required_paths"]
    assert "tests/test_data_contract.py" in manifest["required_paths"]
    assert "tests/test_ai_contract.py" in manifest["required_paths"]
    assert "tests/test_chatbot_contract.py" in manifest["required_paths"]
    assert "prompts/chatbot_assistant.md" in manifest["required_paths"]
    assert "scripts/synapse_peers_mcp.py" in manifest["forbidden_paths"]
    assert "config/ml_foundations_policy.json" in ml_manifest["required_paths"]
    assert "docs/specifications/ml_foundations.md" in ml_manifest["required_paths"]
    assert "tests/test_ml_contract.py" in ml_manifest["required_paths"]


def test_model_service_rejects_dataset_paths_outside_data_directory(tmp_path):
    outside_path = tmp_path / "outside.jsonl"
    outside_path.write_text('{"x": 1, "target": 3}', encoding="utf-8")

    service = ModelService(root=tmp_path)
    with pytest.raises(Exception, match="dataset_path must be inside the data directory"):
        service.train(
            ModelTrainingRequest(
                model_name="Unsafe Dataset",
                feature_columns=["x"],
                target_column="target",
                dataset_path="../outside.jsonl",
            )
        )


def test_protected_model_training_requires_api_key(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")

    client = TestClient(app)
    response = client.post(
        "/models/train",
        json={
            "model_name": "Revenue Baseline",
            "feature_columns": ["leads"],
            "target_column": "revenue",
            "dataset": [
                {"leads": 1, "revenue": 20},
                {"leads": 2, "revenue": 30},
            ],
        },
    )

    assert response.status_code == 401


def test_protected_model_training_accepts_valid_api_key(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")
    monkeypatch.setattr(model_routes, "service", ModelService(root=tmp_path))

    client = TestClient(app)
    response = client.post(
        "/models/train",
        headers={"X-API-Key": "test-secret"},
        json={
            "model_name": "Revenue Baseline",
            "feature_columns": ["leads"],
            "target_column": "revenue",
            "dataset": [
                {"leads": 1, "revenue": 20},
                {"leads": 2, "revenue": 30},
            ],
        },
    )

    assert response.status_code == 200


def test_mlflow_service_reports_unavailable_without_package(monkeypatch):
    service = MlflowService()
    monkeypatch.setattr(service, "_load_mlflow", lambda: None)

    result = service.status()

    assert result["available"] is False
    assert result["reason"] == "mlflow package is not installed"


def test_mlflow_status_endpoint_is_readable():
    client = TestClient(app)
    response = client.get("/mlflow/status")

    assert response.status_code == 200
    assert "available" in response.json()


def test_ml_eval_service_runs_contract_cases(tmp_path):
    service = EvalService(root=Path(__file__).resolve().parents[1])
    result = service.run_ml_eval()

    assert result["eval_type"] == "ml"
    assert result["cases_total"] == 2
    assert "pass_rate" in result["metrics"]
    assert result["mlflow"]["available"] in (True, False)


def test_ai_eval_service_runs_prompt_cases():
    service = EvalService(root=Path(__file__).resolve().parents[1])
    result = service.run_ai_eval()

    assert result["eval_type"] == "ai_prompt"
    assert result["cases_total"] == 2
    assert "pass_rate" in result["metrics"]
    assert result["mlflow"]["available"] in (True, False)


def test_eval_endpoints_require_api_key_in_production(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")

    client = TestClient(app)
    response = client.post("/evals/ml", json={})

    assert response.status_code == 401


def test_eval_endpoint_accepts_valid_api_key(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")

    client = TestClient(app)
    response = client.post(
        "/evals/ai",
        headers={"X-API-Key": "test-secret"},
        json={"cases_path": "evals/prompt_cases.jsonl", "eval_type": "prompt"},
    )

    assert response.status_code == 200
    assert response.json()["eval_type"] == "ai_prompt"


def test_local_auto_admin_is_restricted_to_loopback_clients(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "app_api_key", "")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")
    monkeypatch.setattr(settings, "allow_insecure_local_auth", True)

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/evals/ml",
            "headers": [],
            "client": ("192.0.2.10", 50000),
            "server": ("Synapse.example", 443),
            "scheme": "https",
            "query_string": b"",
        }
    )

    with pytest.raises(HTTPException) as error:
        require_api_key(request, x_api_key=None, authorization=None)

    assert error.value.status_code == 503


def test_auth_me_returns_authenticated_identity():
    app.dependency_overrides[require_api_key] = lambda: AuthContext(
        mode="supabase",
        user_id="11111111-1111-1111-1111-111111111111",
        role="operator",
        is_admin=False,
    )
    try:
        response = TestClient(app).get("/auth/me")
    finally:
        app.dependency_overrides.pop(require_api_key, None)

    assert response.status_code == 200
    assert response.json() == {
        "authenticated": True,
        "mode": "supabase",
        "user_id": "11111111-1111-1111-1111-111111111111",
        "role": "operator",
        "is_admin": False,
    }


def test_auth_me_requires_authentication_in_production(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")

    response = TestClient(app).get("/auth/me")

    assert response.status_code == 401


def test_supabase_session_loads_approved_postgres_profile(monkeypatch):
    captured = {}

    def fake_decode(token, secret, *, algorithms, audience):
        captured.update(
            token=token,
            secret=secret,
            algorithms=algorithms,
            audience=audience,
        )
        return {"sub": "11111111-1111-1111-1111-111111111111"}

    class Result:
        def mappings(self):
            return self

        def one_or_none(self):
            return {"approved": True, "role": "operator"}

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, parameters):
            assert parameters["user_id"] == "11111111-1111-1111-1111-111111111111"
            return Result()

    monkeypatch.setattr("app.security.decode", fake_decode)
    monkeypatch.setattr("app.security.get_session_factory", lambda: Session)

    auth = _require_approved_supabase_user("Bearer valid-token", "jwt-secret")

    assert auth == AuthContext(
        mode="supabase",
        user_id="11111111-1111-1111-1111-111111111111",
        role="operator",
        is_admin=False,
    )
    assert captured == {
        "token": "valid-token",
        "secret": "jwt-secret",
        "algorithms": ["HS256"],
        "audience": "authenticated",
    }


def test_supabase_session_rejects_unapproved_postgres_profile(monkeypatch):
    class Result:
        def mappings(self):
            return self

        def one_or_none(self):
            return {"approved": False, "role": "viewer"}

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, _parameters):
            return Result()

    monkeypatch.setattr(
        "app.security.decode",
        lambda *_args, **_kwargs: {
            "sub": "22222222-2222-2222-2222-222222222222"
        },
    )
    monkeypatch.setattr("app.security.get_session_factory", lambda: Session)

    with pytest.raises(HTTPException) as error:
        _require_approved_supabase_user("Bearer valid-token", "jwt-secret")

    assert error.value.status_code == 403


def test_project_factory_rejects_invalid_project_name(tmp_path):
    service = ProjectFactoryService(root=tmp_path)

    with pytest.raises(ProjectFactoryError, match="Use only letters"):
        service.create_project(ProjectCreateRequest(name="../bad"))


def test_project_factory_resolves_ml_ia_and_hybrid_universes(tmp_path):
    service = ProjectFactoryService(root=tmp_path)

    assert service._resolve_project_universe("ML") == PROJECT_UNIVERSES["ml"]
    assert service._resolve_project_universe("IA") == PROJECT_UNIVERSES["ia"]
    assert service._resolve_project_universe("ML + IA (Hibrido)") == PROJECT_UNIVERSES["hybrid"]
    assert service._resolve_project_universe("Chatbolt") == PROJECT_UNIVERSES["chatbolt"]
    for universe in PROJECT_UNIVERSES.values():
        assert universe["capabilities"]["data_treatment"] is True
        assert universe["capabilities"]["ruflo_15_agents"] is True
        assert universe["capabilities"]["ruflo_core_agents"] == 15
        assert universe["capabilities"]["ruflo_max_agents"] == 60
        assert universe["capabilities"]["ruflo_specialist_agents"] == 45

    with pytest.raises(ProjectFactoryError, match="Project universe"):
        service._resolve_project_universe("crm")


def test_chatbolt_universe_routes_as_ai_chatbot_workload():
    cost_route = CostAwareRouter().route("Criar chatbot com RAG, MCP e fallback seguro", universe="Chatbolt")
    assert cost_route["universe"] == "chatbolt"
    assert "llm-engineering" in cost_route["core_agents"]
    assert "rag-engineering" in cost_route["core_agents"]

    mesh = AgenticMeshGovernanceService()
    fleets = mesh.list_fleets("Chatbolt")
    fleet_ids = {fleet["id"] for fleet in fleets}
    assert {"project_factory_fleet", "rag_fleet", "mcp_fleet", "security_fleet"}.issubset(fleet_ids)
    assert mesh.fleet_for_request("Criar chatbot com documentos e memoria", universe="Chatbolt")["selected_fleet"]["id"] == "rag_fleet"

    framework_selection = AiFrameworkSelector().select("chatbot com RAG e tool calling", universe="Chatbolt")
    assert framework_selection["active"] is True
    assert framework_selection["universe"] == "chatbolt"
    assert framework_selection["recommended_frameworks"]


def test_project_factory_rejects_existing_project(tmp_path):
    destination = tmp_path / "existing_project"
    destination.mkdir()
    service = ProjectFactoryService(root=Path(__file__).resolve().parents[1])
    settings = service.settings
    original_base_path = settings.project_factory_base_path
    try:
        settings.project_factory_base_path = str(tmp_path)
        with pytest.raises(ProjectFactoryError, match="Project already exists"):
            service.create_project(ProjectCreateRequest(name="existing_project"))
    finally:
        settings.project_factory_base_path = original_base_path


def test_project_factory_requires_business_problem_when_requested(tmp_path):
    service = ProjectFactoryService(root=tmp_path)

    with pytest.raises(ProjectFactoryError, match="missing project context"):
        service.create_project(ProjectCreateRequest(name="guided_project", require_business_problem=True))


def test_project_briefing_agent_requires_business_problem():
    service = ProjectBriefingService(ruflo=RufloService(client=FailingClient()))

    result = service.answer(
        ProjectBriefingRequest(
            message="Crie um SaaS com ML e agentes",
            project_goal="Crie um SaaS com ML e agentes",
        )
    )

    assert result["agent"] == "orchestration-manager"
    assert result["ready_to_create"] is False
    assert "business_problem" in result["required_fields"]
    assert "success_metric_or_acceptance_criteria" in result["required_fields"]
    assert "available_data_or_knowledge_sources" in result["required_fields"]
    assert "risk_level" in result["required_fields"]
    assert result["missing_questions"]
    assert "Qual problema de negocio" in result["next_question"]
    assert result["ruflo"]["available"] is False


def test_project_briefing_agent_releases_project_creation_when_complete():
    service = ProjectBriefingService(ruflo=RufloService(client=RecordingClient()))

    result = service.answer(
        ProjectBriefingRequest(
            message="Reduzir churn",
            project_goal="Crie um SaaS para reduzir churn",
            business_problem="Identificar clientes com risco de cancelamento e priorizar acao comercial.",
            success_metric_or_acceptance_criteria="AUC acima de 0.80 e lista priorizada validada pelo time comercial.",
            available_data_or_knowledge_sources="Historico de clientes, compras, atendimento e cancelamentos.",
            risk_level="medio",
        )
    )

    assert result["ready_to_create"] is True
    assert result["suggested_project_name"].startswith("crie_um_saas")
    assert "AI Engineering" in result["foundation_principles"][0]
    assert tuple(result["parallel_agents"]) == REQUIRED_PARALLEL_AGENTS
    assert result["enterprise_spec"]["ruflo_required"] is True
    assert result["enterprise_spec"]["parallel_agent_count"] == 15
    assert result["enterprise_spec"]["max_agent_count"] == 60
    assert result["enterprise_spec"]["specialist_agent_count"] == 45
    assert "define_rag_strategy" in result["enterprise_spec"]["required_request_steps"]
    assert result["ai_framework_selection"]["active"] is True
    assert "langgraph" in result["ai_framework_selection"]["recommended_framework_ids"]
    assert "openai-agents-sdk" in result["ai_framework_selection"]["recommended_framework_ids"]
    assert result["cost_aware_activation"]["max_available_agents"] == 60
    assert result["cost_aware_activation"]["active_agent_count"] < 60
    assert result["cost_aware_activation"]["token_controls"]["prefer_prompt_cache"] is True
    assert result["agentic_mesh"]["requires_human_approval_for_all_60_agents"] is True
    assert result["agentic_mesh"]["selected_fleet"]["id"]
    assert result["agent_blueprint"]["model_strategy"]["local_first"] is True
    assert result["agent_blueprint"]["fleet"]
    assert result["business_solution_analysis"]["recommended_universe"] in {"ml", "hybrid"}
    assert result["business_solution_analysis"]["ml_archetype"]["id"] == "classification_scoring"
    assert result["business_solution_analysis"]["dialog_context"]["success_metric_or_acceptance_criteria"].startswith("AUC")
    assert "Historico de clientes" in result["business_solution_analysis"]["dialog_context"]["available_data_or_knowledge_sources"]
    assert "tests/test_ml_contract.py" in result["business_solution_analysis"]["test_strategy"]
    assert result["business_solution_analysis"]["technology_layer"]["active"] is True
    assert "mlflow" in result["business_solution_analysis"]["technology_layer"]["recommended_technology_ids"]
    assert result["ruflo"]["parallel_default"] is True
    assert "tokens" in result["token_strategy"]


def test_project_briefing_endpoint_preserves_cost_and_governance_contracts():
    client = TestClient(app)
    response = client.post(
        "/projects/briefing",
        json={
            "message": "Criar RAG corporativo com MCP",
            "project_goal": "Criar RAG corporativo com MCP",
            "business_problem": "Reduzir o tempo de busca em documentos internos.",
            "success_metric_or_acceptance_criteria": "Responder perguntas internas com fonte citada e satisfacao acima de 80%.",
            "available_data_or_knowledge_sources": "PDFs, politicas internas e runbooks.",
            "risk_level": "medio",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cost_aware_activation"]["active_agent_count"] <= payload["cost_aware_activation"]["active_agent_limit"]
    assert payload["agentic_mesh"]["selected_fleet"]["id"]
    assert payload["agent_blueprint"]["model_strategy"]["local_first"] is True
    assert payload["business_solution_analysis"]["ai_archetype"]["id"] == "rag"
    assert payload["business_solution_analysis"]["dialog_context"]["risk_level"] == "medio"
    assert "rag-frameworks" in payload["business_solution_analysis"]["technology_layer"]["recommended_technology_ids"]


def test_workflow_execution_defaults_to_parallel():
    from app.schemas.workflows import WorkflowExecutionRequest

    request = WorkflowExecutionRequest()

    assert request.parallel_execution is True


def test_project_factory_writes_llm_ruflo_briefing(monkeypatch, tmp_path):
    class Completed:
        returncode = 0
        stdout = "created"
        stderr = ""

    script_path = tmp_path / "scripts" / "create_ai_project.ps1"
    script_path.parent.mkdir()
    script_path.write_text("Write-Output created", encoding="utf-8")

    destination = tmp_path / "generated" / "guided_project"

    def fake_run(*args, **kwargs):
        destination.mkdir(parents=True)
        return Completed()

    service = ProjectFactoryService(root=tmp_path)
    settings = service.settings
    original_base_path = settings.project_factory_base_path
    monkeypatch.setattr("app.services.project_factory_service.subprocess.run", fake_run)

    try:
        settings.project_factory_base_path = str(tmp_path / "generated")
        result = service.create_project(
            ProjectCreateRequest(
                name="guided_project",
                project_goal="Criar um SaaS com agentes de IA.",
                business_problem="Reduzir churn medindo risco por cliente.",
                success_metric_or_acceptance_criteria="AUC acima de 0.80 e reducao de churn em campanhas piloto.",
                available_data_or_knowledge_sources="Base de clientes, compras, chamados e cancelamentos.",
                risk_level="medio",
                project_type="ML",
                solution_focus="ml",
                require_business_problem=True,
            )
        )
    finally:
        settings.project_factory_base_path = original_base_path

    context_path = Path(result["context_path"])
    assert context_path.exists()
    context = context_path.read_text(encoding="utf-8")
    assert "Reduzir churn" in context
    assert "AUC acima de 0.80" in context
    assert "Base de clientes" in context
    assert "medio" in context
    assert "SDD gate" in context
    assert "define_architecture" in context
    assert result["enterprise_spec"]["parallel_agent_count"] == 15
    assert result["enterprise_spec"]["max_agent_count"] == 60
    assert result["project_type"] == "enterprise-ml-system"
    assert result["project_universe"]["universe"] == "ml"
    assert result["project_universe"]["capabilities"]["ai"] is False
    assert result["project_universe"]["capabilities"]["data_treatment"] is True
    assert result["project_universe"]["capabilities"]["ruflo_15_agents"] is True
    assert result["project_universe"]["capabilities"]["ruflo_max_agents"] == 60
    assert result["cost_aware_activation"]["max_available_agents"] == 60
    assert result["cost_aware_activation"]["active_agent_count"] < 60
    assert result["agentic_mesh"]["requires_human_approval_for_all_60_agents"] is True
    assert result["agent_blueprint"]["model_strategy"]["local_first"] is True
    assert result["business_solution_analysis"]["recommended_universe"] == "ml"
    assert result["business_solution_analysis"]["ml_archetype"]["id"] == "classification_scoring"
    assert result["business_solution_analysis"]["dialog_context"]["risk_level"] == "medio"
    analysis_path = destination / "config" / "business_solution_analysis.json"
    analysis_md = destination / "docs" / "briefings" / "business_solution_analysis.md"
    assert analysis_path.exists()
    assert analysis_md.exists()
    assert result["synapse_project_index"]["registered"] is True
    index = json.loads(Path(result["synapse_project_index"]["path"]).read_text(encoding="utf-8"))
    indexed = next(project for project in index["projects"] if project["name"] == "guided_project")
    assert indexed["created_by_synapse"] is True
    assert indexed["destination"] == str(destination)
    assert indexed["project_goal"] == "Criar um SaaS com agentes de IA."
    assert indexed["success_metric_or_acceptance_criteria"] == "AUC acima de 0.80 e reducao de churn em campanhas piloto."
    assert indexed["available_data_or_knowledge_sources"] == "Base de clientes, compras, chamados e cancelamentos."
    assert indexed["risk_level"] == "medio"


def test_synapse_project_index_preserves_created_project_access(monkeypatch, tmp_path):
    class Completed:
        returncode = 0
        stdout = "created"
        stderr = ""

    script_path = tmp_path / "scripts" / "create_ai_project.ps1"
    script_path.parent.mkdir()
    script_path.write_text("Write-Output created", encoding="utf-8")
    destination = tmp_path / "generated" / "indexed_project"

    def fake_run(*args, **kwargs):
        destination.mkdir(parents=True)
        return Completed()

    service = ProjectFactoryService(root=tmp_path)
    settings = service.settings
    original_base_path = settings.project_factory_base_path
    original_index_path = settings.synapse_project_index_path
    monkeypatch.setattr("app.services.project_factory_service.subprocess.run", fake_run)
    try:
        settings.project_factory_base_path = str(tmp_path / "generated")
        settings.synapse_project_index_path = str(tmp_path / "artifacts" / "projects" / "synapse-projects.json")
        service.create_project(
            ProjectCreateRequest(
                name="indexed_project",
                project_type="IA",
                project_goal="Criar agente interno.",
                business_problem="Reduzir trabalho manual.",
            )
        )
        projects = service.list_local_projects()
        detail = service.get_local_project("indexed_project")
    finally:
        settings.project_factory_base_path = original_base_path
        settings.synapse_project_index_path = original_index_path

    assert projects[0]["name"] == "indexed_project"
    assert projects[0]["created_by_synapse"] is True
    assert projects[0]["project_type"] == "enterprise-ai-agentic-system"
    assert detail["project_goal"] == "Criar agente interno."
    assert detail["business_problem"] == "Reduzir trabalho manual."


def test_project_factory_does_not_activate_ruflo_when_disabled(monkeypatch, tmp_path):
    class Completed:
        returncode = 0
        stdout = "created"
        stderr = ""

    script_path = tmp_path / "scripts" / "create_ai_project.ps1"
    script_path.parent.mkdir()
    script_path.write_text("Write-Output created", encoding="utf-8")
    destination = tmp_path / "generated" / "economical_project"
    recorded_command = []

    def fake_run(command, **kwargs):
        recorded_command.extend(command)
        destination.mkdir(parents=True)
        return Completed()

    service = ProjectFactoryService(root=tmp_path)
    settings = service.settings
    original_base_path = settings.project_factory_base_path
    monkeypatch.setattr("app.services.project_factory_service.subprocess.run", fake_run)
    try:
        settings.project_factory_base_path = str(tmp_path / "generated")
        result = service.create_project(
            ProjectCreateRequest(
                name="economical_project",
                project_type="IA",
                activate_ruflo=False,
                project_goal="Criar um assistente simples.",
            )
        )
    finally:
        settings.project_factory_base_path = original_base_path

    assert "-ActivateRuflo" not in recorded_command
    assert "-ActiveAgentLimit" in recorded_command
    assert result["ruflo_activation"]["requested"] is False


def test_project_create_endpoint_requires_api_key_in_production(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "app_api_key", "test-secret")

    client = TestClient(app)
    response = client.post("/projects/create", json={"name": "new_project"})

    assert response.status_code == 401


def test_project_routes_load_existing_local_project(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "project_creation_mode", "local")
    monkeypatch.setattr(settings, "project_factory_base_path", str(tmp_path))

    project_path = tmp_path / "loaded_project"
    project_path.mkdir()

    client = TestClient(app)
    list_response = client.get("/projects")
    detail_response = client.get("/projects/loaded_project")

    assert list_response.status_code == 200
    assert list_response.json()[0]["name"] == "loaded_project"
    assert detail_response.status_code == 200
    assert detail_response.json()["data_storage_prefix"].endswith("data")
    assert (project_path / "data").exists()


def test_project_download_returns_zip_for_local_project(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "project_creation_mode", "local")
    monkeypatch.setattr(settings, "project_factory_base_path", str(tmp_path))

    project_path = tmp_path / "downloadable_project"
    project_path.mkdir()
    (project_path / "README.md").write_text("# Downloadable", encoding="utf-8")

    client = TestClient(app)
    response = client.get("/projects/downloadable_project/download")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.content.startswith(b"PK")


def test_project_download_excludes_secrets_databases_and_build_artifacts(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "project_factory_base_path", str(tmp_path))

    project_path = tmp_path / "safe_archive"
    project_path.mkdir()
    (project_path / "README.md").write_text("# Safe", encoding="utf-8")
    (project_path / ".env").write_text("API_KEY=secret", encoding="utf-8")
    (project_path / "credentials.json").write_text('{"token": "secret"}', encoding="utf-8")
    (project_path / "private.pem").write_text("secret", encoding="utf-8")
    (project_path / "memory.db").write_bytes(b"database")
    (project_path / "node_modules").mkdir()
    (project_path / "node_modules" / "package.js").write_text("ignored", encoding="utf-8")

    archive = ProjectFactoryService(root=tmp_path).create_local_project_archive("safe_archive")
    with zipfile.ZipFile(BytesIO(archive)) as zip_file:
        names = set(zip_file.namelist())

    assert "safe_archive/README.md" in names
    assert "safe_archive/.env" not in names
    assert "safe_archive/credentials.json" not in names
    assert "safe_archive/private.pem" not in names
    assert "safe_archive/memory.db" not in names
    assert "safe_archive/node_modules/package.js" not in names


def test_browser_local_attachment_upload_matches_vscode_attachment_flow(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "environment", "local")
    monkeypatch.setattr(settings, "project_creation_mode", "local")
    monkeypatch.setattr(settings, "project_factory_base_path", str(tmp_path))
    (tmp_path / "attachment_project").mkdir()

    client = TestClient(app)
    upload_response = client.post(
        "/projects/attachment_project/attachments",
        json={
            "filename": "Minha Foto.PNG",
            "content_base64": base64.b64encode(b"fake-image").decode("ascii"),
        },
    )
    list_response = client.get("/projects/attachment_project/attachments")

    assert upload_response.status_code == 200
    assert upload_response.json()["path"] == "data/uploads/Minha_Foto.PNG"
    assert list_response.status_code == 200
    assert list_response.json()[0]["name"] == "Minha_Foto.PNG"
    assert (tmp_path / "attachment_project" / "data" / "uploads" / "Minha_Foto.PNG").exists()


def test_security_and_deployment_contracts_are_hardened():
    root = Path(__file__).resolve().parents[1]
    proxy = (root / "frontend" / "app" / "api" / "synapse" / "[...path]" / "route.ts").read_text(encoding="utf-8")
    auth_gate = (root / "frontend" / "components" / "AuthGate.tsx").read_text(encoding="utf-8")
    user_menu = (root / "frontend" / "components" / "UserMenu.tsx").read_text(encoding="utf-8")
    migration = (root / "supabase" / "migrations" / "003_project_storage_membership.sql").read_text(encoding="utf-8")
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")
    mcp = json.loads((root / ".mcp.json").read_text(encoding="utf-8"))

    assert 'process.env.ALLOW_SERVER_API_KEY_PROXY === "true"' in proxy
    assert 'headers.set("Authorization", authorization)' in proxy
    assert "await fetchCurrentUser()" in auth_gate
    assert "await signOut()" in user_menu
    assert "can_access_project_storage" in migration
    assert "project_members.user_id = auth.uid()" in migration
    assert 'ENVIRONMENT: production' in compose
    assert 'PROJECT_CREATION_MODE: managed' in compose
    assert '127.0.0.1:5000:5000' in compose
    assert 'NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_URL:-}' in compose
    assert 'SUPABASE_JWT_SECRET: ${SUPABASE_JWT_SECRET:-}' in compose
    assert mcp["mcpServers"]["ruflo"]["env"]["CLAUDE_FLOW_MAX_AGENTS"] == "60"


def test_browser_and_vscode_interfaces_expose_independent_equivalent_capabilities():
    root = Path(__file__).resolve().parents[1]
    tasks = json.loads((root / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    labels = {task["label"] for task in tasks["tasks"]}
    ops = (root / "frontend" / "components" / "OpsConsole.tsx").read_text(encoding="utf-8")
    workflow_canvas = (root / "frontend" / "components" / "WorkflowCanvas.tsx").read_text(encoding="utf-8")
    workflow_styles = (root / "frontend" / "app" / "styles.css").read_text(encoding="utf-8")
    dashboard = (root / "frontend" / "app" / "page.tsx").read_text(encoding="utf-8")
    layout = (root / "frontend" / "app" / "layout.tsx").read_text(encoding="utf-8")
    api = (root / "frontend" / "lib" / "api.ts").read_text(encoding="utf-8")
    projects = (root / "frontend" / "components" / "ProjectsConsole.tsx").read_text(encoding="utf-8")
    proxy = (root / "frontend" / "app" / "api" / "synapse" / "[...path]" / "route.ts").read_text(encoding="utf-8")

    assert "Synapse: Preparar runtime VS Code sem navegador" in labels
    assert "Synapse: Iniciar modo navegador independente" in labels
    backend_task = next(task for task in tasks["tasks"] if task["label"] == "Dev: Backend FastAPI no VS Code")
    browser_task = next(
        task for task in tasks["tasks"] if task["label"] == "Synapse: Iniciar modo navegador independente"
    )
    assert backend_task["problemMatcher"]["background"]["endsPattern"] == "Uvicorn running on"
    assert set(browser_task["dependsOn"]) == {
        "Dev: Backend FastAPI no VS Code",
        "Dev: Frontend Next.js no VS Code",
    }
    assert "/tools/data-treatment" in ops
    assert "/tools/context-filter" in ops
    assert "/tools/market-radar" in ops
    assert "ML + IA (Hibrido)" in ops
    assert "activate_ruflo: activateRuflo" in ops
    assert "WorkflowCanvas" in (root / "frontend" / "app" / "workflows" / "page.tsx").read_text(encoding="utf-8")
    assert "Codex + Ruflo" not in dashboard
    assert "Codex + Ruflo" not in layout
    assert "Codex + Ruflo" not in api
    assert "Preparar release de modelo" in workflow_canvas
    assert "Tratar dados" in workflow_canvas
    assert "Explorar dados" in workflow_canvas
    assert "Selecionar arquivo" in workflow_canvas
    assert "Modelo de regressao" in workflow_canvas
    assert "Modelo de classificacao" in workflow_canvas
    assert "Modelo de previsao temporal" in workflow_canvas
    assert "Definir agente" in workflow_canvas
    assert "Criar prompt system" in workflow_canvas
    assert "Configurar MCP/tools" in workflow_canvas
    assert "Criar memoria" in workflow_canvas
    assert "Aplicar guardrails" in workflow_canvas
    assert "Avaliar respostas" in workflow_canvas
    assert "Publicar agente" in workflow_canvas
    assert "Analisar dados" in workflow_canvas
    assert "Treinar modelos" in workflow_canvas
    assert "Integrar APIs" in workflow_canvas
    assert "Servico preditivo" in workflow_canvas
    assert "Gerir experimentos" in workflow_canvas
    assert "Projetar Chatbolt" in workflow_canvas
    assert "Configurar chatbot" in workflow_canvas
    assert "Integrar canais" in workflow_canvas
    assert "Coletar feedback" in workflow_canvas
    assert "Gerir intents" in workflow_canvas
    assert "Monitorar conversas" in workflow_canvas
    assert "onDragStart" in workflow_canvas
    assert "onDrop" in workflow_canvas
    assert "work-icon" in workflow_canvas
    assert "runMountedFlow" in workflow_canvas
    assert "Workflows base" not in workflow_canvas
    assert "Limpar resultado" not in workflow_canvas
    assert "ops-result" not in workflow_canvas
    assert "workflow-catalog" not in workflow_canvas
    assert "node-file-picker" in workflow_canvas
    assert "Carregar arquivo" in workflow_canvas
    assert ".csv,.xlsx,.xls,.json,.jsonl,.parquet" in workflow_canvas
    assert "actionMenus" in workflow_canvas
    assert "workflow-action-grid" in workflow_canvas
    assert "workflow-expand-button" in workflow_canvas
    assert "workflow-expand-all" in workflow_canvas
    assert "Expandir tudo" in workflow_canvas
    assert "Recolher tudo" in workflow_canvas
    assert "toggleAllVisible" in workflow_canvas
    assert "createActionNode" in workflow_canvas
    assert "addMenuPayload" in workflow_canvas
    assert "grid-template-columns: minmax(220px, 260px) minmax(0, 1fr)" in workflow_styles
    assert "grid-template-columns: 20px minmax(0, 1fr) 18px" in workflow_styles
    assert "margin: 0 0 3px 24px" in workflow_styles
    for action_name in (
        "Ausentes",
        "Random forest",
        "Persona",
        "Dry-run",
        "Endpoint",
        "WhatsApp",
        "Intents",
    ):
        assert action_name in workflow_canvas
    for icon_name in (
        "FileUp",
        "TableColumnsSplit",
        "BookOpenText",
        "Network",
        "HardDriveUpload",
        "Rocket",
        "MessagesSquare",
    ):
        assert icon_name in workflow_canvas
    assert ".workflow-step:not(:last-child)::after" in workflow_styles
    assert "/attachments" in projects
    assert "Baixar projeto" in projects
    assert "response.arrayBuffer()" in proxy


def test_data_treatment_report_includes_advanced_statistics(tmp_path):
    raw = tmp_path / "raw" / "clientes.csv"
    raw.parent.mkdir()
    raw.write_text(
        "idade,renda,segmento\n"
        "20,1000,a\n"
        "30,2000,a\n"
        "40,3000,b\n"
        "50,4000,b\n"
        "60,5000,c\n",
        encoding="utf-8",
    )

    result = treat_dataset(raw, report_path=tmp_path / "report.md")
    report = result.report_path.read_text(encoding="utf-8")

    assert "## Estatisticas avancadas" in report
    assert "Normalidade" in report
    assert "Intervalos de confianca" in report
    assert "Correlacoes numericas" in report


def test_model_service_trains_classification_forecasting_and_neural_baselines(tmp_path):
    service = ModelService(root=tmp_path)

    classifier = service.train(
        ModelTrainingRequest(
            model_name="Churn Classifier",
            problem_type="classification",
            algorithm="logistic_regression",
            feature_columns=["usage", "tickets"],
            target_column="churn",
            dataset=[
                {"usage": 10, "tickets": 0, "churn": "no"},
                {"usage": 8, "tickets": 1, "churn": "no"},
                {"usage": 2, "tickets": 4, "churn": "yes"},
                {"usage": 1, "tickets": 5, "churn": "yes"},
            ],
            max_iterations=200,
        )
    )
    classifier_prediction = service.predict(
        classifier["model_id"],
        ModelPredictionRequest(features={"usage": 1, "tickets": 5}),
    )

    forecast = service.train(
        ModelTrainingRequest(
            model_name="Revenue Forecast",
            problem_type="forecasting",
            algorithm="moving_average_forecast",
            feature_columns=[],
            target_column="revenue",
            time_column="month",
            forecast_window=2,
            dataset=[
                {"month": "2026-01", "revenue": 100},
                {"month": "2026-02", "revenue": 120},
                {"month": "2026-03", "revenue": 140},
            ],
        )
    )
    forecast_prediction = service.predict(forecast["model_id"], ModelPredictionRequest(features={}))

    neural = service.train(
        ModelTrainingRequest(
            model_name="Revenue Neural Baseline",
            problem_type="regression",
            algorithm="neural_network_regression",
            feature_columns=["leads", "price"],
            target_column="revenue",
            dataset=[
                {"leads": 1, "price": 10, "revenue": 20},
                {"leads": 2, "price": 10, "revenue": 30},
                {"leads": 3, "price": 10, "revenue": 40},
                {"leads": 4, "price": 10, "revenue": 50},
            ],
            max_iterations=120,
            learning_rate=0.03,
        )
    )

    assert classifier["metrics"]["f1"] >= 0.5
    assert classifier_prediction["prediction"] in {"no", "yes"}
    assert forecast_prediction["details"]["forecast"] == [130.0, 130.0]
    assert neural["metrics"]["rmse"] >= 0


def test_rag_pipeline_builds_local_index_and_returns_citations(tmp_path):
    pipeline = RagPipeline(root=tmp_path)
    built = pipeline.build_index(
        [
            {
                "source_id": "doc-1",
                "text": "Synapse usa Ollama local first para reduzir custo de tokens e manter cloud bloqueada.",
                "metadata": {"project": "synapse"},
            },
            {
                "source_id": "doc-2",
                "text": "RAG corporativo precisa de citacoes, recuperacao e avaliacao de fidelidade.",
            },
        ],
        index_name="synapse",
        chunk_size=40,
    )
    answer = pipeline.query("Como reduzir custo de tokens com Synapse?", index_name="synapse")

    assert built["ready"] is True
    assert answer["citations"]
    assert answer["citations"][0]["source_id"] == "doc-1"
    assert answer["metrics"]["local_only"] is True


def test_runtime_manifest_declares_generated_project_ruflo_strategy():
    manifest = load_runtime_manifest()
    strategy = manifest["generated_project_ruflo_strategy"]

    assert strategy["available_agents"] == 60
    assert strategy["default_activation"] == "one_orchestrator_first"
    assert "human_approval" in strategy["full_activation_requires"]
    assert "rag_fleet" in strategy["recommended_fleets_by_universe"]["ia"]


def test_foundations_notebook_is_executable_json_contract():
    notebook = json.loads(Path("notebooks/foundations/foundations_lab.ipynb").read_text(encoding="utf-8"))

    assert notebook["nbformat"] == 4
    assert any("tokenize" in "".join(cell.get("source", [])) for cell in notebook["cells"])
    assert any("retrieval_eval" in "".join(cell.get("source", [])) for cell in notebook["cells"])

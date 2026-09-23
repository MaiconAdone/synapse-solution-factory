from pathlib import Path
import subprocess
import json
import sys

import pytest

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer
from scripts.synapse_lib.ai_framework_selector import AiFrameworkSelector
from scripts.synapse_lib.eval_service import EvalService
from scripts.synapse_lib.model_service import ModelService
from scripts.synapse_lib.schemas.models import ModelPredictionRequest, ModelTrainingRequest


PROJECT_PATH_PATTERN = __import__("re").compile(
    r"(?<![\w/.-])((?:config|docs|scripts|templates|prompts|evals|playbooks|rag_pipelines|rag|vector_db|llm_ops|"
    r"ml_systems|guardrails|agents|notebooks|memory|tests)/[\w./-]*\w)"
)
# Synapse-wide contracts, catalogs and library code are copied unchanged into
# every project and describe all universes by design.
UNIVERSAL_PROJECT_FILES = {
    "config/llm_solution_factory_policy.json", "config/ai_ml_enterprise_spec.json", "config/business_solution_catalog.json",
    "config/harness_engineering_policy.json", "config/agentic_architectural_patterns.json", "config/agent_blueprint_contract.json",
    "config/fine_tuning_policy.json", "config/agent_improvement_loop.json", "config/book_registry.json",
    "docs/books/implementation_map.md", "docs/specifications/harness_engineering.md", "docs/specifications/fine_tuning.md",
    "docs/specifications/llm_solution_factory_governance.md", "playbooks/prompt_engineering.md", "playbooks/llm_engineering.md",
    "templates/README.md", "tests/test_project_contract.py",
}
RUNTIME_CREATED_PATHS = {
    "memory/approved_agent_blueprints.jsonl", "memory/approved_architecture_patterns.jsonl",
    "evals/teacher_review_cases.jsonl", "memory/synapse_learning_memory.jsonl", "docs/radar/YYYY-MM-DD.md",
}


def _missing_project_references(project):
    """Paths cited by project-specific files that do not exist in the project."""
    missing = {}
    for source in project.rglob("*"):
        relative = source.relative_to(project).as_posix()
        if (
            not source.is_file()
            or source.suffix not in {".md", ".json", ".yaml", ".yml", ".jsonl"}
            or any(part in {".venv", "__pycache__"} for part in source.parts)
            or relative in UNIVERSAL_PROJECT_FILES
        ):
            continue
        for line in source.read_text(encoding="utf-8-sig", errors="replace").replace("\\", "/").splitlines():
            if "created_by" in line or '"source"' in line:
                continue
            for target in PROJECT_PATH_PATTERN.findall(line):
                if (
                    target in RUNTIME_CREATED_PATHS
                    or target.startswith("templates/backend/")
                    or "YYYY" in target
                    or (project / target).exists()
                ):
                    continue
                missing.setdefault(target, []).append(relative)
    return missing
from scripts.synapse_lib.peer_messaging_service import PeerMessagingError, PeerMessagingService
from scripts.synapse_lib.config import Settings
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


def test_peer_messaging_supports_codex_claude_and_local_task_routes(tmp_path, monkeypatch):
    monkeypatch.setattr(PeerMessagingService, "_pid_alive", staticmethod(lambda _pid: True))
    settings = Settings(
        peer_messaging_db_path=str(tmp_path / "peers.db"),
        peer_messaging_max_message_chars=240,
        peer_messaging_max_summary_chars=120,
    )
    service = PeerMessagingService(settings)

    codex = service.register(
        peer_type="codex",
        cwd=str(tmp_path),
        summary="Codex answering Synapse questions locally.",
        pid=201,
        capabilities=["synapse-system-questions", "cloud-models"],
        model_profile="openai:gpt-5.5",
        active_agents=3,
    )
    claude = service.register(
        peer_type="claude",
        cwd=str(tmp_path),
        summary="Claude Code review session ready.",
        pid=202,
        capabilities=["code-review", "local-routing"],
        active_agents=3,
    )

    published = service.publish_context(
        codex["id"],
        summary="Codex routes simple Synapse questions through Claude Code and the cloud provider.",
        role="Codex local assistant",
        capabilities=["synapse-system-questions", "claude-code-routing"],
        model_profile="openai",
        active_agents=3,
    )
    announced = service.announce_task(
        from_id=codex["id"],
        objective="Responder quais modelos a Synapse usa.",
        target_peer_type="claude",
        required_agents=["orchestration-manager", "llm-engineering"],
    )
    inbox = service.check_messages(claude["id"])

    assert published["peer_type"] == "codex"
    assert published["capabilities"] == ["synapse-system-questions", "claude-code-routing"]
    assert published["active_agents"] == 3
    assert announced["targeted_count"] == 1
    assert announced["cost_control"].startswith("Task announcement stayed local")
    assert inbox["message_count"] == 1
    assert "provider=openai cloud=true" in inbox["messages"][0]["text"]


def test_mcp_json_has_no_machine_specific_servers():
    config = json.loads(Path(".mcp.json").read_text(encoding="utf-8"))

    assert config["mcpServers"] == {}


def test_llm_solution_factory_policy_guides_all_dialog_assistants():
    root = Path(__file__).resolve().parents[1]
    policy = json.loads((root / "config" / "llm_solution_factory_policy.json").read_text(encoding="utf-8-sig"))
    governance = (root / "docs" / "specifications" / "llm_solution_factory_governance.md").read_text(encoding="utf-8-sig")
    agents = (root / "AGENTS.md").read_text(encoding="utf-8-sig")
    claude = (root / "CLAUDE.md").read_text(encoding="utf-8-sig")
    codex_config = (root / ".codex" / "config.toml").read_text(encoding="utf-8-sig")

    assert policy["dialog_first"]["required"] is True
    assert policy["dialog_first"]["authorized_user_request_channels"] == [
        "VS Code Chat",
        "Claude Code chat/terminal",
        "Codex chat",
    ]
    assert "goals, constraints, files, decisions, approvals" in policy["dialog_first"]["content_collection_rule"]
    assert "VS Code tasks" in policy["dialog_first"]["non_primary_channels"]
    assert policy["missing_information_protocol"]["required"] is True
    assert "business_problem" in policy["missing_information_protocol"]["do_not_guess"]
    assert "success_metric_or_acceptance_criteria" in policy["missing_information_protocol"]["do_not_guess"]
    assert "Codex" in policy["applies_to"]
    assert "Claude Code" in policy["applies_to"]
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
        "fastapi",
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
    assert "mlflow" not in ml_selection["technology_layer"]["recommended_technology_ids"]


def test_workflow_files_exist_for_required_workflows():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    for workflow_id in ("new-ai-project", "rag-build", "ml-release", "agent-build", "business-transformation"):
        assert (root / "config" / "workflows" / "synapse" / f"{workflow_id}.json").exists()


def test_project_factory_script_creates_solution_projects_without_platform_stack():
    root = Path(__file__).resolve().parents[1]
    script = _read_factory_sources(root)
    assert "LocalMemoryOnly" in script
    for removed in ("max_agents: 60", "ActiveAgentLimit", "agent_trust_framework.json", "agent_fleets.json", "enterprise_agents.yaml", "SwarmName"):
        assert removed not in script, removed
    assert "execution: single_assistant_first" in script
    assert "Configure-EnterpriseSpec" in script
    assert "ai_ml_enterprise_spec.json" in script
    assert "ai_framework_selection.json" in script
    assert "cost_optimization_policy.json" in script
    assert "Configure-CostOptimizationPolicy" in script
    assert "config/roles.json" in script
    assert "agent_blueprint_contract.json" in script
    assert "agentic_architectural_patterns.json" in script
    assert "agent_improvement_loop.json" in script
    assert "Configure-AgentGovernance" in script
    assert "Configure-LocalAiRuntime" in script
    assert 'cloud_model = "gpt-5.5"' in script
    assert "continual_learning" in script
    assert "automatic_weight_updates = $false" in script
    assert "docs\\specifications\\agent_governance.md" in script
    assert "docs\\specifications\\agentic_architectural_patterns.md" in script
    assert "docs\\checklists\\agent_certification.md" in script
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
    assert '"Synapse: Listar modelos Ollama"' not in script
    assert "factory_capable = $false" in script
    assert "contains_backend = $false" in script
    assert "contains_frontend = $false" in script


def test_vscode_eval_tasks_run_locally_and_specialists_use_one_catalog():
    root = Path(__file__).resolve().parents[1]
    ml_eval = (root / "scripts" / "run_ml_evals.ps1").read_text(encoding="utf-8-sig")
    ai_eval = (root / "scripts" / "run_ai_evals.ps1").read_text(encoding="utf-8-sig")

    assert "run_evals.py" in ml_eval
    assert "run_evals.py" in ai_eval


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
        if task["label"] == "AI Factory: Criar projeto com Codex + tratamento dados"
    )
    project_type_input = next(item for item in tasks["inputs"] if item["id"] == "projectType")
    assert project_type_input["type"] == "pickString"
    assert project_type_input["options"] == ["ML", "IA", "ML + IA (Hibrido)", "Chatbolt"]
    assert "tratamento de dados" in factory_task["detail"]
    assert "Codex: Tratar dados" in labels
    assert "AI Factory: Anexar foto ou arquivo ao projeto" in labels
    assert "Synapse: Diagnosticar projeto criado" in labels
    assert "Synapse: Market Radar + Context Filter" in labels
    assert "Synapse: Filtrar contexto para LLM" in labels
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
        if task["label"] == "Synapse: Filtrar contexto para LLM"
    )
    assert "context_filter.py" in " ".join(context_task["args"])


def test_vscode_factory_task_enables_complete_bundle_for_every_universe():
    root = Path(__file__).resolve().parents[1]
    tasks = json.loads((root / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    factory_task = next(
        task for task in tasks["tasks"]
        if task["label"] == "AI Factory: Criar projeto com Codex + tratamento dados"
    )
    project_type_input = next(item for item in tasks["inputs"] if item["id"] == "projectType")
    script = _read_factory_sources(root)

    assert project_type_input["options"] == ["ML", "IA", "ML + IA (Hibrido)", "Chatbolt"]
    assert "-ActiveAgentLimit" not in factory_task["args"]
    for capability in (
        "data_treatment_enabled = $true",
        "cost_aware_model_routing = $true",
        "prompts/codex_data_treatment_dialog.md",
        "config/ai_ml_enterprise_spec.json",
        "config/ai_framework_selection.json",
        "config/roles.json",
        "config/agent_blueprint_contract.json",
        "Create-BusinessSolutionAnalysis",
        "config/business_solution_analysis.json",
        "docs/briefings/business_solution_analysis.md",
    ):
        assert capability in script
    assert any(item["id"] == "businessProblem" for item in tasks["inputs"])
    assert "-BusinessProblem" in factory_task["args"]
    # The factory refuses an incomplete briefing, so the task must collect every field.
    for flag, input_id in (
        ("-ProjectGoal", "projectGoal"),
        ("-BusinessProblem", "businessProblem"),
        ("-SuccessMetric", "successMetric"),
        ("-AvailableSources", "availableSources"),
        ("-RiskLevel", "riskLevel"),
    ):
        position = factory_task["args"].index(flag)
        assert factory_task["args"][position + 1] == "${input:" + input_id + "}"
        assert any(item["id"] == input_id for item in tasks["inputs"])
    assert "-AllowIncompleteBriefing" not in factory_task["args"]
    risk_input = next(item for item in tasks["inputs"] if item["id"] == "riskLevel")
    assert risk_input["options"] == ["baixo", "medio", "alto", "critico"]
    assert "default" not in risk_input


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
    assert "mlflow" not in churn["technology_layer"]["recommended_technology_ids"]
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


def test_ai_factory_menu_creates_projects_without_swarm():
    root = Path(__file__).resolve().parents[1]
    menu = (root / "scripts" / "ai_factory_menu.ps1").read_text(encoding="utf-8-sig")
    assert "Criar projeto IA/ML completo" in menu
    assert "swarm" not in menu.lower()
    assert "Read-Briefing" in menu
    for field in ("ProjectGoal", "BusinessProblem", "SuccessMetric", "AvailableSources", "RiskLevel"):
        assert field in menu
    assert menu.count("@Briefing") == 2
    assert "Criar projeto IA/ML offline apenas com memoria local" in menu
    assert "Read-ProjectUniverse" in menu
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
    assert "mlflow" not in training
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
    assert "Outliers (IQR)" in report
    # z-score outlier detection is mathematically incapable of flagging any
    # point at the default threshold with only 4 rows (max |z| < 3 for n=4),
    # so this fixture only proves the section renders, not that it can flag.
    # test_data_treatment_flags_outliers_by_zscore below proves the real flag.
    assert "Outliers (Z-score)" in report


def test_data_treatment_flags_outliers_by_zscore(tmp_path):
    raw_path = tmp_path / "data" / "raw" / "medicoes.csv"
    report_path = tmp_path / "output" / "data_treatment" / "medicoes_report.md"
    raw_path.parent.mkdir(parents=True)
    normal_values = [100, 102, 98, 101, 99, 100, 103, 97, 100, 101] * 2 + [100000]
    rows = ["id,valor"] + [f"{index},{value}" for index, value in enumerate(normal_values)]
    raw_path.write_text("\n".join(rows), encoding="utf-8")

    result = treat_dataset(raw_path, report_path=report_path)

    treated = result.output_path.read_text(encoding="utf-8")
    report = report_path.read_text(encoding="utf-8")
    assert "valor_is_outlier_zscore" in treated
    assert "valor_is_outlier_iqr" in treated
    assert "outlier(s) por z-score" in report


def test_data_treatment_warns_and_stays_project_local_when_input_outside_data_raw(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    raw = tmp_path / "uploads" / "clientes.csv"
    raw.parent.mkdir()
    raw.write_text("idade\n20\n30\n40\n", encoding="utf-8")

    result = treat_dataset(raw, report_path=tmp_path / "report.md")

    assert result.output_path.resolve() == tmp_path / "data" / "processed" / "clientes_treated.csv"
    assert result.output_path.exists()
    assert any("nao esta dentro de data/raw" in warning for warning in result.warnings)


def test_data_treatment_reads_thresholds_from_policy_not_hardcoded(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    raw = tmp_path / "data" / "raw" / "sample.csv"
    raw.parent.mkdir(parents=True)
    raw.write_text("id,valor\n1,10\n2,11\n3,9\n4,10\n5,10\n6,300\n", encoding="utf-8")

    baseline = treat_dataset(raw, report_path=tmp_path / "baseline_report.md")
    assert baseline.report_path.read_text(encoding="utf-8").count("outlier(s) por IQR (") > 0
    assert "1 outlier(s) por IQR" in [
        line for line in baseline.report_path.read_text(encoding="utf-8").splitlines() if "`valor`" in line and "IQR" in line
    ][0]

    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "data_treatment_policy.json").write_text(
        json.dumps({"default_thresholds": {"iqr_multiplier": 1000.0}}),
        encoding="utf-8",
    )

    widened = treat_dataset(raw, report_path=tmp_path / "widened_report.md")
    widened_line = [
        line for line in widened.report_path.read_text(encoding="utf-8").splitlines() if "`valor`" in line and "IQR" in line
    ][0]
    assert "0 outlier(s) por IQR" in widened_line


def test_context_policy_filters_workspace_noise_before_llm_calls():
    policy = load_context_policy()
    assert is_ignored_path("node_modules/pkg/index.js", policy)
    assert is_ignored_path("build/.next/dev/cache/turbopack/blob.sst", policy)
    assert is_ignored_path("adonex/dist/extension.js.map", policy)
    assert is_ignored_path("output/data/report.json", policy)
    assert is_ignored_path(".codex/config.toml", policy)
    assert not is_ignored_path("scripts/synapse_lib/eval_service.py", policy)

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
            "-AllowIncompleteBriefing",
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
    agent_governance_spec = project / "docs" / "specifications" / "agent_governance.md"
    agentic_patterns_spec = project / "docs" / "specifications" / "agentic_architectural_patterns.md"
    agent_certification = project / "docs" / "checklists" / "agent_certification.md"
    agent_sre = project / "docs" / "runbooks" / "agent_sre.md"
    assert diagnose_result.returncode == 0, diagnose_result.stderr
    assert not (project / "backend").exists()
    assert not (project / "frontend").exists()
    assert not (project / "scripts" / "create_ai_project.ps1").exists()
    assert (project / "config" / "roles.json").exists()
    assert not (project / "agents" / "definitions" / "enterprise_agents.yaml").exists()
    assert not (project / "config" / "agent_fleets.json").exists()
    assert not (project / "config" / "agent_trust_framework.json").exists()
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
    assert (project / "docs" / "runbooks" / "peer_messaging.md").exists()
    assert (project / "scripts" / "synapse_solution_peers_mcp.py").exists()
    assert not (project / "scripts" / "synapse_peers_mcp.py").exists()
    assert (project / "tests" / "test_project_contract.py").exists()
    assert (project / "tests" / "test_evals_contract.py").exists()
    assert (project / "tests" / "test_data_contract.py").exists()
    assert (project / ".vscode" / "settings.json").exists()
    assert (project / ".vscode" / "extensions.json").exists()
    tasks = json.loads((project / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    assert any(task["label"] == "Synapse: Rodar testes do projeto" for task in tasks["tasks"])
    env_example = (project / ".env.example").read_text(encoding="utf-8-sig")
    assert "ACTIVE_AGENTS" not in env_example
    assert "SWARM" not in env_example
    assert "PROJECT_DEFAULT_MODEL_TIER=economy" in env_example
    mcp = json.loads((project / ".mcp.json").read_text(encoding="utf-8-sig"))
    assert mcp["mcpServers"]["synapse-peers"]["args"] == ["scripts/synapse_solution_peers_mcp.py"]
    assert mcp["mcpServers"]["synapse-peers"]["env"]["PEER_MESSAGING_MAX_MESSAGE_CHARS"] == "1200"
    settings = json.loads((project / ".vscode" / "settings.json").read_text(encoding="utf-8-sig"))
    assert settings["task.allowAutomaticTasks"] == "on"
    assert not (project / "adonex").exists()
    assert not (project / "config" / "workflows" / "synapse" / "new-ai-project.json").exists()
    solution_contract = json.loads(
        (project / "config" / "synapse_solution_contract.json").read_text(encoding="utf-8-sig")
    )
    assert solution_contract["managed_by"] == "synapse"
    assert solution_contract["factory_capable"] is False
    assert solution_contract["contains_backend"] is False
    assert solution_contract["contains_frontend"] is False
    assert "swarm_runtime" not in solution_contract
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
    assert agent_governance_spec.exists()
    assert agentic_patterns_spec.exists()
    assert agent_certification.exists()
    assert agent_sre.exists()
    diagnostics = diagnostics_json.read_text(encoding="utf-8-sig")
    assert '"overall_status":  "passed"' in diagnostics or '"overall_status": "passed"' in diagnostics
    assert "ai_framework_count" in diagnostics
    assert "blueprint_contract_json" in diagnostics
    assert "improvement_loop_json" in diagnostics
    assert "agent_governance_spec" in diagnostics
    assert "agentic_patterns_spec" in diagnostics
    assert "agent_certification" in diagnostics
    assert "agent_sre_runbook" in diagnostics
    assert "business_solution_analysis_json" in diagnostics
    assert "business_solution_analysis_md" in diagnostics
    assert "llm_solution_factory_policy" in diagnostics
    assert "llm_solution_factory_governance" in diagnostics
    assert "runtime_assistant_inheritance" in diagnostics
    assert "mcp_peer_standalone_script" in diagnostics
    assert "master_data_treatment_prompt" in diagnostics


@pytest.mark.parametrize(
    ("project_type", "project_name", "expected_capabilities"),
    [
        ("ML", "generated_ml_project", {"ml": True, "ai": False, "rag": False, "data_treatment": True}),
        ("IA", "generated_ia_project", {"ml": False, "ai": True, "rag": True, "data_treatment": True}),
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
            "-AllowIncompleteBriefing",
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
    assert (project / "config" / "roles.json").exists()
    assert not (project / "agents" / "definitions" / "enterprise_agents.yaml").exists()
    assert not (project / "config" / "agent_fleets.json").exists()
    assert not (project / "config" / "agent_trust_framework.json").exists()
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
    assert (project / "docs" / "runbooks" / "peer_messaging.md").exists()
    assert (project / "scripts" / "synapse_solution_peers_mcp.py").exists()
    assert not (project / "scripts" / "synapse_peers_mcp.py").exists()
    assert (project / ".vscode" / "settings.json").exists()
    assert (project / ".vscode" / "extensions.json").exists()
    tasks = json.loads((project / ".vscode" / "tasks.json").read_text(encoding="utf-8-sig"))
    assert any(task["label"] == "Synapse: Rodar testes do projeto" for task in tasks["tasks"])
    env_example = (project / ".env.example").read_text(encoding="utf-8-sig")
    assert "ACTIVE_AGENTS" not in env_example
    assert "SWARM" not in env_example
    assert "PROJECT_DEFAULT_MODEL_TIER=economy" in env_example
    mcp = json.loads((project / ".mcp.json").read_text(encoding="utf-8-sig"))
    assert mcp["mcpServers"]["synapse-peers"]["args"] == ["scripts/synapse_solution_peers_mcp.py"]
    assert "scripts/synapse_peers_mcp.py" not in mcp["mcpServers"]["synapse-peers"]["args"]
    runtime = json.loads((project / "config" / "runtime_manifest.json").read_text(encoding="utf-8-sig"))
    assert runtime["assistant_inheritance"]["enabled"] is True
    assert runtime["assistant_inheritance"]["user_request_channels"] == [
        "VS Code Chat",
        "Claude Code",
        "Codex",
    ]
    assert "chats autorizados antes de usar tasks" in runtime["assistant_inheritance"]["content_collection_rule"]
    assert runtime["assistant_inheritance"]["shared_solution_factory_access"]["policy"] == "config/llm_solution_factory_policy.json"
    shared_access = runtime["assistant_inheritance"]["shared_solution_factory_access"]
    if expected_capabilities["ai"]:
        assert shared_access["technology_catalog"] == "config/ai_framework_selection.json"
    else:
        # ML projects do not receive the AI technology catalog, so they must not point to it.
        assert "technology_catalog" not in shared_access
        assert runtime["rag"]["ready"] is False and runtime["fine_tuning"]["enabled"] is False
    if not expected_capabilities["ml"]:
        assert "ml_foundations_policy" not in shared_access
    assert runtime["mcp"]["peer_messaging_script"] == "scripts/synapse_solution_peers_mcp.py"
    assert runtime["assistant_inheritance"]["peer_messaging"]["script"] == "scripts/synapse_solution_peers_mcp.py"
    assert "config/business_solution_analysis.json" in runtime["validation"]["required_practice_paths"]
    assert "config/llm_solution_factory_policy.json" in runtime["validation"]["required_practice_paths"]
    assert "docs/specifications/llm_solution_factory_governance.md" in runtime["validation"]["required_practice_paths"]
    generated_agents = (project / "AGENTS.md").read_text(encoding="utf-8-sig")
    generated_claude = (project / "CLAUDE.md").read_text(encoding="utf-8-sig")
    assert "Canais autorizados para conteudo solicitado pelo usuario" in generated_agents
    assert "Canais autorizados para conteudo solicitado pelo usuario" in generated_claude
    analysis = json.loads((project / "config" / "business_solution_analysis.json").read_text(encoding="utf-8-sig"))
    assert analysis["requested_universe"] in {"ml", "ia", "chatbolt", "hybrid"}
    assert analysis["architecture_decision"]
    assert "tests/test_project_contract.py" in analysis["test_strategy"]
    settings = json.loads((project / ".vscode" / "settings.json").read_text(encoding="utf-8-sig"))
    assert settings["task.allowAutomaticTasks"] == "on"
    assert not (project / "adonex").exists()

    assert (project / "tests" / "test_harness_contract.py").exists()
    assert (project / "config" / "harness_engineering_policy.json").exists()
    assert "tests/test_harness_contract.py" in runtime["validation"]["required_practice_paths"]
    registry = json.loads((project / "config" / "book_registry.json").read_text(encoding="utf-8-sig"))
    universe_id = analysis["effective_universe"]
    for book in registry["books"]:
        if universe_id in book["universes"] and book["domains"] != ["voice"]:
            assert any((project / path).exists() for path in book["applied_in"]), (universe_id, book["id"])
    roles = {role["id"] for role in json.loads((project / "config" / "roles.json").read_text(encoding="utf-8-sig"))["roles"]}
    assert set(analysis["execution_strategy"]["roles"]) <= roles
    assert "swarm_strategy" not in analysis
    task_labels = {task["label"] for task in tasks["tasks"]}
    assert "Synapse: Auditar harness engineering" in task_labels

    if expected_capabilities["ai"]:
        assert (project / "config" / "rag_scalability_policy.json").exists()
        assert (project / "config" / "fine_tuning_policy.json").exists()
        assert (project / "templates" / "rag" / "rag_pipeline.py").exists()
        assert (project / "evals" / "retrieval_cases.jsonl").exists()
        assert "Evals: Rodar retrieval hibrido (recall@k, MRR, nDCG)" in task_labels
        assert analysis["rag_scalability"]["active"] is True
        assert (project / "config" / "ai_framework_selection.json").exists()
        assert (project / "docs" / "specifications" / "technology_layer.md").exists()
        assert "docs/specifications/technology_layer.md" in runtime["validation"]["required_practice_paths"]
        assert (project / "rag_pipelines").exists()
        assert (project / "tests" / "test_ai_contract.py").exists()
    else:
        assert not (project / "config" / "ai_framework_selection.json").exists()
        assert not (project / "config" / "rag_scalability_policy.json").exists()
        assert not (project / "config" / "fine_tuning_policy.json").exists()
        assert not (project / "vector_db").exists()
        assert not (project / "templates" / "rag").exists()
        assert not (project / "evals" / "retrieval_cases.jsonl").exists()
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

    # Scaffold targets are files the project is expected to create, so they may not exist yet.
    scaffold_targets = set(analysis.get("solution_scaffold_targets", []))
    scaffold_targets |= set(analysis.get("technology_layer", {}).get("scaffold_targets", []))
    if (project / "config" / "ai_framework_selection.json").exists():
        catalog = json.loads((project / "config" / "ai_framework_selection.json").read_text(encoding="utf-8-sig"))
        scaffold_targets |= {t for tech in catalog["technology_catalog"] for t in tech.get("scaffold_targets", [])}
    dangling = {k: v for k, v in _missing_project_references(project).items() if k not in scaffold_targets}
    assert not dangling, dangling
    readme = (project / "README.md").read_text(encoding="utf-8-sig")
    assert "$(" not in readme and "$TipoProjeto" not in readme, "README must render interpolated values"

    test_run = subprocess.run(
        [sys.executable, "-m", "pytest", "tests"],
        cwd=project,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert test_run.returncode == 0, test_run.stdout + test_run.stderr


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


def test_ml_eval_service_runs_contract_cases(tmp_path):
    service = EvalService(root=Path(__file__).resolve().parents[1])
    result = service.run_ml_eval()

    assert result["eval_type"] == "ml"
    assert result["cases_total"] == 2
    assert "pass_rate" in result["metrics"]
    assert "mlflow" not in result


def test_ai_eval_service_runs_prompt_cases():
    service = EvalService(root=Path(__file__).resolve().parents[1])
    result = service.run_ai_eval()

    assert result["eval_type"] == "ai_prompt"
    assert result["cases_total"] == 2
    assert "pass_rate" in result["metrics"]
    assert "mlflow" not in result


def test_rag_eval_service_grounds_answers_in_their_cited_source():
    service = EvalService(root=Path(__file__).resolve().parents[1])
    result = service.run_rag_eval()

    assert result["eval_type"] == "rag"
    assert result["cases_total"] == 2
    assert result["passed"]
    assert "avg_term_coverage" in result["metrics"]
    for case_result in result["results"]:
        assert case_result["checks"]["citation_present"]
        assert case_result["checks"]["source_exists"]


def test_rag_eval_service_fails_ungrounded_claims(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "runtime_manifest.json").write_text(
        json.dumps({"swarm": {"topology": "hierarchical-mesh"}}), encoding="utf-8"
    )
    (tmp_path / "evals").mkdir()
    (tmp_path / "evals" / "rag_cases.jsonl").write_text(
        json.dumps(
            {
                "id": "rag-hallucination",
                "query": "What is the swarm topology?",
                "expected_source": "config/runtime_manifest.json",
                "expected_answer_contains": ["a-term-that-does-not-exist-in-the-source"],
                "metric": "faithfulness",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    service = EvalService(root=tmp_path)
    result = service.run_rag_eval(cases_path="evals/rag_cases.jsonl")

    assert result["passed"] is False
    assert result["results"][0]["checks"]["faithfulness_grounded"] is False
    assert "not grounded" in result["results"][0]["notes"][0]


def test_data_treatment_report_includes_advanced_statistics(tmp_path):
    raw = tmp_path / "data" / "raw" / "clientes.csv"
    raw.parent.mkdir(parents=True)
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


def test_foundations_notebook_is_executable_json_contract():
    notebook = json.loads(Path("notebooks/foundations/foundations_lab.ipynb").read_text(encoding="utf-8"))

    assert notebook["nbformat"] == 4
    assert any("tokenize" in "".join(cell.get("source", [])) for cell in notebook["cells"])
    assert any("retrieval_eval" in "".join(cell.get("source", [])) for cell in notebook["cells"])


def test_assistant_provider_boundaries_are_fixed():
    root = Path(__file__).resolve().parents[1]
    policy = json.loads((root / 'config' / 'llm_solution_factory_policy.json').read_text(encoding='utf-8'))
    providers = json.loads((root / 'config' / 'model_providers.json').read_text(encoding='utf-8'))
    runtime = json.loads((root / 'config' / 'runtime_manifest.json').read_text(encoding='utf-8'))
    expected = {
        'codex': {'provider': 'openai', 'direct_generation': True},
        'claude_code': {'provider': 'anthropic', 'direct_generation': True},
    }
    assert policy['assistant_provider_boundaries'] == expected
    assert providers['assistant_provider_boundaries'] == expected
    assert runtime['assistant_provider_boundaries'] == expected
    assert 'codex_mcp_server' not in runtime['local_llm']
    assert 'SYNAPSE_ollama' not in (root / '.codex' / 'config.toml').read_text(encoding='utf-8')
    assert not (root / 'adonex').exists()


def test_generated_project_inherits_business_transformation_assets(tmp_path):
    root = Path(__file__).resolve().parents[1]
    project_name = "agentic_transformation_test"
    command = [
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
        "-SkipActivation",
        "-AllowIncompleteBriefing",
    ]
    completed = subprocess.run(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr

    project = tmp_path / project_name
    required = [
        "config/business_transformation.json",
        "config/workflows/synapse/business-transformation.json",
        "agents/definitions/business_transformation_agents.yaml",
        "prompts/business_transformation.md",
        "docs/AGENTIC_AI_TRANSFORMATION.md",
    ]
    assert all((project / relative).exists() for relative in required)
    assert not (project / "backend").exists()
    assert not (project / "frontend").exists()

    manifest = json.loads((project / "config/runtime_manifest.json").read_text(encoding="utf-8-sig"))
    contract = json.loads(
        (project / "config/synapse_solution_contract.json").read_text(encoding="utf-8-sig")
    )
    assert manifest["business_transformation"]["enabled"] is True
    assert "business-transformation" in manifest["validation"]["required_workflows"]
    assert contract["capabilities"]["agentic_business_transformation"] is True

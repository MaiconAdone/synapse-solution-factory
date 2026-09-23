"""Contracts for scalable RAG / vector DB, fine-tuning governance and harness
engineering, plus cross-file consistency guards found in the universe audit."""

import json
import py_compile
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer
from scripts.synapse_lib.eval_service import EvalService
from scripts.synapse_lib.fine_tuning_service import AdaptationAdvisor, FineTuningDatasetBuilder, FineTuningError
from scripts.synapse_lib.harness_service import HarnessAuditor, pass_at_k, pass_hat_k, summarize_trials
from scripts.synapse_lib.rag_retrieval import (
    BM25Index,
    HybridRetriever,
    chunk_text,
    mean_reciprocal_rank,
    ndcg_at_k,
    recall_at_k,
    reciprocal_rank_fusion,
)
from scripts.synapse_lib.rag_scalability import RagScalabilityPlanner, RagScaleRequirements
from scripts.synapse_lib.vector_store import HashingEmbedder, InMemoryVectorStore, VectorRecord, VectorStoreError

ROOT = Path(__file__).resolve().parents[1]


def load(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8-sig"))


# --- vector store -----------------------------------------------------------


def test_in_memory_vector_store_filters_acl_and_refuses_mixed_embeddings():
    embedder = HashingEmbedder(dimension=64)
    store = InMemoryVectorStore(embedder.model_id, embedder.dimension)
    texts = ["refund policy for orders", "shipping delay policy", "internal salary table"]
    vectors = embedder.embed(texts)
    store.upsert(
        [
            VectorRecord("a", vectors[0], texts[0], {"tenant_id": "t1"}),
            VectorRecord("b", vectors[1], texts[1], {"tenant_id": "t2"}),
            VectorRecord("c", vectors[2], texts[2], {"tenant_id": "t1", "permissions": ["hr"]}),
        ]
    )

    query = embedder.embed(["refund policy"])[0]
    assert store.query(query, 1)[0].id == "a"
    assert {hit.id for hit in store.query(query, 5, filters={"tenant_id": "t2"})} == {"b"}
    assert "c" not in {hit.id for hit in store.query(query, 5)}
    assert "c" in {hit.id for hit in store.query(query, 5, principals={"hr"})}

    with pytest.raises(VectorStoreError):
        store.upsert([VectorRecord("d", vectors[0], "x", {"embedding_model": "other-model"})])
    with pytest.raises(VectorStoreError):
        store.upsert([VectorRecord("e", np.ones(8), "x")])

    assert store.delete(["a", "missing"]) == 1
    assert store.count() == 2


def test_hashing_embedder_is_deterministic_and_normalized():
    embedder = HashingEmbedder(dimension=128)
    first, second = embedder.embed(["Busca híbrida", "Busca híbrida"])
    assert np.allclose(first, second)
    assert np.isclose(np.linalg.norm(first), 1.0)


# --- retrieval ----------------------------------------------------------------


def test_chunk_text_has_stable_ids_overlap_and_required_metadata():
    text = "\n\n".join(f"paragraph {index} " + "word " * 40 for index in range(6))
    chunks = chunk_text(text, "docs/a.md", chunk_size_tokens=100, chunk_overlap_tokens=10)
    again = chunk_text(text, "docs/a.md", chunk_size_tokens=100, chunk_overlap_tokens=10)

    assert len(chunks) > 1
    assert [chunk.id for chunk in chunks] == [chunk.id for chunk in again]
    assert all(len(chunk.text.split()) <= 100 + 10 for chunk in chunks)
    assert {"source_id", "document_id", "chunk_index", "content_hash"} <= set(chunks[0].metadata)
    with pytest.raises(ValueError):
        chunk_text(text, "x", chunk_size_tokens=10, chunk_overlap_tokens=10)


def test_bm25_and_reciprocal_rank_fusion():
    index = BM25Index()
    index.add("1", "vector database index hnsw")
    index.add("2", "fine tuning lora adapters")
    assert index.search("hnsw index", 2)[0][0] == "1"

    fused = reciprocal_rank_fusion([["a", "b"], ["b", "c"]], k=60)
    assert fused[0][0] == "b"
    assert fused[0][1] == pytest.approx(1 / 62 + 1 / 61)


def test_hybrid_retriever_syncs_sources_and_enforces_acl():
    retriever = HybridRetriever(embedder=HashingEmbedder(dimension=128))
    retriever.sync_source("kb/a.md", chunk_text("pgvector hnsw index for postgres", "kb/a.md"))
    retriever.sync_source(
        "kb/secret.md",
        chunk_text("pgvector salary data", "kb/secret.md", metadata={"permissions": ["finance"]}),
    )

    assert retriever.retrieve("pgvector", k=5).sources() == ["kb/a.md"]
    assert "kb/secret.md" in retriever.retrieve("pgvector", k=5, principals={"finance"}).sources()

    outcome = retriever.sync_source("kb/a.md", chunk_text("qdrant payload filtering", "kb/a.md"))
    assert outcome["removed"] == 1
    assert "pgvector" not in retriever.retrieve("qdrant", k=5).chunks[0].text


def test_retrieval_metrics():
    assert recall_at_k(["x", "a", "b"], {"a", "b"}, 2) == 0.5
    assert mean_reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert ndcg_at_k(["a"], {"a"}, 5) == 1.0
    assert ndcg_at_k(["x", "a"], {"a"}, 5) < 1.0


def test_retrieval_eval_gates_pass_on_synapse_corpus():
    result = EvalService(root=ROOT).run_retrieval_eval()

    assert result["eval_type"] == "retrieval"
    assert result["cases_total"] >= 8
    assert result["passed"], result["metrics"]


# --- scalability planner ----------------------------------------------------------


def test_rag_planner_returns_pending_decisions_instead_of_guessing():
    plan = RagScalabilityPlanner(root=ROOT).plan(RagScaleRequirements())

    assert plan["status"] == "needs_user_decisions"
    assert plan["tier_provisional"] is True
    assert "expected_corpus_chunks_in_12_months" in plan["pending_user_decisions"]


def test_rag_planner_selects_tier_store_index_and_memory():
    planner = RagScalabilityPlanner(root=ROOT)
    team = planner.plan(RagScaleRequirements(expected_chunks=2_000_000, existing_database="postgres"))
    assert team["tier"] == "team"
    assert team["vector_store_candidates"][0] == "pgvector"
    assert team["index"]["type"] == "hnsw"
    assert team["memory_estimate"]["vector_bytes"] == 2_000_000 * 384 * 4

    enterprise = planner.plan(
        RagScaleRequirements(expected_chunks=50_000_000, data_sensitivity="restricted", multi_tenant=True)
    )
    assert enterprise["tier"] == "enterprise"
    assert "pinecone" not in enterprise["vector_store_candidates"]
    assert enterprise["isolation"] == "dedicated deployment per tenant"

    assert planner.plan(RagScaleRequirements(expected_chunks=500_000_000))["tier"] == "massive"


# --- fine-tuning ----------------------------------------------------------------


def test_adaptation_advisor_follows_prompt_rag_fine_tuning_ladder():
    advisor = AdaptationAdvisor()
    knowledge = advisor.recommend("responder com base em documentos e fontes internas", "ia")
    assert knowledge["recommended_stage"] == "rag"

    blocked = advisor.recommend("padronizar formato JSON com fine-tuning", "ia")
    assert blocked["recommended_stage"] != "fine_tuning"
    assert "no_measured_baseline" in blocked["fine_tuning_blockers"]

    ready = advisor.recommend(
        "padronizar formato JSON e reduzir custo com LoRA", "hybrid", baseline_measured=True, approved_examples=120
    )
    assert ready["recommended_stage"] == "fine_tuning"
    assert advisor.recommend("prever churn", "ml")["recommended_stage"] == "not_applicable"


def _example(prompt, answer, score=0.9):
    return {
        "messages": [{"role": "user", "content": prompt}, {"role": "assistant", "content": answer}],
        "human_score": score,
    }


def test_fine_tuning_dataset_builder_dedups_excludes_pii_and_splits_without_leakage(tmp_path):
    rows = [_example(f"classificar ticket {index}", f"categoria {index % 3}") for index in range(80)]
    rows.append(_example("classificar ticket 1", "categoria 1"))  # duplicate
    rows.append(_example("meu email e ana@example.com", "ok"))  # PII
    rows.append(_example("baixa qualidade", "x", score=0.2))
    rows.append({"messages": [{"role": "assistant", "content": "sem usuario"}], "human_score": 1})
    source = tmp_path / "data" / "learning" / "examples.jsonl"
    source.parent.mkdir(parents=True)
    source.write_text("\n".join(json.dumps(row) for row in rows) + "\nnot json\n", encoding="utf-8")

    report = FineTuningDatasetBuilder(root=tmp_path).prepare("data/learning/examples.jsonl")

    assert report["counts"]["accepted"] == 80
    assert report["counts"]["duplicates_removed"] == 1
    assert report["counts"]["input_rows"] == 85
    assert report["counts"]["train"] + report["counts"]["validation"] == 80
    assert report["counts"]["validation"] > 0
    assert report["warnings"]
    assert report["ready_for_human_review"] is True
    assert report["automatic_weight_updates"] is False
    train = (tmp_path / "artifacts/fine_tuning/train.jsonl").read_text(encoding="utf-8")
    assert "ana@example.com" not in train

    production = FineTuningDatasetBuilder(root=tmp_path).prepare("data/learning/examples.jsonl", tier="production")
    assert production["ready_for_human_review"] is False
    with pytest.raises(FineTuningError):
        FineTuningDatasetBuilder(root=tmp_path).prepare("../outside.jsonl")


# --- harness engineering --------------------------------------------------------


def test_pass_at_k_and_pass_hat_k():
    assert pass_at_k(3, 0, 1) == 0.0
    assert pass_at_k(3, 1, 3) == 1.0
    assert pass_hat_k(3, 1, 3) == 0.0
    assert pass_hat_k(4, 3, 2) == pytest.approx(3 / 6)
    summary = summarize_trials({"a": [True, True, True], "b": [True, False, False]}, k=3)
    assert summary["pass_at_k"] == 1.0
    assert summary["pass_hat_k"] == 0.5
    with pytest.raises(ValueError):
        pass_at_k(2, 3, 1)


@pytest.mark.parametrize("universe", ["ml", "ia", "chatbolt", "hybrid"])
def test_synapse_harness_is_ready_for_every_universe(universe):
    report = HarnessAuditor(root=ROOT).audit(universe)

    assert report["harness_ready"], report["components"]
    component_ids = {item["id"] for item in report["components"]}
    assert ("agent_evals" in component_ids) == (universe != "ml")


def test_harness_auditor_reports_missing_evidence(tmp_path):
    report = HarnessAuditor(root=tmp_path, policy=load("config/harness_engineering_policy.json")).audit("ia")
    assert report["harness_ready"] is False
    assert report["score"] == 0.0


# --- analyzer and catalogs ---------------------------------------------------------


@pytest.mark.parametrize("universe", ["ML", "IA", "Chatbolt", "hybrid"])
def test_analyzer_exposes_rag_fine_tuning_and_harness_sections(universe):
    analysis = BusinessSolutionAnalyzer(root=ROOT).analyze(
        project_goal="Assistente de suporte",
        business_problem="Responder clientes com base em documentos internos em Postgres",
        requested_universe=universe,
    )
    effective = analysis["effective_universe"]
    ai = effective in {"ia", "chatbolt", "hybrid"}

    assert analysis["rag_scalability"]["active"] is ai
    assert analysis["model_adaptation"]["active"] is ai
    assert analysis["harness_engineering"]["components"]
    assert "tests/test_harness_contract.py" in analysis["test_strategy"]
    if ai:
        assert analysis["rag_scalability"]["plan"]["pending_user_decisions"]
        assert "config/rag_scalability_policy.json" in analysis["required_artifacts"]
        assert any("retrieval_cases" in item for item in analysis["eval_strategy"])
    roles = {role["id"] for role in load("config/roles.json")["roles"]}
    assert set(analysis["execution_strategy"]["roles"]) <= roles
    assert analysis["execution_strategy"]["default"] == "single_assistant_first"
    markdown = BusinessSolutionAnalyzer(root=ROOT).to_markdown(analysis)
    assert "## Harness Engineering" in markdown


def test_roles_per_universe_exist():
    roles = load("config/roles.json")
    ids = {role["id"] for role in roles["roles"]}

    assert set(roles["by_universe"]) == {"ml", "ia", "chatbolt", "hybrid"}
    for universe, role_ids in roles["by_universe"].items():
        assert role_ids and set(role_ids) <= ids, universe
    assert set(roles["business_transformation_roles"]) <= ids


def test_swarm_fleets_trust_framework_and_agent_activation_are_gone():
    for path in ("config/agent_fleets.json", "config/agent_trust_framework.json", "agents/definitions/enterprise_agents.yaml"):
        assert not (ROOT / path).exists(), path
    runtime = load("config/runtime_manifest.json")
    assert not {"swarm", "agentic_mesh", "generated_project_swarm_strategy"} & set(runtime)
    cost = load("config/cost_optimization_policy.json")
    assert "ruflo" not in cost and "activation_profiles" not in cost
    assert all("active_agent_limit" not in profile for profile in cost["request_profiles"].values())
    assert "activation_targets" not in load("config/ai_ml_enterprise_spec.json")["cost_aware_orchestration"]
    governance = load("config/harness_engineering_policy.json")["governance"]
    assert "external_action_requires_human_approval" in governance["authorization"]
    assert "activate_all_60_agents" not in governance["autonomy_matrix"]["requires_human_approval"]
    for doc in ("CLAUDE.md", "AGENTS.md", "README.md"):
        text = (ROOT / doc).read_text(encoding="utf-8-sig").lower()
        assert "60 agent" not in text and "_fleet" not in text and "trust framework" not in text, doc


def test_technology_catalog_templates_exist_and_new_technologies_are_selectable():
    catalog = load("config/ai_framework_selection.json")["technology_catalog"]
    for technology in catalog:
        for template in technology.get("templates", []):
            assert (ROOT / template).exists(), (technology["id"], template)

    from scripts.synapse_lib.ai_framework_selector import AiFrameworkSelector

    selection = AiFrameworkSelector().select("fine-tuning com LoRA e eval harness para agentes", universe="ia")
    layer = selection["technology_layer"]
    assert {"fine-tuning-peft", "agent-harness"} <= set(layer["recommended_technology_ids"])
    assert any(pipeline["id"] == "model_adaptation" for pipeline in selection["pipeline_blueprints"])
    assert "solution_scaffold_targets" in selection


def test_templates_compile_and_local_rag_pipeline_runs():
    py_compile.compile(str(ROOT / "templates/rag/vector_db_adapter.py"), doraise=True)
    completed = subprocess.run(
        [sys.executable, str(ROOT / "templates/rag/rag_pipeline.py"), "--query", "blue/green reindex alias", "--top-k", "2"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    output = json.loads(completed.stdout)
    assert "docs/specifications/scalable_rag_vector_db.md" in output["citations"]


def test_business_solution_analyzer_stays_stdlib_only():
    # create_ai_project.ps1 runs the analyzer with whatever `python` is on PATH,
    # which may not have numpy; block it to prove the import chain is stdlib-only.
    code = (
        "import sys; sys.modules['numpy'] = None; sys.path.insert(0, '.');"
        "from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer;"
        "a = BusinessSolutionAnalyzer().analyze(project_goal='x', business_problem='rag com documentos', requested_universe='IA');"
        "print(a['rag_scalability']['active'])"
    )
    completed = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "True"


# --- mechanical enforcement: no phantom references ----------------------------------

PATH_PATTERN = re.compile(
    r"(?<![\w/.-])((?:config|docs|scripts|templates|prompts|evals|playbooks|rag_pipelines|rag|vector_db|llm_ops|"
    r"ml_systems|guardrails|agents|notebooks|memory|tests)/[\w./-]+\.(?:jsonl|json|py|md|yaml|yml|ps1|ipynb))\b"
)
# Runtime files created on first write, or path patterns rather than files.
DECLARED_RUNTIME_PATHS = {
    "docs/radar/YYYY-MM-DD.md",
    "memory/approved_agent_blueprints.jsonl",
    "memory/approved_architecture_patterns.jsonl",
    "evals/teacher_review_cases.jsonl",
}


def test_referenced_repository_paths_exist_or_are_generated_or_declared_runtime():
    factory = "\n".join(
        path.read_text(encoding="utf-8-sig")
        for path in [ROOT / "scripts/create_ai_project.ps1", *sorted((ROOT / "scripts/project_factory").glob("*.ps1"))]
    ).replace("\\", "/")
    sources = [
        *sorted((ROOT / "config").rglob("*.json")),
        *sorted((ROOT / "config").rglob("*.yaml")),
        *sorted((ROOT / "docs").rglob("*.md")),
        *sorted((ROOT / "scripts/synapse_lib").glob("*.py")),
        ROOT / "CLAUDE.md",
        ROOT / "AGENTS.md",
        ROOT / "README.md",
    ]
    scaffold_targets = {
        target
        for technology in load("config/ai_framework_selection.json")["technology_catalog"]
        for target in technology.get("scaffold_targets", [])
    }
    phantom = {}
    for source in sources:
        for match in set(PATH_PATTERN.findall(source.read_text(encoding="utf-8-sig"))):
            if (ROOT / match).exists() or match in factory or match in DECLARED_RUNTIME_PATHS | scaffold_targets:
                continue
            phantom.setdefault(match, []).append(source.relative_to(ROOT).as_posix())
    assert not phantom, phantom


# --- runtime agents of IA / Chatbolt / Hybrid solutions ----------------------------


def test_workflows_use_only_defined_roles_and_agent_build_is_required():
    roles = {role["id"] for role in load("config/roles.json")["roles"]}
    for workflow_path in sorted((ROOT / "config/workflows/synapse").glob("*.json")):
        workflow = json.loads(workflow_path.read_text(encoding="utf-8-sig"))
        missing = [step["role"] for step in workflow.get("steps", []) if step["role"] not in roles]
        assert not missing, (workflow_path.name, missing)
    assert "agent-build" in load("config/runtime_manifest.json")["validation"]["required_workflows"]


def test_blueprint_contract_matches_cloud_provider_policy():
    contract = load("config/agent_blueprint_contract.json")
    runtime = load("config/runtime_manifest.json")

    assert runtime["local_llm"]["enabled"] is False
    assert "free_local_models" not in contract["model_strategy"]
    assert set(contract["model_strategy"]["providers"]) == {"openai", "anthropic"}
    assert set(contract["model_strategy"]["model_tiers"]) == {"economy", "balanced", "strong"}


def test_agentic_customer_service_request_keeps_ia_universe_with_agents():
    analysis = BusinessSolutionAnalyzer(root=ROOT).analyze(
        project_goal="Assistente de atendimento",
        business_problem="Cliente pergunta status do pedido atrasado, a IA consulta documentos, verifica sistema e abre ocorrencia",
        requested_universe="IA",
        success_metric_or_acceptance_criteria="80% resolvido sem humano",
        available_data_or_knowledge_sources="FAQ e API de pedidos",
        risk_level="medio",
    )

    assert analysis["effective_universe"] == "ia"
    assert analysis["ai_archetype"]["id"] == "chatbot_rag_agent"
    assert {"rag", "agents"} <= set(analysis["solution_stack"])
    assert analysis["universe_confirmation"]  # recommends chatbolt: must be confirmed in chat
    assert not [item for item in analysis["required_artifacts"] if "chatbot" in item]
    assert analysis["solution_agents"]["architecture"] == "orchestrator_with_specialists"


def test_solution_agents_blueprints_are_valid_and_gate_external_actions():
    from scripts.synapse_lib.solution_agents import build_solution_agents, validate_solution_agents

    analysis = BusinessSolutionAnalyzer(root=ROOT).analyze(
        project_goal="Agente de backoffice",
        business_problem="Consultar sistema ERP com base em documentos, gerar proposta e enviar email",
        requested_universe="IA",
    )
    document = build_solution_agents(analysis, ROOT)
    ids = {agent["agent_id"] for agent in document["agents"]}

    assert ids == {"solution-orchestrator", "knowledge-retriever", "action-executor"}
    assert validate_solution_agents(document, ROOT) == []
    executor = next(agent for agent in document["agents"] if agent["agent_id"] == "action-executor")
    assert executor["tools"] == []  # tools are confirmed with the user, never invented
    executor["human_approval_required"] = False
    assert any("human_approval_required" in problem for problem in validate_solution_agents(document, ROOT))
    with pytest.raises(ValueError):
        build_solution_agents({**analysis, "effective_universe": "ml"}, ROOT)

    synapse_agents = load("config/solution_agents.json")
    assert validate_solution_agents(synapse_agents, ROOT) == []


def test_generated_ia_agent_project_is_consistent_end_to_end(tmp_path):
    completed = subprocess.run(
        [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts" / "create_ai_project.ps1"),
            "-NomeProjeto", "ia_agent_project", "-TipoProjeto", "IA", "-DestinoBase", str(tmp_path), "-SkipActivation",
            "-ProjectGoal", "Assistente de atendimento",
            "-BusinessProblem", "Cliente pergunta status do pedido atrasado, a IA consulta documentos, verifica sistema e abre ocorrencia",
            "-SuccessMetric", "80% resolvido sem humano", "-AvailableSources", "FAQ e API de pedidos", "-RiskLevel", "medio",
        ],
        cwd=ROOT, capture_output=True, text=True, timeout=180, check=False,
    )
    assert completed.returncode == 0, completed.stdout[-2000:] + completed.stderr
    project = tmp_path / "ia_agent_project"
    analysis = json.loads((project / "config/business_solution_analysis.json").read_text(encoding="utf-8-sig"))

    assert analysis["effective_universe"] == "ia"
    assert {"rag", "agents"} <= set(analysis["solution_stack"])
    missing = [item for item in analysis["required_artifacts"] if not (project / item.split(" ")[0]).exists()]
    assert not missing, missing
    agents = json.loads((project / "config/solution_agents.json").read_text(encoding="utf-8-sig"))
    assert agents["universe"] == "ia"
    assert len(agents["agents"]) == 3
    runtime = json.loads((project / "config/runtime_manifest.json").read_text(encoding="utf-8-sig"))
    assert "agent-build" in runtime["validation"]["required_workflows"]

    test_run = subprocess.run([sys.executable, "-m", "pytest", "-q", "tests"], cwd=project, capture_output=True, text=True, timeout=180, check=False)
    assert test_run.returncode == 0, test_run.stdout + test_run.stderr

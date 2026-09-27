"""RAG vs Knowledge Graph vs GraphRAG: strategy planner, graph store, retriever and gates."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer
from scripts.synapse_lib.eval_service import EvalService
from scripts.synapse_lib.knowledge_graph import (
    Entity,
    GraphRagRetriever,
    InMemoryGraphStore,
    KnowledgeGraphError,
    Relation,
    expand,
    link_entities,
    load_graph,
    shortest_path,
)
from scripts.synapse_lib.knowledge_strategy import (
    KnowledgeGraphRequirements,
    KnowledgeStrategyPlanner,
    QueryRouter,
)
from scripts.synapse_lib.rag_retrieval import HybridRetriever, chunk_text

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE_GRAPH = ROOT / "templates/knowledge_graph/example_graph.json"


@pytest.fixture()
def graph():
    store = InMemoryGraphStore()
    load_graph(store, EXAMPLE_GRAPH)
    return store


# --- strategy planner -----------------------------------------------------------

def test_plain_document_search_stays_rag_without_graph_questions():
    plan = KnowledgeStrategyPlanner(root=ROOT).plan("Chatbot que responde duvidas sobre manuais e politicas em PDF")
    assert plan["strategy"] == "rag"
    assert plan["uses_graph"] is False
    assert plan["pending_user_decisions"] == []
    assert "graph_store_candidates" not in plan


def test_relationship_questions_over_documents_plan_graph_rag_and_ask_ontology_decisions():
    plan = KnowledgeStrategyPlanner(root=ROOT).plan(
        "Responder perguntas sobre contratos em PDF: relacao entre fornecedores, quem aprovou e cadeia de dependencias"
    )
    assert plan["strategy"] == "graph_rag"
    assert plan["status"] == "needs_user_decisions"
    assert "ontology_owner" in plan["pending_user_decisions"]
    assert plan["graph_store_tier_provisional"] is True
    assert plan["graph_retrieval"]["max_hops"] == 2


def test_structured_entities_without_documents_plan_knowledge_graph():
    plan = KnowledgeStrategyPlanner(root=ROOT).plan("Ontologia de entidades com hierarquia e rastreabilidade para auditoria")
    assert plan["strategy"] == "knowledge_graph"


def test_explicit_knowledge_graph_request_is_honored():
    assert KnowledgeStrategyPlanner(root=ROOT).plan("Quero um knowledge graph")["strategy"] == "knowledge_graph"


def test_graph_store_selection_respects_postgres_and_self_hosting():
    planner = KnowledgeStrategyPlanner(root=ROOT)
    text = "knowledge graph de relacionamentos entre entidades"
    postgres = planner.plan(text, KnowledgeGraphRequirements(expected_entities=500_000, existing_database="postgres"))
    assert postgres["graph_store_candidates"][0] == "postgres-age"
    restricted = planner.plan(text, KnowledgeGraphRequirements(expected_entities=50_000_000, hosting="self_hosted"))
    assert "amazon-neptune" not in restricted["graph_store_candidates"]
    assert restricted["graph_store_tier"] == "enterprise"


def test_query_router_uses_graph_only_for_relationship_questions_with_entities():
    router = QueryRouter(root=ROOT)
    assert router.route("Quem aprovou o contrato?", linked_entities=1)["strategy"] == "graph_rag"
    assert router.route("Quem aprovou o contrato?", linked_entities=0)["strategy"] == "rag"
    assert router.route("Qual o prazo de pagamento?", linked_entities=2)["strategy"] == "rag"


# --- graph store ------------------------------------------------------------------

def test_entity_resolution_merges_only_above_threshold(graph):
    merged = graph.upsert_entity(Entity(id="dup-acme", type="Organizacao", name="acme insumos", source_ids=["kb:x"]))
    assert merged == "org-acme"
    assert "kb:x" in graph.get_entity("org-acme").source_ids
    new_id = graph.upsert_entity(Entity(id="org-acme-sul", type="Organizacao", name="Acme Insumos Sul"))
    assert new_id == "org-acme-sul"
    assert graph.review_queue and graph.review_queue[-1]["action"] == "human_review"


def test_relations_require_provenance_and_existing_endpoints(graph):
    with pytest.raises(KnowledgeGraphError):
        graph.upsert_relation(Relation("org-acme", "prd-racao", "FORNECE"))
    with pytest.raises(KnowledgeGraphError):
        graph.upsert_relation(Relation("org-acme", "missing", "FORNECE", ("kb:x",)))
    graph.upsert_relation(Relation("org-beta", "prd-racao", "FORNECE", ("kb:y",), confidence=0.3))
    assert all(relation.key() != ("org-beta", "FORNECE", "prd-racao") for relation in graph.neighbors("org-beta"))


def test_linking_expansion_and_paths(graph):
    assert link_entities(graph, "Quem aprovou o contrato da Acme Insumos?") == ["org-acme"]
    hops, relations = expand(graph, ["org-acme"], max_hops=2)
    assert hops["pes-ana"] == 2
    assert all(relation.source_ids for relation in relations)
    path = shortest_path(graph, "pes-ana", "prd-racao", max_hops=3)
    assert [relation.type for relation in path] == ["APROVOU", "COBRE"]


def test_acl_hides_restricted_entities_and_relations(graph):
    _, public = expand(graph, ["ctr-002"], max_hops=1)
    assert "pes-carla" not in {entity for relation in public for entity in (relation.source, relation.target)}
    _, board = expand(graph, ["ctr-002"], max_hops=1, principals={"diretoria"})
    assert "pes-carla" in {entity for relation in board for entity in (relation.source, relation.target)}
    assert link_entities(graph, "Carla Dias aprovou?") == []


# --- GraphRAG retriever (composes the existing HybridRetriever) ---------------------

def _documents_retriever():
    retriever = HybridRetriever()
    documents = {
        "kb:contrato-001": "Contrato 001 assinado pela Acme Insumos cobre Racao Premium com entrega mensal.",
        "kb:ata-aprovacao-001": "Ata de aprovacao: Ana Souza aprovou o Contrato 001 em reuniao de compras.",
        "kb:politica-pagamento": "Politica interna: prazo padrao de pagamento de fornecedores e de 30 dias.",
        "kb:contrato-002": "Contrato 002 com Beta Logistica cobre Frete Refrigerado.",
    }
    for source_id, text in documents.items():
        retriever.index(chunk_text(text, source_id))
    return retriever


def test_graph_rag_retriever_adds_facts_paths_and_graph_sources(graph):
    result = GraphRagRetriever(_documents_retriever(), graph).retrieve("Quem aprovou o contrato da Acme Insumos?", k=3)
    assert result.strategy == "graph_rag"
    assert result.linked_entities == ["org-acme"]
    assert any(fact["predicate"] == "APROVOU" and fact["subject"] == "Ana Souza" for fact in result.facts)
    assert "kb:ata-aprovacao-001" in result.sources()
    assert result.chunks[0].metadata["source_id"] in {"kb:contrato-001", "kb:ata-aprovacao-001"}


def test_graph_rag_retriever_falls_back_to_rag_for_text_questions(graph):
    result = GraphRagRetriever(_documents_retriever(), graph).retrieve("Qual o prazo padrao de pagamento?", k=2)
    assert result.strategy == "rag"
    assert result.facts == []
    assert result.chunks[0].metadata["source_id"] == "kb:politica-pagamento"


# --- evals, analyzer and governance --------------------------------------------------

def test_graph_eval_gates_pass():
    result = EvalService(root=ROOT).run_graph_eval()
    assert result["eval_type"] == "knowledge_graph"
    assert result["passed"], result["results"]
    assert result["metrics"]["relation_citation_rate"] == 1.0


def test_analyzer_writes_knowledge_strategy_for_ai_universes_only():
    analyzer = BusinessSolutionAnalyzer(root=ROOT)
    ai = analyzer.analyze(
        project_goal="assistente de compras",
        business_problem="Responder sobre contratos em PDF e a relacao entre fornecedores, aprovadores e produtos, com auditoria.",
        requested_universe="IA",
    )
    knowledge = ai["knowledge_strategy"]
    assert knowledge["active"] is True
    assert knowledge["plan"]["strategy"] == "graph_rag"
    assert "config/knowledge_graph_policy.json" in ai["required_artifacts"]
    assert "Knowledge Strategy (RAG vs Knowledge Graph)" in analyzer.to_markdown(ai)
    assert ai["rag_scalability"]["active"] is True  # the RAG layer is kept, not replaced

    ml = analyzer.analyze(project_goal="previsao", business_problem="prever demanda mensal", requested_universe="ML")
    assert ml["knowledge_strategy"]["active"] is False
    assert not any(item.startswith("templates/knowledge_graph/") for item in ml["solution_templates"])


def test_knowledge_strategy_import_chain_is_stdlib_only():
    code = (
        "import sys; sys.modules['numpy'] = None; sys.path.insert(0, '.');"
        "from scripts.synapse_lib.knowledge_graph import InMemoryGraphStore;"
        "from scripts.synapse_lib.knowledge_strategy import KnowledgeStrategyPlanner;"
        "print(KnowledgeStrategyPlanner().plan('knowledge graph')['strategy'])"
    )
    completed = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "knowledge_graph"


def test_policy_references_existing_files_and_catalog_templates_exist():
    policy = json.loads((ROOT / "config/knowledge_graph_policy.json").read_text(encoding="utf-8-sig"))
    for path in [*policy["reference_implementation"].values(), policy["spec_path"], policy["evaluation"]["cases_path"]]:
        assert (ROOT / path).exists(), path
    catalog = json.loads((ROOT / "config/ai_framework_selection.json").read_text(encoding="utf-8-sig"))
    kag = next(item for item in catalog["technology_catalog"] if item["id"] == "kag-knowledge-graph")
    for template in kag["templates"]:
        assert (ROOT / template).exists(), template

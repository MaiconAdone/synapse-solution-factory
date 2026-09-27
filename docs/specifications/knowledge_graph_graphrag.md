# Knowledge Graph and GraphRAG Specification

Applies to IA, Chatbolt and Hybrid projects. Source of truth:
`config/knowledge_graph_policy.json`. Complements (never replaces)
`docs/specifications/scalable_rag_vector_db.md`: vector/hybrid RAG stays the
default knowledge layer.

## RAG vs Knowledge Graph

| | RAG | Knowledge Graph | GraphRAG (hybrid) |
|---|---|---|---|
| Nature | dynamic, textual | static, structured | both |
| Unit | chunk of unstructured text | entity + typed relationship | chunks re-ranked by graph |
| Retrieval | semantic + lexical search at query time | navigation by paths | hybrid search + entity linking + bounded expansion |
| Strength | coverage of loose documents | explicit, linked knowledge, semantic precision | multi-hop answers with citations |
| Weakness | depends on search quality; "loose" facts | needs ontology owner; resolution errors propagate | higher ingestion and eval cost |

## Strategy Decision

`scripts/synapse_lib/knowledge_strategy.py` (`KnowledgeStrategyPlanner`, stdlib
only) reads the brief and counts signal groups: `relationship`, `multi_hop`,
`entity_heavy`, `auditability`, plus `unstructured_text`.

- 2 or more graph groups (or an explicit "knowledge graph", "GraphRAG", "KAG")
  with document signals -> `graph_rag`.
- Same, without document signals -> `knowledge_graph`.
- Otherwise -> `rag` (default and cheapest).

The business solution analyzer writes the result to `knowledge_strategy` in
`config/business_solution_analysis.json`. The assistant confirms the strategy
in chat.

## Decisions To Collect In Chat

Only asked when a graph is planned (returned as `pending_user_decisions`):

- ontology owner
- entity and relation types
- sources of truth for each entity type
- graph update frequency
- expected entities in 12 months
- hosting constraint (self-hosted or managed)

## Graph Store Tiers

| Tier | Entities | Candidates |
|------|----------|------------|
| local | up to 100k | synapse-local-graph, Kuzu |
| team | up to 10M | Kuzu, Neo4j, Postgres + Apache AGE, Memgraph |
| enterprise | above 10M | Neo4j, Memgraph, Amazon Neptune |

Existing Postgres prefers Apache AGE; self-hosting or confidential/restricted
data excludes managed stores. Adapters implement the `GraphStore` protocol of
`scripts/synapse_lib/knowledge_graph.py` (see
`templates/knowledge_graph/graph_store_adapter.py`).

## Schema, Resolution and Provenance

- Schema template: `templates/knowledge_graph/graph_schema.yaml`; replace the
  example types with the ontology confirmed by the owner.
- Every entity has `id, type, name, aliases, source_ids, permissions`.
- Every relation has `source, target, type, source_ids, confidence,
  permissions`; relations without provenance are rejected.
- Entity resolution: exact normalized name/alias or token similarity. Merge
  automatically only at confidence >= 0.9; below that, queue for human review.
  Relations below 0.6 confidence go to review instead of the graph.
- ACL is enforced in the graph layer (same rule as vector chunks).

## GraphRAG Retrieval

`GraphRagRetriever` composes the existing `HybridRetriever` without changing it:

1. Link entities mentioned in the question.
2. `QueryRouter`: graph expansion only for relationship questions with at
   least one linked entity (cost rule `graph_rag_only_when_relationship_queries`).
3. Run hybrid text retrieval (ACL-filtered candidate pool).
4. Expand at most 2 hops / 25 entities; compute shortest paths between linked
   entities.
5. Rank candidates by relation provenance and entity mentions; fuse with the
   text ranking via reciprocal rank fusion.
6. Return chunks, facts (subject, predicate, object, source_ids) and paths so
   the answer cites every hop.

## Evaluation

`python scripts/run_evals.py graph` loads `templates/knowledge_graph/example_graph.json`
and gates `evals/graph_cases.jsonl` with `knowledge_graph` thresholds in
`evals/quality_gates.yaml`: routing accuracy, entity recall, path found rate,
relation citation rate, and no ACL leakage. Retrieval gates
(`python scripts/run_evals.py retrieval`) still apply to the text side.

## Observability

Log per query: strategy (rag or graph_rag), linked entities, hops expanded,
relations traversed. Track the entity-resolution review queue and graph
freshness lag against the sources of truth.

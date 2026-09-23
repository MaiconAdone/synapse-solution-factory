# Scalable RAG and Vector Database Specification

Applies to IA, Chatbolt and Hybrid projects. Source of truth:
`config/rag_scalability_policy.json`. Book lessons are translated into
operational rules; no book text is copied (see `docs/books/implementation_map.md`).

## Why

The bootstrap RAG pipeline (`rag_pipelines/pipeline.yaml`) proves grounding on
a small corpus. Production retrieval fails differently: corpora grow to
millions of chunks, embedding models change, tenants must not see each other's
documents, and recall silently regresses. This specification makes those
concerns explicit decisions instead of surprises.

## Decisions To Collect In Chat

Never guess these; the planner returns them as `pending_user_decisions`:

- expected corpus size (chunks) in 12 months
- peak queries per second and p95 retrieval latency budget
- multi-tenant isolation requirement
- data sensitivity (public, internal, confidential, restricted)
- hosting constraint (self-hosted or managed)
- existing database platform (Postgres, OpenSearch/Elasticsearch, none)

## Scale Tiers

| Tier | Chunks | Topology | Default index | Store candidates |
|------|--------|----------|---------------|------------------|
| local | up to 100k | single process | flat (exact) | synapse-local, FAISS, Chroma |
| team | up to 5M | single node server | HNSW | pgvector, Qdrant, Chroma |
| enterprise | up to 100M | replicated cluster | HNSW + int8 quantization | Qdrant, Weaviate, Milvus, Pinecone |
| massive | above 100M | distributed cluster | IVF-PQ or DiskANN | Milvus, Pinecone |

Selection rules: reuse Postgres through pgvector when it already exists and the
tier allows it; reuse an existing OpenSearch/Elasticsearch cluster for native
BM25 + kNN; exclude managed cloud stores for confidential/restricted data or
self-hosting constraints; prefer stores with namespaces or native tenants when
isolation is required.

## Index Selection And Memory

- Flat: exact recall, fine up to ~100k vectors.
- HNSW: default between 100k and ~50M vectors that fit in RAM. Start with
  `m=16`, `ef_construction=200`, `ef_search=100`; raise `ef_search` until the
  recall gate passes, then stop.
- Quantized HNSW: scalar int8 cuts raw vector memory by about 4x; binary
  quantization only with rescoring on full vectors.
- IVF-PQ / DiskANN: hundreds of millions of vectors or SSD-resident indexes;
  start near `nlist = 4 * sqrt(N)` and tune `nprobe` against recall and p95.
- Memory estimate: `chunks * dimension * 4` bytes for float32 vectors plus
  roughly `chunks * m * 2 * 4` bytes of HNSW links, before payload and replicas.

## Retrieval Pipeline

1. Pre-filter by metadata and ACL (tenant, permissions) before ranking.
2. Dense search (50 candidates) and BM25 lexical search (50 candidates).
3. Reciprocal rank fusion, `score = sum 1 / (60 + rank)`.
4. Rerank with a cross-encoder only when the dense top score is below 0.72.
5. Return the top 6 chunks with source ids for citations.
6. GraphRAG only for relationship-heavy questions.

Access control is enforced in the retrieval layer. The prompt is never the
security boundary.

## Index Lifecycle

- Name indexes `{collection}__{embedding_model}__v{version}` and serve through an alias.
- Never mix embedding models in one index; the reference store refuses it.
- Reindex on embedding model change, chunking change, metadata schema change or
  retrieval regression, using blue/green: build, evaluate, switch alias, keep the
  previous version for rollback.
- Incremental ingestion skips unchanged `content_hash`, upserts changed chunks
  and tombstones chunks that disappeared from a source.

## Caching

Embedding cache keyed by model + content hash; semantic answer cache with
similarity at least 0.95 and a 24h TTL, invalidated whenever the index version
changes.

## Evaluation Gates

Labeled queries live in `evals/retrieval_cases.jsonl`. Gates in
`evals/quality_gates.yaml` (`retrieval:` section) cover recall at k, mean
reciprocal rank and nDCG at k; faithfulness stays in the `rag:` section. An
index version is promoted only when these gates pass. Production adds p95
latency, cost per 1k queries and index freshness lag.

## Reference Implementation

- `scripts/synapse_lib/vector_store.py`: `VectorStore` adapter protocol,
  deterministic `HashingEmbedder`, `InMemoryVectorStore` with filters and ACL.
- `scripts/synapse_lib/rag_retrieval.py`: chunking with stable ids, BM25,
  RRF, `HybridRetriever`, recall/MRR/nDCG.
- `scripts/synapse_lib/rag_scalability.py`: `RagScalabilityPlanner`.
- `templates/rag/rag_pipeline.py`: end-to-end local pipeline.
- `templates/rag/vector_db_adapter.py`: pgvector and Qdrant adapter skeletons.
- `python scripts/run_evals.py retrieval`: runs the retrieval gates.

The hashing embedder is lexical, not semantic. It exists so retrieval contracts
are testable offline; production swaps in a semantic embedding model behind the
same interface and re-runs the same gates.

## Roles

`rag-engineering` owns chunking, indexes, retrieval and evaluation, with
`data-engineering` for ingestion and `security-compliance` for tenant and ACL
rules.

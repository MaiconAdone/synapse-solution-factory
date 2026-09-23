# RAG Foundation

The RAG layer is prepared around ingestion, chunking, embeddings, vector search,
reranking, citation, and retrieval evaluation.

Default pipeline:

1. Load source documents.
2. Normalize and redact sensitive data.
3. Chunk with metadata and stable ids.
4. Generate embeddings.
5. Store vectors under `vector_db/`.
6. Retrieve with semantic search and filters.
7. Rerank and produce cited context.
8. Evaluate recall, faithfulness, and answer relevance.

Scaling beyond bootstrap follows `config/rag_scalability_policy.json` and
`docs/specifications/scalable_rag_vector_db.md`: scale tiers, vector database
selection, hybrid BM25 + dense retrieval with reciprocal rank fusion, ACL
filters before ranking, versioned indexes with blue/green reindexing, and
retrieval gates (`python scripts/run_evals.py retrieval`).

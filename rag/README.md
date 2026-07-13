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

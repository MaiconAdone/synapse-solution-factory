# Vector DB

Reserved for local vector indexes, manifests, embedding caches, and retrieval
evaluation artifacts. Do not commit sensitive source documents or generated
embeddings that contain private data.

- Adapter contract: `VectorStore` in `scripts/synapse_lib/vector_store.py`.
- Local store for tests and bootstrap: `InMemoryVectorStore` + `HashingEmbedder`.
- Production adapters (pgvector, Qdrant): `templates/rag/vector_db_adapter.py`.
- Store and index choice by scale: `RagScalabilityPlanner` and
  `config/rag_scalability_policy.json`.
- One embedding model per index, named `{collection}__{model}__v{n}` and
  served through an alias.

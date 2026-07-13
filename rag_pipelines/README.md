# RAG Pipelines

This directory contains executable design contracts for retrieval-augmented
generation.

The backend provides a local executable bootstrap pipeline under
`backend/app/rag/pipeline.py` and `/rag`:

- `GET /rag/plan`
- `POST /rag/indexes`
- `POST /rag/query`

The local implementation performs chunking, local indexing, retrieval, simple
reranking and citation packaging without calling a cloud model. Production
vector stores, external rerankers and advanced GraphRAG remain adapter-driven
extensions.

## Required Artifacts

- `pipeline.yaml`
- `retrieval_eval.md`

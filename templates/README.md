# Templates

Starting points that the technology layer (`config/ai_framework_selection.json`)
lists as `solution_templates`. Every path listed there under `templates` must
exist here; frameworks without a real template in Synapse list the file a
generated project should create under `scaffold_targets` instead.

- `rag/rag_pipeline.py`: runnable local hybrid RAG pipeline (ingest, chunk, embed, index, retrieve, cite).
- `rag/vector_db_adapter.py`: pgvector and Qdrant adapters for the `VectorStore` protocol.
- `fine_tuning/model_adaptation_card.md`: decision and approval card for fine-tuning.
- `harness/agent_harness_spec.md`: per-agent harness card (context, tools, loop limits, evals).

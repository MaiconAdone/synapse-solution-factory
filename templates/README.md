# Templates

Starting points that the technology layer (`config/ai_framework_selection.json`)
lists as `solution_templates`. Every path listed there under `templates` must
exist here; frameworks without a real template in Synapse list the file a
generated project should create under `scaffold_targets` instead.

| Template | Universes |
|----------|-----------|
| `rag/rag_pipeline.py`: runnable local hybrid RAG pipeline (ingest, chunk, embed, index, retrieve, cite) | IA, Chatbolt, Hybrid |
| `rag/vector_db_adapter.py`: pgvector and Qdrant adapters for the `VectorStore` protocol | IA, Chatbolt, Hybrid |
| `knowledge_graph/graph_schema.yaml`: ontology, relation types, resolution thresholds and provenance rules | IA, Chatbolt, Hybrid |
| `knowledge_graph/graph_store_adapter.py`: Neo4j/Memgraph and Kuzu adapters for the `GraphStore` protocol | IA, Chatbolt, Hybrid |
| `knowledge_graph/example_graph.json`: seed graph used by `python scripts/run_evals.py graph` | IA, Chatbolt, Hybrid |
| `fine_tuning/release_candidate.json`: candidate for the fine-tuning release gate (`scripts/fine_tuning_release.py`) | IA, Chatbolt, Hybrid |
| `agents/langgraph_state_machine.py`: LangGraph state machine over the LLM gateway and runtime guard | IA, Chatbolt, Hybrid |
| `backend/fastapi_service.py`: FastAPI service (`/health`, `/v1/predict` for ML, `/v1/answer` for IA) | all |
| `mcp/server.py`: MCP gateway for solution tools over the tool registry and runtime guard | IA, Chatbolt, Hybrid |
| `mcp/mcp.example.json`: disabled `.mcp.json` entry for the gateway | IA, Chatbolt, Hybrid |
| `fine_tuning/model_adaptation_card.md`: decision and approval card for fine-tuning | IA, Chatbolt, Hybrid |
| `harness/agent_harness_spec.md`: per-agent harness card (context, tools, loop limits, evals) | all |
| `business/transformation_brief.json`: example brief for the business transformation engine | all |

ML projects do not receive `rag/`, `knowledge_graph/`, `mcp/`, `agents/` or `fine_tuning/`.

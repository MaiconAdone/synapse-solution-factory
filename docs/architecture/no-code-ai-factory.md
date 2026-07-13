# No-Code ML and AI Agent Factory

SYNAPSE is designed so the user creates ML projects and AI agents through a
dialog, without writing code. The dialog is the product surface; code,
workflows, data contracts, evals, prompts, storage and agent execution are
generated behind it.

## Product Contract

1. The user describes the desired business outcome in natural language.
2. The LLM asks for missing business context, data availability and success
   metrics.
3. SYNAPSE applies the book-inspired playbooks in `playbooks/` and
   `docs/books/implementation_map.md`.
4. Ruflo activates the specialized agents in parallel.
5. The orchestration manager consolidates the answer for the user.
6. The created project includes a managed `data/` area for CSV, Excel, JSON,
   JSONL and Parquet uploads.

## Required Knowledge Base

The dialog and swarm must apply these principles before creating a model or
agent:

- AI Engineering: evals, cost, latency and safety before optimization.
- Prompt Engineering: versioned prompts, contracts and regression cases.
- LLM Engineering: tool boundaries, RAG architecture, observability and routing.
- Production LLMs: fallbacks, guardrails, traces and release checks.
- Designing ML Systems: data contracts, baselines, model cards and monitoring.
- Mathematics for ML: metrics, uncertainty, similarity and acceptance criteria.
- Agentic Coding: specialized agents, memory, validation and orchestration.
- Classical AI: problem representation, search, planning and explainable
  decomposition before automation.
- Cybernetics: feedback loops, control signals, stability and human authority
  for high-risk actions.
- Algorithms: graph, queue, cache, scheduling and complexity choices should be
  explicit before adding probabilistic or multiagent behavior.
- Cognitive-state signals: confidence, uncertainty, risk and blocked state are
  operational controls, not claims of human-like emotion.

## Parallel Ruflo Execution

The default workflow is `new-ai-project`. It must run with
`parallelAgentActivation=true` and route work by domain:

- `data-engineering`: uploads, schemas, lineage and data validation.
- `data-science`: analysis, statistics, leakage checks, feature strategy and metrics.
- `machine-learning`: baselines, target, features, metrics and MLflow.
- `llm-engineering`: prompts, tools, agents and guardrails.
- `rag-engineering`: ingestion, chunking, embeddings and retrieval evals.
- `backend-engineering`: APIs and secure runtime integration.
- `frontend-engineering`: no-code dialog and project/data panels.
- `product-strategy`: business objective, success metrics and acceptance criteria.
- `integration-automation`: Codex, Ruflo, MCP, APIs and local tool wiring.
- `security-compliance`: auth, privacy, LGPD, policies and safe autonomy limits.
- `observability-ops`: traces, cost, latency, token budget, drift and health.
- `devops`: Ruflo activation, deployment, cost and token strategy.
- `testing-qa`: ML, IA, RAG, security and regression gates.
- `documentation`: user-facing summary and operational records.
- `orchestration-manager`: task routing, consolidation and final answer.

This keeps each agent focused and avoids sending the full prompt/context to
every agent, reducing repeated tokens.

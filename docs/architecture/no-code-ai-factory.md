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
4. A single assistant (Claude Code or Codex) executes the workflow steps,
   each owned by a role from `config/roles.json`.
5. The assistant consolidates the answer for the user.
6. The created project includes a managed `data/` area for CSV, Excel, JSON,
   JSONL and Parquet uploads.

## Required Knowledge Base

The dialog must apply these principles before creating a model or
agent:

- AI Engineering: evals, cost, latency and safety before optimization.
- Prompt Engineering: versioned prompts, contracts and regression cases.
- LLM Engineering: tool boundaries, RAG architecture, observability and routing.
- Production LLMs: fallbacks, guardrails, traces and release checks.
- Designing ML Systems: data contracts, baselines, model cards and monitoring.
- Mathematics for ML: metrics, uncertainty, similarity and acceptance criteria.
- Agentic Coding: explicit roles, memory, validation and orchestration.
- Classical AI: problem representation, search, planning and explainable
  decomposition before automation.
- Cybernetics: feedback loops, control signals, stability and human authority
  for high-risk actions.
- Algorithms: graph, queue, cache, scheduling and complexity choices should be
  explicit before adding probabilistic or multiagent behavior.
- Cognitive-state signals: confidence, uncertainty, risk and blocked state are
  operational controls, not claims of human-like emotion.

## Role-Based Execution

The default workflow is `new-ai-project`. Each step names the role that owns
it (see `config/roles.json`):

- `data-engineering`: uploads, schemas, lineage and data validation.
- `data-science`: analysis, statistics, leakage checks, feature strategy and metrics.
- `machine-learning`: baselines, target, features, metrics and local experiment tracking.
- `llm-engineering`: prompts, tools, agents and guardrails.
- `rag-engineering`: ingestion, chunking, embeddings and retrieval evals.
- `product-strategy`: business objective, success metrics and acceptance criteria.
- `integration-automation`: Codex, MCP, APIs and local tool wiring.
- `security-compliance`: auth, privacy, LGPD, policies and safe autonomy limits.
- `observability-ops`: traces, cost, latency, token budget, drift and health.
- `devops`: release, rollback and environment automation.
- `testing-qa`: ML, IA, RAG, security and regression gates.
- `documentation`: user-facing summary and operational records.
- `orchestration-manager`: task routing, consolidation and final answer.

Roles keep each step focused so only the context that step needs is sent to
the model, reducing repeated tokens.

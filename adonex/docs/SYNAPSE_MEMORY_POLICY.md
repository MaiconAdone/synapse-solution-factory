# Synapse Memory Policy

- The repository is the durable source of truth.
- Synapse Mode reads core memory before every plan.
- Agents use bounded task context and never ingest `.env` or credentials.
- Decisions and development history are append-only.
- Current state may be refreshed, but historical task logs are preserved.
- Every imported Codex result uses `CODEX_RESULT.md` and/or a bounded Git diff.
- Git reads are limited to non-mutating status and diff commands.
- Memory synchronization, Codex import, writes, and terminal execution preserve
  human approval boundaries.
- Ollama handles local summaries, classification, and initial review.
- Codex is recommended for complex cross-system execution.

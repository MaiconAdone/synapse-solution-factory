# Persistent Memory

This project uses a hybrid memory model:

- working memory for active task state
- episodic memory for decisions, incidents, and workflow runs
- semantic memory for reusable patterns, architecture decisions, and retrieval

Local embeddings/RuVector is the operational memory backend. The local `vector_db/`
directory is reserved for project-owned vector indexes and RAG artifacts.

Project runtime memory is enabled through `config/runtime_manifest.json` and is
materialized locally in `memory/project_memory.runtime.json` when a project is
created.

## Shared Codex + VS Code Chat Context

Use `memory/codex-vscode-context.md` as the short, human-maintained handoff
between Codex and VS Code Chat. VS Code Chat/Copilot Chat should follow
`.github/copilot-instructions.md`, which points back to `AGENTS.md` and this
shared context file.

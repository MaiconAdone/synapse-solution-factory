# AdoneX Shared Project Memory

The repository is the source of truth. Chat history is temporary context.

Run **AdoneX: Initialize Shared Memory** to create the versionable structure:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`, `DECISIONS.md`, `DEVELOPMENT_LOG.md`, and `ROADMAP.md`
- `.adonex/memory/*`
- `.adonex/tasks`, `.adonex/handoff`, and `.adonex/snapshots`
- `CHANGELOG_AGENT.md`

Initialization never overwrites an existing file. Core memory consists of
`AGENTS.md`, `AGENT_CONTEXT.md`, `CURRENT_STATE.md`, and
`CODING_STANDARDS.md`. Synapse Mode reads these files plus open issues before
planning.

Memory writes redact suspected secrets. Historical files use append-only updates
where possible; `CURRENT_STATE.md` is the controlled current-state projection.

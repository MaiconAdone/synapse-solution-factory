# System Architecture

## Control Plane

Codex and Claude Code are the engineering operators. The swarm runtime tracks
governed agent state, coordination, durable memory, and semantic retrieval
locally, with no external MCP swarm executor.

The machine-readable runtime contract lives in `config/runtime_manifest.json`.
`scripts/create_ai_project.ps1`, `scripts/diagnose_project.ps1`, and
`scripts/validate_enterprise_stack.ps1` all read this manifest so project
generation, diagnostics, and validation share the same source of truth.

## Scripts

SYNAPSE has no application server; everything runs as local scripts invoked
from VS Code Chat, Codex, or Claude Code:

- `scripts/create_ai_project.ps1` and `scripts/project_factory/` for project
  generation
- `scripts/synapse_lib/` for shared Python logic (business solution analysis,
  framework selection, evals, local model training, peer messaging) used by
  the CLI entry points below
- `scripts/analyze_business_solution.py`, `scripts/run_evals.py`, and
  `scripts/synapse_peers_mcp.py` as the CLI/MCP entry points into
  `scripts/synapse_lib/`
- `scripts/treat_dataset.py`, `scripts/context_filter.py`, and
  `scripts/market_radar.py` as standalone data/context tools

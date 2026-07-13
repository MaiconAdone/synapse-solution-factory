# Generated Project Ruflo Strategy

Synapse-generated projects inherit a solution-scoped Ruflo runtime. They do not
inherit the Synapse backend, frontend, or project factory.

## Policy

- Keep 60 agents available as the upper bound.
- Start with one orchestrator by default.
- Use 3 agents for standard work and up to 8 for enterprise workflows.
- Activate specialists only when the project universe and task require them.
- Require explicit high-complexity request, human approval, cost review and
  role-specific context filtering before activating all 60 agents.
- Keep Ollama local-first and cloud disabled unless explicitly approved.

## Fleet Fit

- ML projects: `ml_fleet`, `data_fleet`, `quality_fleet`.
- IA projects: `rag_fleet`, `mcp_fleet`, `security_fleet`.
- Chatbolt projects: `rag_fleet`, `mcp_fleet`, `quality_fleet`.
- Hybrid projects: `project_factory_fleet`, `ml_fleet`, `rag_fleet`,
  `cost_optimization_fleet`.

The strategy is recorded in `config/runtime_manifest.json` and copied into
generated project manifests by `scripts/create_ai_project.ps1`.

# Project Factory

Use `scripts/create_ai_project.ps1` to create new enterprise AI projects from
this template.

```powershell
.\\scripts\\create_ai_project.ps1 -NomeProjeto meu_novo_projeto_ia
```

Only SYNAPSE is a project factory. Generated projects are solution workspaces
managed by SYNAPSE and cannot create other projects.

They contain data, experiments, prompts, evals, governance, treatment scripts,
model artifacts and documentation selected for ML, IA or hybrid projects.
They do not contain SYNAPSE's backend, frontend, database platform or
project-factory scripts. Each project does inherit its own Ruflo runtime, MCP
configuration, workflows, memory namespace and agent catalog.

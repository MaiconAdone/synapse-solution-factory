# Synapse Technology Layer

## Purpose

The Synapse technology layer receives a business problem and recommends the
technology mix needed to solve it: architecture components, frameworks, agent
patterns, pipelines, templates, evals, and production risks.

It is not an installer and does not add dependencies blindly. It is a governed
selection layer used before SDD, implementation, project generation, or Ruflo
specialist routing.

## Source Of Truth

- Catalog: `config/ai_framework_selection.json`
- Catalog section: `technology_catalog`
- Selector: `backend/app/services/ai_framework_selector.py`
- Architecture decision: `backend/app/services/business_solution_analyzer.py`
- Official project artifacts:
  - `config/business_solution_analysis.json`
  - `docs/briefings/business_solution_analysis.md`

## Catalog Families

- Agentic coding and business agents: CrewAI, Swarms, LangChain, LangGraph.
- Visual and no-code builders: LangFlow, Flowise, Dify.
- Automation and ingestion: n8n, Firecrawl, Deep Research, Awesome Lists.
- Knowledge and retrieval: Vector DBs, RAG frameworks, KAG / Knowledge Graph.
- MLOps and serving: MLflow, FastAPI.
- Local-first runtime and tool boundaries: Ollama, MCP servers.

## Required Outputs

- `technology_layer`: recommended technologies, capabilities, categories, and templates.
- `architecture_blueprint`: local-first architecture components and framework links.
- `pipeline_blueprints`: discovery, RAG, agentic execution, automation, ingestion, or MLOps stages.
- `solution_templates`: template paths to scaffold or adapt.
- `evaluation_plan`: tests and evals needed before release.
- `production_risks`: risks that must be handled in design and review.

## Governance

- Start with the business problem, success metric, data or knowledge sources, and risk level.
- Use local Ollama for triage, summarization, planning, and review by default.
- Use FastAPI, Ollama, and MCP servers as local-first defaults for IA, Chatbolt, and hybrid projects.
- Use MLflow for ML and hybrid projects.
- Use RAG technologies only when trusted knowledge or citations matter.
- Use agents only when the solution must plan, call tools, coordinate steps, or execute workflows.
- Use Swarms or larger Ruflo routes only when parallel exploration or many specialists are justified.
- Cloud tools and all 60 agents require explicit user request and human approval.

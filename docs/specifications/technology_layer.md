# Synapse Technology Layer

## Purpose

The Synapse technology layer receives a business problem and recommends the
technology mix needed to solve it: architecture components, frameworks, agent
patterns, pipelines, templates, evals, and production risks.

It is not an installer and does not add dependencies blindly. It is a governed
selection layer used before SDD, implementation, project generation, or swarm
specialist routing.

## Source Of Truth

- Catalog: `config/ai_framework_selection.json`
- Catalog section: `technology_catalog`
- Selector: `scripts/synapse_lib/ai_framework_selector.py`
- Architecture decision: `scripts/synapse_lib/business_solution_analyzer.py`
- Official project artifacts:
  - `config/business_solution_analysis.json`
  - `docs/briefings/business_solution_analysis.md`

## Catalog Families

- Agentic coding and business agents: CrewAI, Swarms, LangChain, LangGraph.
- Visual and no-code builders: LangFlow, Flowise, Dify.
- Automation and ingestion: n8n, Firecrawl, Deep Research, Awesome Lists.
- Knowledge and retrieval: Vector DBs, RAG frameworks, KAG / Knowledge Graph.
- MLOps and serving: FastAPI.
- Tool boundaries: MCP servers.
- Model adaptation: Fine-tuning / PEFT (`config/fine_tuning_policy.json`).
- Reliability: Agent / Eval Harness (`config/harness_engineering_policy.json`).

## Required Outputs

- `technology_layer`: recommended technologies, capabilities, categories, and templates.
- `architecture_blueprint`: local-first architecture components and framework links.
- `pipeline_blueprints`: discovery, RAG, agentic execution, automation, ingestion, or MLOps stages.
- `solution_templates`: existing files under `templates/` to copy or adapt.
- `solution_scaffold_targets`: files the generated project should create for
  technologies that have no ready-made template in Synapse.
- `evaluation_plan`: tests and evals needed before release.
- `production_risks`: risks that must be handled in design and review.

## Governance

- Start with the business problem, success metric, data or knowledge sources, and risk level.
- Use Codex/OpenAI or Claude Code/Anthropic directly for triage, summarization, planning, and review.
- Use FastAPI and MCP servers as defaults for IA, Chatbolt, and hybrid projects.
- Use the local model registry and evals for ML and hybrid projects.
- Use RAG technologies only when trusted knowledge or citations matter.
- Use agents only when the solution must plan, call tools, coordinate steps, or execute workflows.
- Use Swarms or larger swarm routes only when parallel exploration or many specialists are justified.
- Cloud tools and all 60 agents require explicit user request and human approval.

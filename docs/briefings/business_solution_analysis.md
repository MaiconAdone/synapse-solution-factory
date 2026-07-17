# Business Solution Analysis

- Requested universe: ia
- Recommended universe: ia
- Domain: developer_productivity (score 3)
- ML archetype: unknown (score 0)
- AI archetype: voice_coding_agent (score 2)
- Solution stack: data_treatment, tests, evals, governance, rag, agents, guardrails, token_cost_control, local_llm_routing
- Technology layer: crewai, swarms, langgraph, mlflow, ollama, fastapi, mcp-servers

## Architecture Decision

Create an AI project with RAG and/or governed agents, tool boundaries, MCP-ready integration, cost controls, and prompt/RAG/tool evals.

## Technology Layer

### Pipelines

- solution_discovery: business_problem, universe_classification, technology_selection, sdd_gate
- agentic_execution: plan, select_tools, execute, review, record_memory
- mlops: baseline, train, track, register, monitor

### Templates

- templates/agents/crewai_project.yaml
- templates/agents/swarms_council.yaml
- templates/agents/langgraph_state_machine.py
- templates/mlops/mlflow_experiment.py
- templates/backend/fastapi_service.py
- templates/llm/ollama_router.py
- templates/mcp/server.py

## ML Foundations

- Active: False
- Policy: config/ml_foundations_policy.json
- Algorithm candidates to consider: 



## Required Artifacts

- docs/briefings/business_solution_analysis.md
- config/business_solution_analysis.json
- config/ai_framework_selection.json
- docs/specifications/voice_agentic_coding.md
- config/voice_agent_quality_gates.json
- evals/voice_agent_cases.jsonl
- evals/agentic_coding_cases.jsonl
- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_ai_contract.py

## Tests

- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_ai_contract.py

## Evals

- evals/project_cases.jsonl
- evals/quality_gates.yaml
- evals/prompt_cases.jsonl
- evals/rag_cases.jsonl

## Book Alignment

- AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.
- Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.
- LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.
- Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.
- Agentic Coding: engineer repository context, tool permissions, reusable workflows, validation hooks, and controlled execution.
- Prompt Engineering for LLMs: compile spoken intent into an explicit objective, constraints, evidence, tools, and response contract.

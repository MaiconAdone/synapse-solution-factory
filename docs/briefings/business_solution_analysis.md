# Business Solution Analysis

- Requested universe: hybrid
- Recommended universe: hybrid
- Effective universe (generated): hybrid
- Universe confirmation: not needed
- Domain: developer_productivity (score 1)
- ML archetype: unknown (score 0)
- AI archetype: unknown (score 3)
- Solution stack: data_treatment, tests, evals, governance, mlops, rag, agents, guardrails, token_cost_control, local_llm_routing
- Technology layer: langchain, langflow, flowise, dify, firecrawl, vector-dbs, rag-frameworks, mcp-servers

## Architecture Decision

Create a hybrid project combining MLOps with RAG/agents so predictive intelligence and task execution share data contracts, tests, evals, and governance.

## Technology Layer

### Pipelines

- solution_discovery: business_problem, universe_classification, technology_selection, sdd_gate
- web_ingestion: crawl, clean, chunk, index, quality_check
- rag: ingest, chunk, embed, index_version, hybrid_retrieve, rerank, answer, evaluate
- mlops: baseline, train, track, register, monitor

### Templates

- templates/rag/vector_db_adapter.py
- templates/rag/rag_pipeline.py

### Scaffold Targets

- templates/llm/langchain_service.py
- templates/no_code/langflow_export.json
- templates/no_code/flowise_chatflow.json
- templates/no_code/dify_app.yaml
- templates/ingestion/firecrawl_job.yaml
- templates/mcp/server.py

## Scalable RAG and Vector DB

- Active: True
- Policy: config/rag_scalability_policy.json
- Tier: local (needs_user_decisions)
- Vector store candidates: synapse-local, faiss, chromadb
- Pending user decisions: expected_corpus_chunks_in_12_months, peak_queries_per_second, p95_retrieval_latency_budget_ms, multi_tenant_isolation_required, data_sensitivity, hosting_constraint_self_hosted_or_managed, existing_database_platform

## Model Adaptation (Fine-Tuning)

- Active: True
- Recommended stage: prompt_engineering
- Fine-tuning blockers: no_measured_baseline, dataset_below_minimum
- Reason: Start with prompt contracts and few-shot examples, then measure.

## Solution Agents

- Active: True
- Architecture: orchestrator_with_specialists
- Blueprints: config/solution_agents.json

## Business Transformation

- Active: False
- Signals: none
- Workflow: config/workflows/synapse/business-transformation.json

## Harness Engineering

- Policy: config/harness_engineering_policy.json
- Components: context_map, tool_boundary, control_loop, verification, agent_evals, agent_blueprints, observability, feedback_loop, safe_execution
- Audit: python scripts/audit_harness.py

## ML Foundations

- Active: True
- Policy: config/ml_foundations_policy.json
- Algorithm candidates to consider: decision_tree_baseline, naive_bayes_baseline, svm_margin_baseline

- learning_problem_mapping: experience_data, prediction_task, performance_measure
- hypothesis_space_and_bias: hypothesis_family, bias_assumptions, variance_risk
- probabilistic_assumptions: probability_model, calibration_need, distribution_checks
- estimation_objective: loss_function, estimator, optimization_method
- statistical_validation: evaluation_split, confidence_or_significance_check, baseline_delta
- regularization_and_optimization: regularization, convergence_criteria, failure_modes
- attribute_selection_transformation: feature_selection_policy, leakage_check, transformations

## Required Artifacts

- docs/briefings/business_solution_analysis.md
- config/business_solution_analysis.json
- config/ai_framework_selection.json
- config/ml_foundations_policy.json
- docs/specifications/ml_foundations.md
- config/solution_agents.json
- config/rag_scalability_policy.json
- docs/specifications/scalable_rag_vector_db.md
- evals/retrieval_cases.jsonl
- config/fine_tuning_policy.json
- docs/specifications/fine_tuning.md
- evals/tool_workflow_cases.jsonl
- config/harness_engineering_policy.json
- docs/specifications/harness_engineering.md
- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_harness_contract.py
- tests/test_ml_contract.py
- tests/test_ai_contract.py

## Tests

- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_harness_contract.py
- tests/test_ml_contract.py
- tests/test_ai_contract.py

## Evals

- evals/project_cases.jsonl
- evals/quality_gates.yaml
- evals/ml_cases.jsonl using 
- evals/prompt_cases.jsonl
- evals/rag_cases.jsonl
- evals/retrieval_cases.jsonl using recall_at_k, mrr, ndcg_at_k
- evals/tool_workflow_cases.jsonl using pass^k over repeated trials

## Book Alignment

- AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.
- Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.
- LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.
- Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.
- Harness engineering (Building LLMs for Production, Building Applications with AI Agents, Cybernetics): budgets, stop conditions, repeated-trial evals and feedback loops around every agent.
- Scalable RAG (LLM Engineer's Handbook, AI Engineering, Introduction to Algorithms): sized vector indexes, hybrid retrieval with rank fusion, versioned reindexing and retrieval gates.
- Model adaptation (AI Engineering, LLM Engineer's Handbook, Build a Large Language Model (From Scratch)): prompt first, then RAG, then parameter-efficient fine-tuning only with a measured baseline and curated data.

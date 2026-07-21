# Business Solution Analysis

- Requested universe: ia
- Recommended universe: hybrid
- Domain: developer_productivity (score 1)
- ML archetype: document_intelligence (score 1)
- AI archetype: chatbot (score 2)
- Solution stack: data_treatment, tests, evals, governance, mlops, nlp, computer_vision, ocr, deep_learning, human_review, chatbot, rag, agents, guardrails, token_cost_control, local_llm_routing
- Technology layer: langflow, flowise, dify, ollama, mlflow, fastapi, mcp-servers

## Architecture Decision

Create a hybrid project combining MLOps with RAG/agents so predictive intelligence and task execution share data contracts, tests, evals, and governance.

## Technology Layer

### Pipelines

- solution_discovery: business_problem, universe_classification, technology_selection, sdd_gate
- rag: ingest, embed, retrieve, rerank, answer, evaluate
- mlops: baseline, train, track, register, monitor

### Templates

- templates/no_code/langflow_export.json
- templates/no_code/flowise_chatflow.json
- templates/no_code/dify_app.yaml
- templates/mlops/mlflow_experiment.py
- templates/backend/fastapi_service.py
- templates/llm/ollama_router.py
- templates/mcp/server.py

## ML Foundations

- Active: True
- Policy: config/ml_foundations_policy.json
- Algorithm candidates to consider: text_naive_bayes_baseline, linear_text_classifier_baseline

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
- ml_systems/data_contract.yaml
- guardrails/policy.yaml
- evals/ml_cases.jsonl
- prompts/chatbot_assistant.md
- evals/chatbot_cases.jsonl
- docs/checklists/chatbot_quality_checklist.md
- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_ml_contract.py
- tests/test_ai_contract.py

## Tests

- tests/test_project_contract.py
- tests/test_evals_contract.py
- tests/test_data_contract.py
- tests/test_ml_contract.py
- tests/test_ai_contract.py

## Evals

- evals/project_cases.jsonl
- evals/quality_gates.yaml
- evals/ml_cases.jsonl using accuracy, entity_f1, ocr_error_rate, human_review_rate
- evals/prompt_cases.jsonl
- evals/rag_cases.jsonl

## Book Alignment

- AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.
- Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.
- LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.
- Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.

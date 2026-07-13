# Business Solution Analysis

- Requested universe: ia
- Recommended universe: hybrid
- Domain: developer_productivity (score 2)
- ML archetype: speech_recognition (score 3)
- AI archetype: voice_coding_agent (score 2)
- Solution stack: data_treatment, tests, evals, governance, mlops, wake_word_detection, automatic_speech_recognition, voice_activity_detection, domain_lexicon, human_review, rag, agents, guardrails, token_cost_control, local_llm_routing
- Technology layer: ollama, mcp-servers, mlflow, fastapi

## Architecture Decision

Create a hybrid project combining MLOps with RAG/agents so predictive intelligence and task execution share data contracts, tests, evals, and governance.

## Technology Layer

### Pipelines

- solution_discovery: business_problem, universe_classification, technology_selection, sdd_gate
- mlops: baseline, train, track, register, monitor

### Templates

- templates/mlops/mlflow_experiment.py
- templates/backend/fastapi_service.py
- templates/llm/ollama_router.py
- templates/mcp/server.py

## ML Foundations

- Active: True
- Policy: config/ml_foundations_policy.json
- Algorithm candidates to consider: 

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
- config/voice_agent_quality_gates.json
- evals/voice_agent_cases.jsonl
- docs/specifications/voice_agentic_coding.md
- evals/agentic_coding_cases.jsonl
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
- evals/ml_cases.jsonl using wake_activation_p95_ms, word_accuracy, command_completion_rate, false_activation_rate
- evals/prompt_cases.jsonl
- evals/rag_cases.jsonl

## Book Alignment

- AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.
- Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.
- LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.
- Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.
- Speech and Language Processing: evaluate ASR with word error/accuracy, domain vocabulary, and representative speech cases.
- Designing Voice User Interfaces: separate wake, listening, recognition, handling, confirmation, and recovery states.
- Effective Conversational AI: measure intent success and continuously improve from observed failures instead of relying on generic fallback copy.
- Agentic Coding: engineer repository context, tool permissions, reusable workflows, validation hooks, and controlled execution.
- Prompt Engineering for LLMs: compile spoken intent into an explicit objective, constraints, evidence, tools, and response contract.

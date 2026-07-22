# Synapse Project Factory - Static content generators
#
# Self-contained functions that render inherited configuration/content for a
# generated solution project. They only read the orchestrator's script-scope
# variables ($Destino, $NomeProjeto, $TipoProjeto, $ProjectUniverse, $SwarmName,
# $ProjectSlug) at call time, so dot-sourcing keeps behavior identical while
# taking ~290 lines of here-strings out of create_ai_project.ps1.
#
#   . (Join-Path $PSScriptRoot 'project_factory\ProjectFactory.Content.ps1')

function Configure-EnterpriseYaml {
    $EnterpriseYamlPath = Join-Path $Destino "config\enterprise.yaml"
    if (!(Test-Path $EnterpriseYamlPath)) {
        return
    }

    $Content = @"
project:
  name: $NomeProjeto
  type: $TipoProjeto
  universe: $($ProjectUniverse.universe)
  universe_label: $($ProjectUniverse.label)
  solution_focus: $($ProjectUniverse.solution_focus)
  core: codex-ruflo
capabilities:
  ml: $($ProjectUniverse.ml_enabled.ToString().ToLowerInvariant())
  ai: $($ProjectUniverse.ai_enabled.ToString().ToLowerInvariant())
  rag: $($ProjectUniverse.rag_enabled.ToString().ToLowerInvariant())
  data_treatment: true
  ruflo_15_agents: true
  ruflo_core_agents: 15
  ruflo_max_agents: 60
  ruflo_specialist_agents: 45
  cost_aware_orchestration: true
  default_active_agents: 1
  enterprise_active_agents: 8
local_llm:
  enabled: true
  managed_by: synapse
  provider: ollama
  model: qwen2.5-coder:3b
  general_model: qwen3:8b
  balanced_model: deepseek-coder-v2:lite
  code_review_model: deepseek-coder-v2:lite
  code_strong_model: qwen2.5-coder:14b
  planning_strong_model: qwen3:14b
  reasoning_strong_model: deepseek-r1:14b
  code_critical_model: qwen2.5-coder:32b
  large_model: qwen2.5-coder:32b
  embedding_model: nomic-embed-text:latest
  model_selection: offline_profile_router
  large_model_requires_explicit_request: true
  recommended_context_tokens_on_16gb_ram: 4096
  routing_strategy: local_first
  ruflo_access: governed_on_demand
  sensitive_content_local_only: true
continual_learning:
  enabled: true
  mode: memory_retrieval_first
  automatic_weight_updates: false
  human_approval_required_for_training: true
application_runtime:
  managed_by: synapse
  backend_in_project: false
  frontend_in_project: false
  factory_capable: false
swarm:
  name: $SwarmName
  topology: hierarchical-mesh
  max_agents: 60
  core_agent_count: 15
  specialist_agent_count: 45
  activation_policy: cost_aware_core_subset_and_route_specialists_on_demand
  coordination: distributed
  consensus: majority
memory:
  enabled: true
  namespace: $NomeProjeto
  persist_on_create: true
  runtime_file: memory/project_memory.runtime.json
  backend: hybrid
  tiers:
    - working
    - episodic
    - semantic
  embeddings:
    enabled: true
    dimension: 384
  semantic_search:
    enabled: true
    index: hnsw-ready
rag:
  vector_db_path: vector_db
  pipeline:
    - ingest
    - normalize
    - chunk
    - embed
    - index
    - retrieve
    - rerank
    - cite
"@
    Write-TextFile $EnterpriseYamlPath $Content
    Write-Host "Enterprise YAML configurado." -ForegroundColor Green
}

function Configure-WorkflowsYaml {
    $WorkflowsYamlPath = Join-Path $Destino "config\workflows\enterprise_workflows.yaml"
    if (!(Test-Path $WorkflowsYamlPath)) {
        return
    }

    $Content = @"
project: $NomeProjeto
project_type: $TipoProjeto
version: 1
workflows:
  - id: solution-lifecycle
    strategy: hybrid
    owner: orchestration-manager
    parallel_agent_activation: true
    parallel_groups:
      - [product-strategy, data-engineering, data-science, machine-learning]
      - [llm-engineering, rag-engineering, integration-automation, security-compliance]
      - [integration-automation, security-compliance, observability-ops, devops]
      - [orchestration-manager, testing-qa, documentation, business-value-analyst]
    agents:
      - orchestration-manager
      - product-strategy
      - data-engineering
      - data-science
      - machine-learning
      - llm-engineering
      - rag-engineering
      - integration-automation
      - security-compliance
      - observability-ops
      - devops
      - testing-qa
      - documentation
    steps:
      - dialog_briefing
      - apply_book_playbooks
      - define_business_outcome
      - prepare_data_folder
      - design_data_contract
      - run_data_analysis_plan
      - design_ml_baseline
      - design_ai_agents
      - design_rag_pipeline
      - plan_integrations
      - define_security_guardrails
      - define_synapse_integration_contract
      - define_observability
      - initialize_memory
      - initialize_swarm
      - optimize_parallel_execution
      - write_project_docs
      - validate_stack
  - id: rag-build
    strategy: adaptive
    owner: rag-engineering
    agents:
      - data-engineering
      - llm-engineering
      - testing-qa
    steps:
      - ingest_sources
      - validate_documents
      - chunk_documents
      - generate_embeddings
      - build_vector_index
      - evaluate_retrieval
  - id: business-transformation
    strategy: stateful-governed
    owner: orchestration-manager
    agents:
      - orchestration-manager
      - product-strategy
      - data-science
      - integration-automation
      - security-compliance
      - testing-qa
      - business-value-analyst
      - metrics-instrumentation
      - policy-guardrails-engineer
    steps:
      - intake
      - diagnosis
      - process_mapping
      - data_readiness
      - opportunity_identification
      - prioritization
      - execution_planning
      - risk_governance
      - human_approval
      - simulation
      - impact_evaluation
  - id: ml-release
    strategy: hierarchical
    owner: machine-learning
    agents:
      - data-engineering
      - testing-qa
      - devops
      - documentation
    steps:
      - define_problem
      - design_eval
      - train_or_tune
      - validate
      - release
      - monitor
  - id: $ProjectSlug-intelligence-release
    strategy: hierarchical
    owner: orchestration-manager
    agents:
      - data-engineering
      - machine-learning
      - llm-engineering
      - rag-engineering
      - testing-qa
      - documentation
    steps:
      - define_business_objective
      - validate_data_contract
      - design_prompt_and_model_evals
      - build_baseline
      - implement_rag_or_ml_pipeline
      - evaluate_quality_cost_latency_safety
      - update_model_card
      - prepare_release_notes
"@
    Write-TextFile $WorkflowsYamlPath $Content
    Write-Host "Workflows enterprise configurados." -ForegroundColor Green
}

function Create-EnvironmentFiles {
    $Content = @"
OPENAI_API_KEY=
ENVIRONMENT=local
PROJECT_MANAGED_BY=Synapse
PROJECT_FACTORY_CAPABLE=false
PROJECT_CONTAINS_BACKEND=false
PROJECT_CONTAINS_FRONTEND=false
SWARM_TOPOLOGY=hierarchical-mesh
SWARM_NAME=$SwarmName
MEMORY_BACKEND=hybrid
VECTOR_DB_PATH=vector_db
PROJECT_NAME=$NomeProjeto
PROJECT_TYPE=$TipoProjeto
PROJECT_UNIVERSE=$($ProjectUniverse.universe)
PROJECT_SOLUTION_FOCUS=$($ProjectUniverse.solution_focus)
PROJECT_ML_ENABLED=$($ProjectUniverse.ml_enabled.ToString().ToLowerInvariant())
PROJECT_AI_ENABLED=$($ProjectUniverse.ai_enabled.ToString().ToLowerInvariant())
PROJECT_RAG_ENABLED=$($ProjectUniverse.rag_enabled.ToString().ToLowerInvariant())
PROJECT_DATA_TREATMENT_ENABLED=true
PROJECT_RUFLO_15_AGENTS_ENABLED=true
PROJECT_RUFLO_CORE_AGENTS=15
PROJECT_RUFLO_MAX_AGENTS=60
PROJECT_RUFLO_SPECIALIST_AGENTS=45
PROJECT_COST_AWARE_ORCHESTRATION_ENABLED=true
PROJECT_DEFAULT_ACTIVE_AGENTS=1
PROJECT_ENTERPRISE_ACTIVE_AGENTS=8
PROJECT_ACTIVATE_ALL_60_REQUIRES_EXPLICIT_HIGH_COMPLEXITY=true
LOCAL_LLM_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_GENERAL_MODEL=qwen3:8b
OLLAMA_BALANCED_MODEL=deepseek-coder-v2:lite
OLLAMA_CODE_REVIEW_MODEL=deepseek-coder-v2:lite
OLLAMA_CODE_STRONG_MODEL=qwen2.5-coder:14b
OLLAMA_PLANNING_STRONG_MODEL=qwen3:14b
OLLAMA_REASONING_STRONG_MODEL=deepseek-r1:14b
OLLAMA_CODE_CRITICAL_MODEL=qwen2.5-coder:32b
OLLAMA_LARGE_MODEL=qwen2.5-coder:32b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text:latest
OLLAMA_TIMEOUT_SECONDS=600
OLLAMA_CONTEXT_WINDOW=4096
OLLAMA_MAX_OUTPUT_TOKENS=512
OLLAMA_SEED=42
LLM_ROUTING_METRICS_PATH=./artifacts/llm-routing/events.jsonl
GOVERNED_SWARM_AUDIT_PATH=./artifacts/governance/swarm-executions.jsonl
LEARNING_EVENTS_PATH=./memory/synapse_learning_memory.jsonl
LOCAL_TRAINING_DATASET_PATH=./data/learning/ollama_training.jsonl
"@
    Write-TextFile (Join-Path $Destino ".env.example") $Content
    Write-Host ".env.example criado." -ForegroundColor Green
}

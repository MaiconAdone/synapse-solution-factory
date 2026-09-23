# Synapse Project Factory - Static content generators
#
# Self-contained functions that render inherited configuration/content for a
# generated solution project. They only read the orchestrator's script-scope
# variables ($Destino, $NomeProjeto, $TipoProjeto, $ProjectUniverse,
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
  core: codex-claude
capabilities:
  ml: $($ProjectUniverse.ml_enabled.ToString().ToLowerInvariant())
  ai: $($ProjectUniverse.ai_enabled.ToString().ToLowerInvariant())
  rag: $($ProjectUniverse.rag_enabled.ToString().ToLowerInvariant())
  data_treatment: true
  cost_aware_model_routing: true
cloud_llm:
  managed_by: synapse
  codex_provider: openai
  claude_provider: anthropic
  model_tiers: config/cost_optimization_policy.json
  sensitive_content_blocked: true
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
agent_governance:
  roles: config/roles.json
  policy: config/harness_engineering_policy.json
  execution: single_assistant_first
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
    roles:
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
      - write_project_docs
      - validate_stack
  - id: rag-build
    strategy: adaptive
    owner: rag-engineering
    roles:
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
    roles:
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
    roles:
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
    roles:
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
PROJECT_COST_AWARE_MODEL_ROUTING_ENABLED=true
PROJECT_DEFAULT_MODEL_TIER=economy
LLM_ROUTING_METRICS_PATH=./artifacts/llm-routing/events.jsonl
LEARNING_EVENTS_PATH=./memory/synapse_learning_memory.jsonl
LOCAL_TRAINING_DATASET_PATH=./data/learning/training_examples.jsonl
"@
    Write-TextFile (Join-Path $Destino ".env.example") $Content
    Write-Host ".env.example criado." -ForegroundColor Green

    # .env real (nao versionado, ja coberto pelo .gitignore) para que o projeto
    # rode local-first sem exigir copia manual do .env.example.
    Write-TextFile (Join-Path $Destino ".env") $Content
    Write-Host ".env criado a partir do .env.example (ignorado pelo git)." -ForegroundColor Green
}

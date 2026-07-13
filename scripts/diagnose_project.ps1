param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectName,

    [string]$DestinoBase = "C:\Users\malves\Documents\Projetos"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Join-Path $DestinoBase $ProjectName
$Checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param(
        [string]$Id,
        [string]$Description,
        [bool]$Passed,
        [string]$Detail = ""
    )
    $script:Checks.Add([pscustomobject]@{
        id = $Id
        description = $Description
        passed = $Passed
        detail = $Detail
    })
}

function Test-RelativePath {
    param(
        [string]$Id,
        [string]$RelativePath,
        [string]$Description
    )
    $Path = Join-Path $ProjectRoot $RelativePath
    Add-Check -Id $Id -Description $Description -Passed (Test-Path $Path) -Detail $RelativePath
}

if (!(Test-Path $ProjectRoot)) {
    Write-Host "ERRO: projeto nao encontrado: $ProjectRoot" -ForegroundColor Red
    exit 1
}

$RuntimePath = Join-Path $ProjectRoot "config\runtime_manifest.json"
$UniversePath = Join-Path $ProjectRoot "config\project_universe.json"
$SolutionContractPath = Join-Path $ProjectRoot "config\synapse_solution_contract.json"
$AgentsPath = Join-Path $ProjectRoot "agents\definitions\enterprise_agents.yaml"
$CostPolicyPath = Join-Path $ProjectRoot "config\cost_optimization_policy.json"
$ContextPolicyPath = Join-Path $ProjectRoot "config\context_policy.json"
$TrustFrameworkPath = Join-Path $ProjectRoot "config\agent_trust_framework.json"
$FleetsPath = Join-Path $ProjectRoot "config\agent_fleets.json"
$BlueprintContractPath = Join-Path $ProjectRoot "config\agent_blueprint_contract.json"
$ImprovementLoopPath = Join-Path $ProjectRoot "config\agent_improvement_loop.json"
$ModelProvidersPath = Join-Path $ProjectRoot "config\model_providers.json"

Test-RelativePath "runtime_manifest" "config\runtime_manifest.json" "Runtime manifest existe"
Test-RelativePath "project_universe" "config\project_universe.json" "Universo do projeto existe"
Test-RelativePath "solution_contract" "config\synapse_solution_contract.json" "Contrato de solucao gerenciada pelo Synapse existe"
Test-RelativePath "enterprise_spec" "config\ai_ml_enterprise_spec.json" "Especificacao enterprise IA/ML existe"
Test-RelativePath "cost_optimization_policy" "config\cost_optimization_policy.json" "Politica de orquestracao economica existe"
Test-RelativePath "context_policy" "config\context_policy.json" "Politica central de contexto LLM existe"
Test-RelativePath "agent_trust_framework" "config\agent_trust_framework.json" "Agentic mesh trust framework existe"
Test-RelativePath "agent_fleets" "config\agent_fleets.json" "Agentic mesh fleets existem"
Test-RelativePath "agent_blueprint_contract" "config\agent_blueprint_contract.json" "Contrato de agent blueprint existe"
Test-RelativePath "agentic_architectural_patterns" "config\agentic_architectural_patterns.json" "Catalogo de padroes arquiteturais agentic existe"
Test-RelativePath "agent_improvement_loop" "config\agent_improvement_loop.json" "Loop de melhoria de agents existe"
Test-RelativePath "model_providers" "config\model_providers.json" "Politica de provedores Ollama/OpenAI existe"
Test-RelativePath "business_solution_analysis_json" "config\business_solution_analysis.json" "Analise de solucao de negocio existe"
Test-RelativePath "business_solution_analysis_md" "docs\briefings\business_solution_analysis.md" "Briefing da analise de solucao de negocio existe"
Test-RelativePath "llm_solution_factory_policy" "config\llm_solution_factory_policy.json" "Policy geral da fabrica de solucoes para LLMs existe"
Test-RelativePath "llm_solution_factory_governance" "docs\specifications\llm_solution_factory_governance.md" "Governanca geral da fabrica de solucoes para LLMs existe"
Test-RelativePath "data_treatment_policy" "config\data_treatment_policy.json" "Politica do prompt mestre de tratamento existe"
Test-RelativePath "master_data_treatment_prompt" "prompts\master_data_treatment.md" "Prompt mestre de tratamento estatistico existe"
Test-RelativePath "data_treatment_prompt" "prompts\codex_data_treatment_dialog.md" "Prompt de tratamento de dados existe"
Test-RelativePath "data_treatment_script" "scripts\treat_dataset.py" "Script de tratamento de dados existe"
Test-RelativePath "ruflo_runtime" "scripts\start_ruflo_swarm.ps1" "Runtime Ruflo do projeto existe"
Test-RelativePath "ruflo_mcp" ".mcp.json" "Configuracao MCP Ruflo do projeto existe"
Test-RelativePath "codex_agents_instructions" "AGENTS.md" "Instrucoes Codex/agents do projeto existem"
Test-RelativePath "claude_instructions" "CLAUDE.md" "Instrucoes Claude do projeto existem"
Test-RelativePath "shared_dialog_memory" ".adonex\memory\SHARED_DIALOG_MEMORY.md" "Memoria compartilhada de dialogo existe"
Test-RelativePath "chat_tasks_memory" ".adonex\memory\CHAT_TASKS.md" "Historico de tarefas de chat existe"
Test-RelativePath "agent_context_memory" ".adonex\memory\AGENT_CONTEXT.md" "Contexto compartilhado dos agentes existe"
Test-RelativePath "current_state_memory" ".adonex\memory\CURRENT_STATE.md" "Estado atual compartilhado existe"
Test-RelativePath "adonex_runbook" "docs\runbooks\adonex.md" "Runbook AdoneX do projeto existe"
Test-RelativePath "peer_messaging_runbook" "docs\runbooks\peer_messaging.md" "Runbook de peer messaging existe"
Test-RelativePath "peer_messaging_mcp" "scripts\synapse_solution_peers_mcp.py" "MCP peer messaging standalone existe"
Test-RelativePath "vscode_adonex_settings" ".vscode\settings.json" "Settings VS Code/AdoneX existem"
Test-RelativePath "vscode_adonex_extensions" ".vscode\extensions.json" "Recomendacao da extensao AdoneX existe"
Test-RelativePath "agents_yaml" "agents\definitions\enterprise_agents.yaml" "Catalogo de agentes do projeto existe"
Test-RelativePath "attachment_manifest" "docs\briefings\codex_attachments_manifest.json" "Manifesto de anexos Codex/Ruflo existe"
Test-RelativePath "execution_spec" "docs\specifications\ai_ml_execution_spec.md" "Especificacao de execucao existe"
Test-RelativePath "agentic_mesh_spec" "docs\specifications\agentic_mesh_governance.md" "Especificacao agentic mesh existe"
Test-RelativePath "agentic_patterns_spec" "docs\specifications\agentic_architectural_patterns.md" "Especificacao de padroes arquiteturais agentic existe"
Test-RelativePath "agent_fleet_certification" "docs\checklists\agent_fleet_certification.md" "Checklist de certificacao de fleets existe"
Test-RelativePath "agent_sre_runbook" "docs\runbooks\agent_sre.md" "Runbook Agent SRE existe"
Test-RelativePath "data_raw" "data\raw" "Pasta data/raw existe"
Test-RelativePath "uploads_images" "data\uploads\images" "Pasta de upload de imagens existe"
Test-RelativePath "uploads_files" "data\uploads\files" "Pasta de upload de arquivos existe"
Add-Check "no_backend" "Projeto nao contem backend do Synapse" (-not (Test-Path (Join-Path $ProjectRoot "backend"))) "backend"
Add-Check "no_frontend" "Projeto nao contem frontend do Synapse" (-not (Test-Path (Join-Path $ProjectRoot "frontend"))) "frontend"
Add-Check "no_factory" "Projeto nao contem fabrica de projetos" (-not (Test-Path (Join-Path $ProjectRoot "scripts\create_ai_project.ps1"))) "scripts/create_ai_project.ps1"
Add-Check "no_platform_peer_mcp" "Peer messaging nao depende do backend do Synapse" (-not (Test-Path (Join-Path $ProjectRoot "scripts\synapse_peers_mcp.py"))) "scripts/synapse_peers_mcp.py"

if (Test-Path $SolutionContractPath) {
    try {
        $SolutionContract = Get-Content $SolutionContractPath -Raw | ConvertFrom-Json
        Add-Check "solution_managed_by_synapse" "Solucao e gerenciada pelo Synapse" ($SolutionContract.managed_by -eq "synapse") "managed_by=$($SolutionContract.managed_by)"
        Add-Check "solution_not_factory" "Solucao nao pode criar projetos" (-not [bool]$SolutionContract.factory_capable) "factory_capable=$($SolutionContract.factory_capable)"
        Add-Check "solution_no_application_stack" "Solucao nao inclui backend ou frontend" (-not [bool]$SolutionContract.contains_backend -and -not [bool]$SolutionContract.contains_frontend) "backend=$($SolutionContract.contains_backend), frontend=$($SolutionContract.contains_frontend)"
        Add-Check "solution_ruflo_inherited" "Solucao herda runtime Ruflo" ($SolutionContract.ruflo_runtime -eq "inherited") "ruflo_runtime=$($SolutionContract.ruflo_runtime)"
        Add-Check "solution_agents_inherited" "Solucao herda agentes" ($SolutionContract.agents_runtime -eq "inherited") "agents_runtime=$($SolutionContract.agents_runtime)"
    }
    catch {
        Add-Check "solution_contract_json" "Contrato de solucao e JSON valido" $false $_.Exception.Message
    }
}

$Runtime = $null
if (Test-Path $RuntimePath) {
    try {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        Add-Check "runtime_json" "Runtime manifest e JSON valido" $true "config/runtime_manifest.json"
        Add-Check "ruflo_max_agents" "Ruflo max_agents=60" ([int]$Runtime.swarm.max_agents -eq 60) "max_agents=$($Runtime.swarm.max_agents)"
        Add-Check "ruflo_core_agents" "Ruflo core_agent_count=15" ([int]$Runtime.swarm.core_agent_count -eq 15) "core_agent_count=$($Runtime.swarm.core_agent_count)"
        Add-Check "ruflo_specialists" "Ruflo specialist_agent_count=45" ([int]$Runtime.swarm.specialist_agent_count -eq 45) "specialist_agent_count=$($Runtime.swarm.specialist_agent_count)"
        Add-Check "runtime_required_agents" "Runtime declara 15 core agents" (@($Runtime.validation.required_agents).Count -eq 15) "required_agents=$(@($Runtime.validation.required_agents).Count)"
        Add-Check "runtime_specialist_agents" "Runtime declara 45 especialistas" (@($Runtime.validation.specialist_agents).Count -eq 45) "specialist_agents=$(@($Runtime.validation.specialist_agents).Count)"
        Add-Check "runtime_cost_policy_enabled" "Runtime ativa orquestracao economica" ([bool]$Runtime.cost_optimization.enabled) "enabled=$($Runtime.cost_optimization.enabled)"
        Add-Check "runtime_cost_policy_path" "Runtime aponta para politica de custo" ($Runtime.cost_optimization.policy_file -eq "config/cost_optimization_policy.json") "policy_file=$($Runtime.cost_optimization.policy_file)"
        Add-Check "runtime_no_all_60_default" "Runtime exige justificativa para ativar 60 agentes" ([bool]$Runtime.cost_optimization.activate_all_60_requires_explicit_high_complexity) "activate_all_60_requires_explicit_high_complexity=$($Runtime.cost_optimization.activate_all_60_requires_explicit_high_complexity)"
        Add-Check "runtime_default_agent_limit" "Runtime inicia com apenas 1 agente" ([int]$Runtime.swarm.cost_aware_default_active_agents -eq 1) "default_agents=$($Runtime.swarm.cost_aware_default_active_agents)"
        Add-Check "runtime_enterprise_agent_limit" "Runtime limita perfil enterprise a 8 agentes" ([int]$Runtime.swarm.cost_aware_enterprise_active_agents -eq 8) "enterprise_agents=$($Runtime.swarm.cost_aware_enterprise_active_agents)"
        Add-Check "runtime_agentic_mesh_enabled" "Runtime ativa agentic mesh governance" ([bool]$Runtime.agentic_mesh.enabled) "enabled=$($Runtime.agentic_mesh.enabled)"
        Add-Check "runtime_agentic_mesh_layers" "Runtime declara 7 trust layers" ([int]$Runtime.agentic_mesh.trust_layers -eq 7) "trust_layers=$($Runtime.agentic_mesh.trust_layers)"
        Add-Check "runtime_agentic_mesh_fleets" "Runtime declara fleets de solucao" ([int]$Runtime.agentic_mesh.fleet_count -ge 5) "fleet_count=$($Runtime.agentic_mesh.fleet_count)"
        Add-Check "runtime_blueprint_contract_path" "Runtime aponta para agent blueprint contract" ($Runtime.agentic_mesh.agent_blueprint_contract_file -eq "config/agent_blueprint_contract.json") "agent_blueprint_contract_file=$($Runtime.agentic_mesh.agent_blueprint_contract_file)"
        Add-Check "runtime_improvement_loop_path" "Runtime aponta para improvement loop" ($Runtime.agentic_mesh.improvement_loop_file -eq "config/agent_improvement_loop.json") "improvement_loop_file=$($Runtime.agentic_mesh.improvement_loop_file)"
        Add-Check "runtime_ollama_enabled" "Runtime ativa Ollama local" ([bool]$Runtime.local_llm.enabled) "enabled=$($Runtime.local_llm.enabled)"
        Add-Check "runtime_ollama_model" "Runtime usa qwen2.5-coder:3b como modelo rapido" ($Runtime.local_llm.default_model -eq "qwen2.5-coder:3b") "model=$($Runtime.local_llm.default_model)"
        Add-Check "runtime_ollama_general_model" "Runtime integra qwen3:8b para respostas gerais" ($Runtime.local_llm.general_model -eq "qwen3:8b") "general_model=$($Runtime.local_llm.general_model)"
        Add-Check "runtime_ollama_balanced_model" "Runtime integra deepseek-coder-v2:lite como modelo equilibrado" ($Runtime.local_llm.balanced_model -eq "deepseek-coder-v2:lite") "balanced_model=$($Runtime.local_llm.balanced_model)"
        Add-Check "runtime_ollama_code_review_model" "Runtime integra DeepSeek Coder V2 Lite para revisao" ($Runtime.local_llm.code_review_model -eq "deepseek-coder-v2:lite") "code_review_model=$($Runtime.local_llm.code_review_model)"
        Add-Check "runtime_ollama_code_strong_model" "Runtime integra qwen2.5-coder:14b para codigo forte" ($Runtime.local_llm.code_strong_model -eq "qwen2.5-coder:14b") "code_strong_model=$($Runtime.local_llm.code_strong_model)"
        Add-Check "runtime_ollama_planning_strong_model" "Runtime integra qwen3:14b para planejamento forte" ($Runtime.local_llm.planning_strong_model -eq "qwen3:14b") "planning_strong_model=$($Runtime.local_llm.planning_strong_model)"
        Add-Check "runtime_ollama_reasoning_strong_model" "Runtime integra deepseek-r1:14b para raciocinio forte" ($Runtime.local_llm.reasoning_strong_model -eq "deepseek-r1:14b") "reasoning_strong_model=$($Runtime.local_llm.reasoning_strong_model)"
        Add-Check "runtime_ollama_large_model" "Runtime usa qwen2.5-coder:32b como alias avancado local" ($Runtime.local_llm.large_model -eq "qwen2.5-coder:32b") "large_model=$($Runtime.local_llm.large_model)"
        Add-Check "runtime_cloud_default" "Cloud fica desativada por padrao" (-not [bool]$Runtime.local_llm.cloud_default_enabled) "cloud_default=$($Runtime.local_llm.cloud_default_enabled)"
        Add-Check "runtime_output_limit" "Resposta local padrao limitada a 512 tokens" ([int]$Runtime.local_llm.default_max_output_tokens -eq 512) "max_output=$($Runtime.local_llm.default_max_output_tokens)"
        Add-Check "runtime_governed_model_access" "60 agentes usam acesso governado aos modelos" ($Runtime.local_llm.all_60_agents_model_access -eq "governed_on_demand") "access=$($Runtime.local_llm.all_60_agents_model_access)"
        Add-Check "runtime_sensitive_local" "Dados sensiveis ficam no provedor local" ([bool]$Runtime.local_llm.sensitive_content_local_only) "sensitive_content_local_only=$($Runtime.local_llm.sensitive_content_local_only)"
        Add-Check "runtime_continual_learning" "Aprendizagem continua por memoria esta ativa" ([bool]$Runtime.continual_learning.enabled) "enabled=$($Runtime.continual_learning.enabled)"
        Add-Check "runtime_no_auto_weight_update" "Pesos do modelo nao mudam automaticamente" (-not [bool]$Runtime.continual_learning.automatic_weight_updates) "automatic_weight_updates=$($Runtime.continual_learning.automatic_weight_updates)"
        Add-Check "runtime_learning_approval" "Promocao de aprendizado exige evals e aprovacao humana" ([bool]$Runtime.continual_learning.promotion_requires_evals_and_human_approval) "approval=$($Runtime.continual_learning.promotion_requires_evals_and_human_approval)"
        Add-Check "runtime_assistant_inheritance" "Runtime declara heranca Codex/Claude/AdoneX" ([bool]$Runtime.assistant_inheritance.enabled) "enabled=$($Runtime.assistant_inheritance.enabled)"
        Add-Check "runtime_peer_messaging_standalone" "Runtime aponta para peer messaging standalone" ($Runtime.assistant_inheritance.peer_messaging.script -eq "scripts/synapse_solution_peers_mcp.py") "script=$($Runtime.assistant_inheritance.peer_messaging.script)"
        Add-Check "runtime_shared_dialog_memory" "Runtime declara memoria compartilhada dos chats" ([bool]$Runtime.assistant_inheritance.shared_dialog_memory.enabled) "enabled=$($Runtime.assistant_inheritance.shared_dialog_memory.enabled)"
        Add-Check "runtime_shared_dialog_paths" "Runtime aponta para memoria compartilhada de dialogo" ($Runtime.assistant_inheritance.shared_dialog_memory.persistent_context -eq ".adonex/memory/SHARED_DIALOG_MEMORY.md" -and $Runtime.assistant_inheritance.shared_dialog_memory.chat_tasks -eq ".adonex/memory/CHAT_TASKS.md") "shared=$($Runtime.assistant_inheritance.shared_dialog_memory.persistent_context); tasks=$($Runtime.assistant_inheritance.shared_dialog_memory.chat_tasks)"
    }
    catch {
        Add-Check "runtime_json" "Runtime manifest e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $AgentsPath) {
    $AgentIds = @(Select-String -Path $AgentsPath -Pattern '^\s*-\s+id:\s*([A-Za-z0-9_-]+)\s*$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
    Add-Check "agents_total" "Projeto contem 60 agentes" ($AgentIds.Count -eq 60) "agents=$($AgentIds.Count)"
    Add-Check "agents_unique" "Agentes do projeto nao estao duplicados" (@($AgentIds | Sort-Object -Unique).Count -eq 60) "unique_agents=$(@($AgentIds | Sort-Object -Unique).Count)"
}

if (Test-Path $ModelProvidersPath) {
    try {
        $Providers = Get-Content $ModelProvidersPath -Raw | ConvertFrom-Json
        Add-Check "model_providers_json" "Politica de provedores e JSON valido" $true "config/model_providers.json"
        Add-Check "model_providers_local_first" "Politica de provedores e local-first" ($Providers.routing_strategy -eq "local_first") "routing_strategy=$($Providers.routing_strategy)"
        Add-Check "model_providers_ruflo_bridge" "Ponte Ruflo governada esta ativa" ([bool]$Providers.ruflo_bridge.enabled) "enabled=$($Providers.ruflo_bridge.enabled)"
        Add-Check "model_providers_all_60" "Todos os 60 agentes podem acessar o roteador governado" ([bool]$Providers.ruflo_bridge.all_60_agents_have_governed_router_access) "all_60=$($Providers.ruflo_bridge.all_60_agents_have_governed_router_access)"
        Add-Check "model_providers_cloud_opt_in" "Provedor cloud exige opt-in e aprovacao" ((-not [bool]$Providers.automatic_routing.cloud_default_enabled) -and [bool]$Providers.automatic_routing.cloud_requires_human_approval) "cloud_default=$($Providers.automatic_routing.cloud_default_enabled)"
    }
    catch {
        Add-Check "model_providers_json" "Politica de provedores e JSON valido" $false $_.Exception.Message
    }
}

$Universe = $null
if (Test-Path $UniversePath) {
    try {
        $Universe = Get-Content $UniversePath -Raw | ConvertFrom-Json
        Add-Check "universe_json" "Project universe e JSON valido" $true "config/project_universe.json"
        Add-Check "data_treatment_enabled" "Tratamento de dados ativo" ([bool]$Universe.capabilities.data_treatment) "data_treatment=$($Universe.capabilities.data_treatment)"
        Add-Check "ruflo_core_capability" "Capacidade Ruflo core agents=15" ([int]$Universe.capabilities.ruflo_core_agents -eq 15) "ruflo_core_agents=$($Universe.capabilities.ruflo_core_agents)"
        Add-Check "ruflo_max_capability" "Capacidade Ruflo max agents=60" ([int]$Universe.capabilities.ruflo_max_agents -eq 60) "ruflo_max_agents=$($Universe.capabilities.ruflo_max_agents)"
    }
    catch {
        Add-Check "universe_json" "Project universe e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $CostPolicyPath) {
    try {
        $CostPolicy = Get-Content $CostPolicyPath -Raw | ConvertFrom-Json
        Add-Check "cost_policy_json" "Politica de custo e JSON valido" $true "config/cost_optimization_policy.json"
        Add-Check "cost_policy_max_agents" "Politica mantem 60 agentes disponiveis" ([int]$CostPolicy.ruflo.max_available_agents -eq 60) "max_available_agents=$($CostPolicy.ruflo.max_available_agents)"
        Add-Check "cost_policy_default_agents" "Politica nao ativa 60 agentes por padrao" ([int]$CostPolicy.ruflo.default_active_agents -lt 60) "default_active_agents=$($CostPolicy.ruflo.default_active_agents)"
        Add-Check "cost_policy_simple_budget" "Perfil simples usa no maximo 1 agente e budget 1200" (([int]$CostPolicy.activation_profiles.simple.active_agent_limit -eq 1) -and ([int]$CostPolicy.activation_profiles.simple.token_budget -eq 1200)) "agents=$($CostPolicy.activation_profiles.simple.active_agent_limit); budget=$($CostPolicy.activation_profiles.simple.token_budget)"
        Add-Check "cost_policy_prompt_cache" "Politica prioriza prompt cache" ([bool]$CostPolicy.token_controls.prefer_prompt_cache) "prefer_prompt_cache=$($CostPolicy.token_controls.prefer_prompt_cache)"
        Add-Check "cost_policy_context_compression" "Politica comprime contexto antes do LLM" ([bool]$CostPolicy.token_controls.compress_context_before_llm) "compress_context_before_llm=$($CostPolicy.token_controls.compress_context_before_llm)"
    }
    catch {
        Add-Check "cost_policy_json" "Politica de custo e JSON valido" $false $_.Exception.Message
    }
}

$EnvExamplePath = Join-Path $ProjectRoot ".env.example"
if (Test-Path $EnvExamplePath) {
    $EnvExample = Get-Content $EnvExamplePath -Raw
    Add-Check "env_default_agent_limit" ".env.example usa 1 agente por padrao" ($EnvExample -match "PROJECT_DEFAULT_ACTIVE_AGENTS=1") "PROJECT_DEFAULT_ACTIVE_AGENTS"
    Add-Check "env_enterprise_agent_limit" ".env.example usa 8 agentes no perfil enterprise" ($EnvExample -match "PROJECT_ENTERPRISE_ACTIVE_AGENTS=8") "PROJECT_ENTERPRISE_ACTIVE_AGENTS"
}

$McpPath = Join-Path $ProjectRoot ".mcp.json"
if (Test-Path $McpPath) {
    try {
        $Mcp = Get-Content $McpPath -Raw | ConvertFrom-Json
        $PeerServer = $Mcp.mcpServers.'synapse-peers'
        Add-Check "mcp_peer_server" ".mcp.json expoe synapse-peers" ($null -ne $PeerServer) "synapse-peers"
        Add-Check "mcp_peer_standalone_script" "synapse-peers usa script standalone do projeto" (@($PeerServer.args) -contains "scripts/synapse_solution_peers_mcp.py") "args=$(@($PeerServer.args) -join ',')"
        Add-Check "mcp_peer_no_backend_script" "synapse-peers nao usa script dependente do backend" (-not (@($PeerServer.args) -contains "scripts/synapse_peers_mcp.py")) "args=$(@($PeerServer.args) -join ',')"
        Add-Check "mcp_peer_cost_limits" "synapse-peers limita mensagens e resumos" ($PeerServer.env.PEER_MESSAGING_MAX_MESSAGE_CHARS -eq "1200" -and $PeerServer.env.PEER_MESSAGING_MAX_SUMMARY_CHARS -eq "360") "message=$($PeerServer.env.PEER_MESSAGING_MAX_MESSAGE_CHARS); summary=$($PeerServer.env.PEER_MESSAGING_MAX_SUMMARY_CHARS)"
    }
    catch {
        Add-Check "mcp_json" ".mcp.json e JSON valido" $false $_.Exception.Message
    }
}

$VsCodeSettingsPath = Join-Path $ProjectRoot ".vscode\settings.json"
if (Test-Path $VsCodeSettingsPath) {
    try {
        $VsCodeSettings = Get-Content $VsCodeSettingsPath -Raw | ConvertFrom-Json
        Add-Check "adonex_local_mode" "AdoneX opera em modo local" ($VsCodeSettings.'adonex.agent.defaultMode' -eq "local") "mode=$($VsCodeSettings.'adonex.agent.defaultMode')"
        Add-Check "adonex_fast_model" "AdoneX usa qwen2.5-coder:3b como modelo rapido" ($VsCodeSettings.'adonex.ollama.model' -eq "qwen2.5-coder:3b") "model=$($VsCodeSettings.'adonex.ollama.model')"
        Add-Check "adonex_reasoning_model" "AdoneX usa deepseek-coder-v2:lite como modelo de raciocinio" ($VsCodeSettings.'adonex.ollama.modelReasoning' -eq "deepseek-coder-v2:lite") "modelReasoning=$($VsCodeSettings.'adonex.ollama.modelReasoning')"
        Add-Check "adonex_peer_db" "AdoneX aponta para o banco local de peers" ($VsCodeSettings.'adonex.synapse.peerMessaging.dbPath' -eq "./artifacts/peers/synapse-peers.db") "db=$($VsCodeSettings.'adonex.synapse.peerMessaging.dbPath')"
    }
    catch {
        Add-Check "adonex_settings_json" ".vscode/settings.json e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $BlueprintContractPath) {
    try {
        $Blueprint = Get-Content $BlueprintContractPath -Raw | ConvertFrom-Json
        Add-Check "blueprint_contract_json" "Agent blueprint contract e JSON valido" $true "config/agent_blueprint_contract.json"
        Add-Check "blueprint_contract_fields" "Agent blueprint contract declara campos obrigatorios" (@($Blueprint.required_fields).Count -ge 12) "required_fields=$(@($Blueprint.required_fields).Count)"
        Add-Check "blueprint_contract_single_agent_gate" "Agent blueprint contract tem gate single-agent first" ([bool]$Blueprint.architecture_decision_gate.single_agent_first) "single_agent_first=$($Blueprint.architecture_decision_gate.single_agent_first)"
        Add-Check "blueprint_contract_a2a" "Agent blueprint contract declara contrato A2A" ([bool]$Blueprint.a2a_message_contract.enabled) "a2a_enabled=$($Blueprint.a2a_message_contract.enabled)"
        Add-Check "blueprint_contract_callbacks" "Agent blueprint contract declara callbacks de ciclo de vida" (@($Blueprint.lifecycle_callbacks).Count -ge 6) "callbacks=$(@($Blueprint.lifecycle_callbacks).Count)"
    }
    catch {
        Add-Check "blueprint_contract_json" "Agent blueprint contract e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $ImprovementLoopPath) {
    try {
        $Improvement = Get-Content $ImprovementLoopPath -Raw | ConvertFrom-Json
        Add-Check "improvement_loop_json" "Agent improvement loop e JSON valido" $true "config/agent_improvement_loop.json"
        Add-Check "improvement_loop_teacher_review" "Improvement loop usa GPT/Claude como revisores" (@($Improvement.teacher_review.providers) -contains "claude" -and @($Improvement.teacher_review.providers) -contains "gpt") "providers=$($Improvement.teacher_review.providers -join ',')"
        Add-Check "improvement_loop_privacy" "Improvement loop tem controles de privacidade" (@($Improvement.privacy_controls).Count -gt 0) "privacy_controls=$(@($Improvement.privacy_controls).Count)"
    }
    catch {
        Add-Check "improvement_loop_json" "Agent improvement loop e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $TrustFrameworkPath) {
    try {
        $Trust = Get-Content $TrustFrameworkPath -Raw | ConvertFrom-Json
        Add-Check "trust_framework_json" "Trust framework e JSON valido" $true "config/agent_trust_framework.json"
        Add-Check "trust_framework_layers" "Trust framework contem 7 camadas" (@($Trust.layers).Count -eq 7) "layers=$(@($Trust.layers).Count)"
        Add-Check "trust_framework_approval" "Trust framework exige aprovacao humana para acoes criticas" (@($Trust.autonomy_matrix.requires_human_approval).Count -gt 0) "requires_human_approval=$(@($Trust.autonomy_matrix.requires_human_approval).Count)"
    }
    catch {
        Add-Check "trust_framework_json" "Trust framework e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $FleetsPath) {
    try {
        $Fleets = Get-Content $FleetsPath -Raw | ConvertFrom-Json
        Add-Check "agent_fleets_json" "Agent fleets e JSON valido" $true "config/agent_fleets.json"
        Add-Check "agent_fleets_count" "Projeto contem apenas fleets de solucao" (@($Fleets.fleets).Count -ge 5) "fleets=$(@($Fleets.fleets).Count)"
        Add-Check "agent_fleets_no_factory" "Fleet de fabrica permanece exclusiva do Synapse" (-not (@($Fleets.fleets.id) -contains "project_factory_fleet")) "project_factory_fleet=false"
        Add-Check "agent_fleets_cost_aware" "Fleets usam ativacao economica" ($Fleets.fleet_defaults.activation_policy -eq "cost_aware_on_demand") "activation_policy=$($Fleets.fleet_defaults.activation_policy)"
        Add-Check "agent_fleets_approval" "Fleets exigem aprovacao para 60 agentes" ([bool]$Fleets.fleet_defaults.human_approval_required_for_all_60_agents) "human_approval_required_for_all_60_agents=$($Fleets.fleet_defaults.human_approval_required_for_all_60_agents)"
    }
    catch {
        Add-Check "agent_fleets_json" "Agent fleets e JSON valido" $false $_.Exception.Message
    }
}

$AiEnabled = $false
if ($Universe -ne $null) {
    $AiEnabled = [bool]$Universe.capabilities.ai -or [bool]$Universe.capabilities.rag -or $Universe.universe -in @("ia", "hybrid")
}

if ($AiEnabled) {
    Test-RelativePath "framework_catalog" "config\ai_framework_selection.json" "Catalogo de frameworks IA existe"
    Test-RelativePath "ai_framework_spec" "docs\specifications\ai_framework_selection.md" "Projetos IA/Hibridos/Chatbolt tem especificacao de frameworks IA"
    if (Test-Path (Join-Path $ProjectRoot "config\ai_framework_selection.json")) {
        try {
            $FrameworkCatalog = Get-Content (Join-Path $ProjectRoot "config\ai_framework_selection.json") -Raw | ConvertFrom-Json
            Add-Check "ai_framework_count" "Catalogo tem 14 frameworks IA" (@($FrameworkCatalog.frameworks).Count -eq 14) "frameworks=$(@($FrameworkCatalog.frameworks).Count)"
            $FrameworkIds = @($FrameworkCatalog.frameworks | ForEach-Object { $_.id })
            foreach ($RequiredFramework in @("langgraph", "llamaindex", "haystack", "openai-agents-sdk", "pydantic-ai", "crewai", "autogen", "microsoft-agent-framework-semantic-kernel", "dify", "flowise", "ragflow", "r2r", "mcp-sdks", "swarms")) {
                Add-Check "framework_$RequiredFramework" "Framework $RequiredFramework esta no catalogo" ($FrameworkIds -contains $RequiredFramework) $RequiredFramework
            }
        }
        catch {
            Add-Check "ai_framework_catalog_json" "Catalogo de frameworks IA e JSON valido" $false $_.Exception.Message
        }
    }
}
else {
    Add-Check "ai_framework_spec_optional" "Projeto ML puro nao exige especificacao de frameworks IA" $true "universe=$($Universe.universe)"
}

$Failed = @($Checks | Where-Object { -not $_.passed })
$Passed = @($Checks | Where-Object { $_.passed })
$Status = if ($Failed.Count -eq 0) { "passed" } else { "failed" }
$OutputDir = Join-Path $ProjectRoot "output"
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$JsonPath = Join-Path $OutputDir "project_diagnostics.json"
$MdPath = Join-Path $OutputDir "project_diagnostics.md"

$Report = [pscustomobject]@{
    project = $ProjectName
    path = $ProjectRoot
    overall_status = $Status
    generated_at = (Get-Date).ToString("s")
    checks_total = $Checks.Count
    checks_passed = $Passed.Count
    checks_failed = $Failed.Count
    checks = @($Checks.ToArray())
}

$Report | ConvertTo-Json -Depth 10 | Set-Content -Path $JsonPath -Encoding UTF8

$Lines = New-Object System.Collections.Generic.List[string]
$Lines.Add("# Diagnostico do Projeto - $ProjectName")
$Lines.Add("")
$Lines.Add("- Status: $Status")
$Lines.Add("- Checks: $($Report.checks_passed)/$($Report.checks_total)")
$Lines.Add("- Gerado em: $($Report.generated_at)")
$Lines.Add("")
$Lines.Add("## Checklist")
foreach ($Check in $Checks) {
    $Mark = if ($Check.passed) { "[x]" } else { "[ ]" }
    $Lines.Add("- $Mark $($Check.description) - $($Check.detail)")
}
$Lines | Set-Content -Path $MdPath -Encoding UTF8

Write-Host "Diagnostico do projeto: $Status" -ForegroundColor $(if ($Status -eq "passed") { "Green" } else { "Red" })
Write-Host "Relatorio JSON: output\project_diagnostics.json"
Write-Host "Relatorio Markdown: output\project_diagnostics.md"

if ($Failed.Count -gt 0) {
    Write-Host "Falhas:" -ForegroundColor Red
    $Failed | ForEach-Object { Write-Host " - $($_.description): $($_.detail)" -ForegroundColor Red }
    exit 1
}

exit 0

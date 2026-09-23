param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectName,

    [string]$DestinoBase = (Join-Path $env:USERPROFILE "Documents\Projetos")
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
$CostPolicyPath = Join-Path $ProjectRoot "config\cost_optimization_policy.json"
$ContextPolicyPath = Join-Path $ProjectRoot "config\context_policy.json"
$BlueprintContractPath = Join-Path $ProjectRoot "config\agent_blueprint_contract.json"
$ImprovementLoopPath = Join-Path $ProjectRoot "config\agent_improvement_loop.json"
$ModelProvidersPath = Join-Path $ProjectRoot "config\model_providers.json"

Test-RelativePath "runtime_manifest" "config\runtime_manifest.json" "Runtime manifest existe"
Test-RelativePath "project_universe" "config\project_universe.json" "Universo do projeto existe"
Test-RelativePath "solution_contract" "config\synapse_solution_contract.json" "Contrato de solucao gerenciada pelo Synapse existe"
Test-RelativePath "enterprise_spec" "config\ai_ml_enterprise_spec.json" "Especificacao enterprise IA/ML existe"
Test-RelativePath "cost_optimization_policy" "config\cost_optimization_policy.json" "Politica de custo e roteamento de modelos existe"
Test-RelativePath "context_policy" "config\context_policy.json" "Politica central de contexto LLM existe"
Test-RelativePath "roles" "config\roles.json" "Papeis dos workflows existem"
Test-RelativePath "agent_blueprint_contract" "config\agent_blueprint_contract.json" "Contrato de agent blueprint existe"
Test-RelativePath "agentic_architectural_patterns" "config\agentic_architectural_patterns.json" "Catalogo de padroes arquiteturais agentic existe"
Test-RelativePath "agent_improvement_loop" "config\agent_improvement_loop.json" "Loop de melhoria de agents existe"
Test-RelativePath "model_providers" "config\model_providers.json" "Politica de provedores OpenAI/Anthropic existe"
Test-RelativePath "business_solution_analysis_json" "config\business_solution_analysis.json" "Analise de solucao de negocio existe"
Test-RelativePath "business_solution_analysis_md" "docs\briefings\business_solution_analysis.md" "Briefing da analise de solucao de negocio existe"
Test-RelativePath "llm_solution_factory_policy" "config\llm_solution_factory_policy.json" "Policy geral da fabrica de solucoes para LLMs existe"
Test-RelativePath "llm_solution_factory_governance" "docs\specifications\llm_solution_factory_governance.md" "Governanca geral da fabrica de solucoes para LLMs existe"
Test-RelativePath "data_treatment_policy" "config\data_treatment_policy.json" "Politica do prompt mestre de tratamento existe"
Test-RelativePath "master_data_treatment_prompt" "prompts\master_data_treatment.md" "Prompt mestre de tratamento estatistico existe"
Test-RelativePath "data_treatment_prompt" "prompts\codex_data_treatment_dialog.md" "Prompt de tratamento de dados existe"
Test-RelativePath "data_treatment_script" "scripts\treat_dataset.py" "Script de tratamento de dados existe"
Test-RelativePath "mcp_config" ".mcp.json" "Configuracao MCP do projeto existe"
Test-RelativePath "codex_agents_instructions" "AGENTS.md" "Instrucoes Codex/agents do projeto existem"
Test-RelativePath "claude_instructions" "CLAUDE.md" "Instrucoes Claude do projeto existem"
Test-RelativePath "peer_messaging_runbook" "docs\runbooks\peer_messaging.md" "Runbook de peer messaging existe"
Test-RelativePath "peer_messaging_mcp" "scripts\synapse_solution_peers_mcp.py" "MCP peer messaging standalone existe"
Test-RelativePath "vscode_settings" ".vscode\settings.json" "Settings VS Code existem"
Test-RelativePath "vscode_extensions" ".vscode\extensions.json" "Recomendacoes de extensoes VS Code existem"
Test-RelativePath "attachment_manifest" "docs\briefings\codex_attachments_manifest.json" "Manifesto de anexos Codex existe"
Test-RelativePath "execution_spec" "docs\specifications\ai_ml_execution_spec.md" "Especificacao de execucao existe"
Test-RelativePath "agent_governance_spec" "docs\specifications\agent_governance.md" "Especificacao de governanca de agentes existe"
Test-RelativePath "agentic_patterns_spec" "docs\specifications\agentic_architectural_patterns.md" "Especificacao de padroes arquiteturais agentic existe"
Test-RelativePath "agent_certification" "docs\checklists\agent_certification.md" "Checklist de certificacao de agents existe"
Test-RelativePath "agent_sre_runbook" "docs\runbooks\agent_sre.md" "Runbook Agent SRE existe"
Test-RelativePath "harness_engineering_policy" "config\harness_engineering_policy.json" "Politica de harness engineering existe"
Test-RelativePath "harness_engineering_spec" "docs\specifications\harness_engineering.md" "Especificacao de harness engineering existe"
Test-RelativePath "harness_contract_test" "tests\test_harness_contract.py" "Teste de contrato do harness existe"
Test-RelativePath "business_transformation_engine" "scripts\synapse_lib\business_transformation.py" "Motor de transformacao empresarial existe"
Test-RelativePath "business_transformation_cases" "evals\business_transformation_cases.jsonl" "Casos de eval de transformacao empresarial existem"
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
        Add-Check "runtime_cost_policy_enabled" "Runtime ativa roteamento de modelos por custo" ([bool]$Runtime.cost_optimization.enabled) "enabled=$($Runtime.cost_optimization.enabled)"
        Add-Check "runtime_cost_policy_path" "Runtime aponta para politica de custo" ($Runtime.cost_optimization.policy_file -eq "config/cost_optimization_policy.json") "policy_file=$($Runtime.cost_optimization.policy_file)"
        Add-Check "runtime_agent_governance_enabled" "Runtime ativa governanca de agentes" ([bool]$Runtime.agent_governance.enabled) "enabled=$($Runtime.agent_governance.enabled)"
        Add-Check "runtime_governance_policy" "Governanca aponta para o harness" ($Runtime.agent_governance.governance_policy_file -eq "config/harness_engineering_policy.json") "governance_policy_file=$($Runtime.agent_governance.governance_policy_file)"
        Add-Check "runtime_blueprint_contract_path" "Runtime aponta para agent blueprint contract" ($Runtime.agent_governance.agent_blueprint_contract_file -eq "config/agent_blueprint_contract.json") "agent_blueprint_contract_file=$($Runtime.agent_governance.agent_blueprint_contract_file)"
        Add-Check "runtime_improvement_loop_path" "Runtime aponta para improvement loop" ($Runtime.agent_governance.improvement_loop_file -eq "config/agent_improvement_loop.json") "improvement_loop_file=$($Runtime.agent_governance.improvement_loop_file)"
        Add-Check "runtime_cloud_provider" "Runtime usa OpenAI como provedor direto" ($Runtime.local_llm.provider -eq "openai") "provider=$($Runtime.local_llm.provider)"
        Add-Check "runtime_cloud_routing" "Runtime roteia direto para a nuvem" ($Runtime.local_llm.routing_strategy -eq "cloud_only") "routing_strategy=$($Runtime.local_llm.routing_strategy)"
        Add-Check "runtime_cloud_default" "Cloud fica ativada por padrao" ([bool]$Runtime.local_llm.cloud_default_enabled) "cloud_default=$($Runtime.local_llm.cloud_default_enabled)"
        Add-Check "runtime_output_limit" "Resposta padrao limitada a 512 tokens" ([int]$Runtime.local_llm.default_max_output_tokens -eq 512) "max_output=$($Runtime.local_llm.default_max_output_tokens)"
        Add-Check "runtime_sensitive_blocked" "Dados sensiveis sao bloqueados em vez de roteados" ([bool]$Runtime.local_llm.sensitive_content_blocked) "sensitive_content_blocked=$($Runtime.local_llm.sensitive_content_blocked)"
        Add-Check "runtime_continual_learning" "Aprendizagem continua por memoria esta ativa" ([bool]$Runtime.continual_learning.enabled) "enabled=$($Runtime.continual_learning.enabled)"
        Add-Check "runtime_no_auto_weight_update" "Pesos do modelo nao mudam automaticamente" (-not [bool]$Runtime.continual_learning.automatic_weight_updates) "automatic_weight_updates=$($Runtime.continual_learning.automatic_weight_updates)"
        Add-Check "runtime_learning_approval" "Promocao de aprendizado exige evals e aprovacao humana" ([bool]$Runtime.continual_learning.promotion_requires_evals_and_human_approval) "approval=$($Runtime.continual_learning.promotion_requires_evals_and_human_approval)"
        Add-Check "runtime_assistant_inheritance" "Runtime declara heranca Codex/Claude" ([bool]$Runtime.assistant_inheritance.enabled) "enabled=$($Runtime.assistant_inheritance.enabled)"
        Add-Check "runtime_peer_messaging_standalone" "Runtime aponta para peer messaging standalone" ($Runtime.assistant_inheritance.peer_messaging.script -eq "scripts/synapse_solution_peers_mcp.py") "script=$($Runtime.assistant_inheritance.peer_messaging.script)"
    }
    catch {
        Add-Check "runtime_json" "Runtime manifest e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $ModelProvidersPath) {
    try {
        $Providers = Get-Content $ModelProvidersPath -Raw | ConvertFrom-Json
        Add-Check "model_providers_json" "Politica de provedores e JSON valido" $true "config/model_providers.json"
        Add-Check "model_providers_assistant_boundaries" "Politica de provedores usa fronteiras por assistente" ($Providers.routing_strategy -eq "assistant_boundaries") "routing_strategy=$($Providers.routing_strategy)"
        Add-Check "model_providers_cloud_no_friction" "Chamadas de rotina nao exigem aprovacao humana" ([bool]$Providers.automatic_routing.cloud_default_enabled -and (-not [bool]$Providers.automatic_routing.cloud_requires_human_approval)) "cloud_default=$($Providers.automatic_routing.cloud_default_enabled)"
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
        if ([bool]$Universe.capabilities.ai) {
            Test-RelativePath "rag_scalability_policy" "config\rag_scalability_policy.json" "Politica de RAG escalavel e vector DB existe"
            Test-RelativePath "fine_tuning_policy" "config\fine_tuning_policy.json" "Politica de fine-tuning existe"
            Test-RelativePath "retrieval_eval_cases" "evals\retrieval_cases.jsonl" "Casos de eval de retrieval existem"
            Test-RelativePath "solution_agents" "config\solution_agents.json" "Blueprints dos agentes da solucao existem"
            Test-RelativePath "agent_build_workflow" "config\workflows\synapse\agent-build.json" "Workflow agent-build existe"
        }
    }
    catch {
        Add-Check "universe_json" "Project universe e JSON valido" $false $_.Exception.Message
    }
}

if (Test-Path $CostPolicyPath) {
    try {
        $CostPolicy = Get-Content $CostPolicyPath -Raw | ConvertFrom-Json
        Add-Check "cost_policy_json" "Politica de custo e JSON valido" $true "config/cost_optimization_policy.json"
        Add-Check "cost_policy_simple_budget" "Perfil simples usa tier economico e budget 1200" (($CostPolicy.request_profiles.simple.model_tier -eq "economy") -and ([int]$CostPolicy.request_profiles.simple.token_budget -eq 1200)) "tier=$($CostPolicy.request_profiles.simple.model_tier); budget=$($CostPolicy.request_profiles.simple.token_budget)"
        Add-Check "cost_policy_prompt_cache" "Politica prioriza prompt cache" ([bool]$CostPolicy.token_controls.prefer_prompt_cache) "prefer_prompt_cache=$($CostPolicy.token_controls.prefer_prompt_cache)"
        Add-Check "cost_policy_context_compression" "Politica comprime contexto antes do LLM" ([bool]$CostPolicy.token_controls.compress_context_before_llm) "compress_context_before_llm=$($CostPolicy.token_controls.compress_context_before_llm)"
    }
    catch {
        Add-Check "cost_policy_json" "Politica de custo e JSON valido" $false $_.Exception.Message
    }
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
        Get-Content $VsCodeSettingsPath -Raw | ConvertFrom-Json | Out-Null
        Add-Check "vscode_settings_json" ".vscode/settings.json e JSON valido" $true "settings=$VsCodeSettingsPath"
    }
    catch {
        Add-Check "vscode_settings_json" ".vscode/settings.json e JSON valido" $false $_.Exception.Message
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

$HarnessPolicyPath = Join-Path $ProjectRoot "config\harness_engineering_policy.json"
if (Test-Path $HarnessPolicyPath) {
    try {
        $Harness = Get-Content $HarnessPolicyPath -Raw | ConvertFrom-Json
        Add-Check "harness_governance" "Harness define governanca de agentes" ($null -ne $Harness.governance) "governance"
        Add-Check "harness_approval" "Harness exige aprovacao humana para acoes criticas" (@($Harness.governance.autonomy_matrix.requires_human_approval).Count -gt 0) "requires_human_approval=$(@($Harness.governance.autonomy_matrix.requires_human_approval).Count)"
    }
    catch {
        Add-Check "harness_policy_json" "Politica de harness e JSON valido" $false $_.Exception.Message
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

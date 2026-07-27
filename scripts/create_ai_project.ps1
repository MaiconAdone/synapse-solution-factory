param(
    [Parameter(Mandatory=$true)]
    [string]$NomeProjeto,

    [string]$TipoProjeto = "b2b2c-ai-ml-agentic-saas",
    [string]$Template = "",
    [string]$DestinoBase = "",
    [string]$ProjectGoal = "",
    [string]$BusinessProblem = "",
    [string]$SolutionFocus = "",
    [string]$SuccessMetric = "",
    [string]$AvailableSources = "",
    [string]$RiskLevel = "",
    [int]$ActiveAgentLimit = 0,
    [switch]$SkipValidation,
    [switch]$SkipActivation,
    [switch]$ActivateRuflo,
    [switch]$LocalMemoryOnly
)

if ([string]::IsNullOrWhiteSpace($DestinoBase)) {
    $DestinoBase = if ([string]::IsNullOrWhiteSpace($env:SYNAPSE_PROJECTS_DIR)) {
        Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    } else {
        $env:SYNAPSE_PROJECTS_DIR
    }
}

$Destino = Join-Path $DestinoBase $NomeProjeto
# Record whether the destination pre-existed so rollback never deletes a project
# that was not created by this run.
$DestinoExistedBefore = Test-Path $Destino
if ([string]::IsNullOrWhiteSpace($Template)) {
    $Template = Split-Path -Parent $PSScriptRoot
}
$ProjectSlug = ($NomeProjeto.ToLower() -replace '[^a-z0-9]+', '-' -replace '(^-)|(-$)', '')
if ([string]::IsNullOrWhiteSpace($ProjectSlug)) {
    Write-Host "ERRO: Nome do projeto nao gerou um slug valido." -ForegroundColor Red
    exit 1
}
$SwarmName = "$ProjectSlug-swarm"
$CreationDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Project-factory helpers are modularized under scripts/project_factory/ so this
# entry script stays an orchestrator instead of a single oversized file.
. (Join-Path $PSScriptRoot 'project_factory\ProjectFactory.Common.ps1')
. (Join-Path $PSScriptRoot 'project_factory\ProjectFactory.Content.ps1')

$ProjectUniverse = Resolve-ProjectUniverse $TipoProjeto
$TipoProjetoOriginal = $TipoProjeto
$TipoProjeto = $ProjectUniverse.project_type

# Compensation/rollback for the creation transaction: if any phase fails after we
# started scaffolding, remove the partial project directory. Never touches a
# destination that already existed before this run.
function Remove-PartialProject {
    param([string]$Reason)
    if ($DestinoExistedBefore) {
        Write-Host "Rollback pulado: o destino ja existia antes desta execucao." -ForegroundColor Yellow
        return
    }
    if (Test-Path $Destino) {
        try {
            Get-ChildItem -LiteralPath $Destino -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
                try { $_.Attributes = [System.IO.FileAttributes]::Normal } catch {}
            }
            Remove-Item -LiteralPath $Destino -Recurse -Force -ErrorAction Stop
            Write-Host "Rollback: projeto parcial removido apos falha ($Reason)." -ForegroundColor Yellow
        }
        catch {
            Write-Host "Aviso: nao foi possivel remover o projeto parcial em $Destino. $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

function Copy-Template {
    if (!(Test-Path $Template)) {
        Write-Host "ERRO: Template nao encontrado: $Template" -ForegroundColor Red
        exit 1
    }

    if (Test-Path $Destino) {
        Write-Host "ERRO: Projeto ja existe: $Destino" -ForegroundColor Red
        exit 1
    }

    Write-Host "Criando projeto enterprise do universo $($ProjectUniverse.label)..." -ForegroundColor Cyan
    $SkipNames = @(
        ".git",
        ".github",
        ".claude",
        ".claude-flow",
        ".codex",
        ".adonex",
        ".vscode",
        ".vscode-test",
        ".next",
        ".pytest_cache",
        "__pycache__",
        "node_modules",
        ".venv",
        "venv",
        ".mypy_cache",
        ".ruff_cache",
        "mlruns",
        "vendor",
        "backend",
        "frontend",
        "supabase",
        "tests",
        "artifacts",
        "data",
        "experiments",
        "memory",
        "output",
        "dist",
        "build",
        ".cache",
        "output",
        "logs",
        ".swarm",
        "chatEditingSessions",
        "workspaceStorage",
        "History"
    )
    $SkipFiles = @(
        "CLAUDE.md",
        "Dockerfile",
        "docker-compose.yml",
        "package.json",
        "package-lock.json",
        "pytest.ini",
        "criar_projeto_ia.ps1",
        "create_ai_project.ps1",
        "ai_factory_menu.ps1",
        "bootstrap_enterprise_stack.ps1",
        "validate_enterprise_stack.ps1",
        "synapse_ollama_mcp.py",
        "synapse_peers_mcp.py",
        "test_local_llm.py",
        "agentdb.rvf",
        "agentdb.rvf.lock",
        "ruvector.db",
        "*.pyc",
        "*.pyo"
    )
    function Copy-TemplateItem {
        param(
            [System.IO.FileSystemInfo]$SourceItem,
            [string]$TargetParent
        )

        if ($SkipNames -contains $SourceItem.Name) {
            return
        }

        foreach ($Pattern in $SkipFiles) {
            if ($SourceItem.Name -like $Pattern) {
                return
            }
        }

        $TargetPath = Join-Path $TargetParent $SourceItem.Name
        if ($SourceItem.PSIsContainer) {
            New-Item -ItemType Directory -Path $TargetPath -Force -ErrorAction Stop | Out-Null
            Get-ChildItem -LiteralPath $SourceItem.FullName -Force | ForEach-Object {
                Copy-TemplateItem -SourceItem $_ -TargetParent $TargetPath
            }
        }
        else {
            Copy-Item -LiteralPath $SourceItem.FullName -Destination $TargetPath -Force -ErrorAction Stop
        }
    }

    try {
        New-Item -ItemType Directory -Path $Destino -Force -ErrorAction Stop | Out-Null
        Get-ChildItem -LiteralPath $Template -Force | ForEach-Object {
            Copy-TemplateItem -SourceItem $_ -TargetParent $Destino
        }
    }
    catch {
        Write-Host "ERRO: Falha ao copiar template para $Destino" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        throw "Falha ao copiar template para ${Destino}: $($_.Exception.Message)"
    }
}

function Copy-AdoneXRuntime {
    $SourceRoot = Join-Path $Template "adonex"
    $TargetRoot = Join-Path $Destino "adonex"
    if (!(Test-Path $SourceRoot)) {
        Write-Host "ERRO: runtime AdoneX nao encontrado no template: $SourceRoot" -ForegroundColor Red
        throw "Runtime AdoneX nao encontrado no template: $SourceRoot"
    }

    $SkipNames = @(
        "node_modules",
        "dist",
        ".vscode-test",
        "coverage",
        ".cache",
        ".turbo",
        "out"
    )
    $SkipFiles = @(
        "debug.log",
        "*.vsix",
        "*.tsbuildinfo",
        ".env",
        ".env.*"
    )

    function Copy-AdoneXItem {
        param(
            [System.IO.FileSystemInfo]$SourceItem,
            [string]$TargetParent
        )

        if ($SkipNames -contains $SourceItem.Name) {
            return
        }

        foreach ($Pattern in $SkipFiles) {
            if ($SourceItem.Name -like $Pattern) {
                return
            }
        }

        $TargetPath = Join-Path $TargetParent $SourceItem.Name
        if ($SourceItem.PSIsContainer) {
            New-Item -ItemType Directory -Path $TargetPath -Force -ErrorAction Stop | Out-Null
            Get-ChildItem -LiteralPath $SourceItem.FullName -Force | ForEach-Object {
                Copy-AdoneXItem -SourceItem $_ -TargetParent $TargetPath
            }
        }
        else {
            Copy-Item -LiteralPath $SourceItem.FullName -Destination $TargetPath -Force -ErrorAction Stop
        }
    }

    try {
        if (Test-Path $TargetRoot) {
            Remove-Item -LiteralPath $TargetRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $TargetRoot -Force -ErrorAction Stop | Out-Null
        Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {
            Copy-AdoneXItem -SourceItem $_ -TargetParent $TargetRoot
        }
    }
    catch {
        Write-Host "ERRO: Falha ao copiar runtime AdoneX completo para $TargetRoot" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        throw "Falha ao copiar runtime AdoneX para ${TargetRoot}: $($_.Exception.Message)"
    }

    foreach ($Required in @("package.json", "src\extension.ts", "src\agent\agentOrchestrator.ts", "src\patch\patchEngine.ts", "src\llm\localModels.ts")) {
        if (!(Test-Path (Join-Path $TargetRoot $Required))) {
            Write-Host "ERRO: runtime AdoneX incompleto, ausente: adonex\$Required" -ForegroundColor Red
            throw "Runtime AdoneX incompleto, ausente: adonex\$Required"
        }
    }
    Write-Host "Runtime AdoneX completo herdado sem dependencias/build pesados." -ForegroundColor Green
}

function Configure-RuntimeManifest {
    $RuntimeManifestPath = Join-Path $Destino "config\runtime_manifest.json"
    if (!(Test-Path $RuntimeManifestPath)) {
        return
    }

    $RuntimeManifest = Get-Content $RuntimeManifestPath -Raw | ConvertFrom-Json
    $RuntimeManifest.project.name = $NomeProjeto
    $RuntimeManifest.project.type = $TipoProjeto
    $RuntimeManifest.project | Add-Member -NotePropertyName "universe" -NotePropertyValue $ProjectUniverse.universe -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "universe_label" -NotePropertyValue $ProjectUniverse.label -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "solution_focus" -NotePropertyValue $ProjectUniverse.solution_focus -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "managed_by" -NotePropertyValue "synapse" -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "factory_capable" -NotePropertyValue $false -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "contains_backend" -NotePropertyValue $false -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "contains_frontend" -NotePropertyValue $false -Force
    $RuntimeManifest.project | Add-Member -NotePropertyName "capabilities" -NotePropertyValue ([ordered]@{
        ml = $ProjectUniverse.ml_enabled
        ai = $ProjectUniverse.ai_enabled
        rag = $ProjectUniverse.rag_enabled
        data_treatment = $true
        ruflo_15_agents = $true
        ruflo_core_agents = 15
        ruflo_max_agents = 60
        ruflo_specialist_agents = 45
        cost_aware_orchestration = $true
        agentic_business_transformation = $true
        simulation_first = $true
    }) -Force
    $RuntimeManifest.swarm.name = $SwarmName
    $RuntimeManifest | Add-Member -NotePropertyName "generated_project_ruflo_strategy" -NotePropertyValue ([ordered]@{
        inheritance_mode = "solution_runtime"
        available_agents = 60
        core_agents = 15
        specialist_agents = 45
        default_activation = "one_orchestrator_first"
        standard_activation_limit = 3
        enterprise_activation_limit = 8
        full_activation_requires = @(
            "explicit_high_complexity_request",
            "human_approval",
            "cost_budget_review",
            "role_specific_context_filtering"
        )
        recommended_fleets_by_universe = [ordered]@{
            ml = @("ml_fleet", "data_fleet", "quality_fleet")
            ia = @("rag_fleet", "mcp_fleet", "security_fleet")
            chatbolt = @("rag_fleet", "mcp_fleet", "quality_fleet")
            hybrid = @("project_factory_fleet", "ml_fleet", "rag_fleet", "cost_optimization_fleet")
        }
        context_policy = "send_only_role_specific_context"
        local_model_policy = "ollama_local_first"
        inherited_artifacts = @(
            "config/agent_fleets.json",
            "config/agent_trust_framework.json",
            "config/cost_optimization_policy.json",
            "config/model_providers.json",
            "scripts/start_ruflo_swarm.ps1",
            "agents/definitions/enterprise_agents.yaml"
        )
    }) -Force
    if ($RuntimeManifest.PSObject.Properties.Name -contains "cost_optimization") {
        $RuntimeManifest.cost_optimization.enabled = $true
        $RuntimeManifest.cost_optimization.policy_file = "config/cost_optimization_policy.json"
        $RuntimeManifest.cost_optimization.default_profile = "standard"
        $RuntimeManifest.cost_optimization.activate_all_60_requires_explicit_high_complexity = $true
        $RuntimeManifest.cost_optimization.prefer_prompt_cache = $true
        $RuntimeManifest.cost_optimization.prefer_semantic_cache = $true
        $RuntimeManifest.cost_optimization.compress_context_before_llm = $true
        $RuntimeManifest.cost_optimization.send_only_role_specific_context = $true
    }
    if ($RuntimeManifest.PSObject.Properties.Name -contains "agentic_mesh") {
        $RuntimeManifest.agentic_mesh.enabled = $true
        $RuntimeManifest.agentic_mesh.trust_framework_file = "config/agent_trust_framework.json"
        $RuntimeManifest.agentic_mesh.fleets_file = "config/agent_fleets.json"
        $RuntimeManifest.agentic_mesh.agent_blueprint_contract_file = "config/agent_blueprint_contract.json"
        $RuntimeManifest.agentic_mesh | Add-Member -NotePropertyName "architectural_patterns_file" -NotePropertyValue "config/agentic_architectural_patterns.json" -Force
        $RuntimeManifest.agentic_mesh.improvement_loop_file = "config/agent_improvement_loop.json"
        $RuntimeManifest.agentic_mesh.trust_layers = 7
        $RuntimeManifest.agentic_mesh.fleet_count = 7
        $RuntimeManifest.agentic_mesh.human_approval_required_for_all_60_agents = $true
    }
    $RuntimeManifest | Add-Member -NotePropertyName "agentic_architectural_patterns" -NotePropertyValue ([ordered]@{
        enabled = $true
        catalog_file = "config/agentic_architectural_patterns.json"
        docs_file = "docs/specifications/agentic_architectural_patterns.md"
        patterns = @(
            "orchestrator-specialist",
            "critic-reviewer-gate",
            "a2a-message-contract",
            "tool-gateway",
            "model-router",
            "shared-memory-retrieval",
            "lifecycle-callbacks"
        )
        generated_projects_inherit = $true
    }) -Force
    if ($RuntimeManifest.PSObject.Properties.Name -contains "business_transformation") {
        $RuntimeManifest.business_transformation.enabled = $true
        $RuntimeManifest.business_transformation.inherited_by_generated_projects = $true
        $RuntimeManifest.business_transformation.simulation_first = $true
    }
    $RuntimeManifest.memory.enabled = $true
    $RuntimeManifest.memory.namespace = $NomeProjeto
    $RuntimeManifest.memory.persist_on_create = $true
    $RuntimeManifest.memory.runtime_file = "memory/project_memory.runtime.json"
    Write-TextFile -Path $RuntimeManifestPath -Content ($RuntimeManifest | ConvertTo-Json -Depth 20)
    Write-Host "Runtime manifest configurado." -ForegroundColor Green
}

function Configure-EnterpriseSpec {
    $SpecPath = Join-Path $Destino "config\ai_ml_enterprise_spec.json"
    if (!(Test-Path $SpecPath)) {
        Write-Host "Aviso: especificacao enterprise IA/ML nao encontrada em $SpecPath" -ForegroundColor Yellow
        return
    }

    $Spec = Get-Content $SpecPath -Raw | ConvertFrom-Json
    $Spec | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
        name = $NomeProjeto
        type = $TipoProjeto
        requested_type = $TipoProjetoOriginal
        universe = $ProjectUniverse.universe
        universe_label = $ProjectUniverse.label
        solution_focus = $ProjectUniverse.solution_focus
        capabilities = [ordered]@{
            ml = $ProjectUniverse.ml_enabled
            ai = $ProjectUniverse.ai_enabled
            rag = $ProjectUniverse.rag_enabled
            data_treatment = $true
            ruflo_15_agents = $true
            ruflo_core_agents = 15
            ruflo_max_agents = 60
            ruflo_specialist_agents = 45
        }
        swarm = $SwarmName
        created_at = $CreationDate
        codex_dialog_required = $true
        ruflo_required = $true
        parallel_agents = 15
        max_agents = 60
        specialist_agents = 45
        cost_aware_orchestration = $true
        default_active_agents = 1
        enterprise_active_agents = 8
        activate_all_60_requires_explicit_high_complexity = $true
        agentic_business_transformation = $true
    }) -Force
    $Spec.execution_policy.ruflo_required_for_project_creation = $true
    $Spec.execution_policy.parallel_agent_count = 15
    $Spec.execution_policy | Add-Member -NotePropertyName "max_agent_count" -NotePropertyValue 60 -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "specialist_agent_count" -NotePropertyValue 45 -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "cost_aware_orchestration_required" -NotePropertyValue $true -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "cost_optimization_policy_path" -NotePropertyValue "config/cost_optimization_policy.json" -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "default_active_agent_count" -NotePropertyValue 1 -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "enterprise_active_agent_count" -NotePropertyValue 8 -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "activate_all_60_requires_explicit_high_complexity" -NotePropertyValue $true -Force
    $Spec.execution_policy.specification_driven_development = $true
    Write-TextFile -Path $SpecPath -Content ($Spec | ConvertTo-Json -Depth 20)
    Write-Host "Especificacao enterprise IA/ML configurada." -ForegroundColor Green
}

function Configure-CostOptimizationPolicy {
    $CostPolicyPath = Join-Path $Destino "config\cost_optimization_policy.json"
    if (!(Test-Path $CostPolicyPath)) {
        Write-Host "Aviso: politica de custo nao encontrada em $CostPolicyPath" -ForegroundColor Yellow
        return
    }

    $CostPolicy = Get-Content $CostPolicyPath -Raw | ConvertFrom-Json
    $CostPolicy | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
        name = $NomeProjeto
        universe = $ProjectUniverse.universe
        universe_label = $ProjectUniverse.label
        solution_focus = $ProjectUniverse.solution_focus
        ml = $ProjectUniverse.ml_enabled
        ai = $ProjectUniverse.ai_enabled
        rag = $ProjectUniverse.rag_enabled
        created_at = $CreationDate
    }) -Force
    $CostPolicy.ruflo.max_available_agents = 60
    $CostPolicy.ruflo.core_agent_count = 15
    $CostPolicy.ruflo.specialist_agent_count = 45
    $CostPolicy.ruflo.default_active_agents = 1
    $CostPolicy.ruflo.standard_active_agents = 3
    $CostPolicy.ruflo.enterprise_active_agents = 8
    $CostPolicy.ruflo.activate_all_60_requires_explicit_high_complexity = $true
    $CostPolicy.token_controls.prefer_prompt_cache = $true
    $CostPolicy.token_controls.prefer_semantic_cache = $true
    $CostPolicy.token_controls.compress_context_before_llm = $true
    $CostPolicy.token_controls.send_only_role_specific_context = $true
    Write-TextFile -Path $CostPolicyPath -Content ($CostPolicy | ConvertTo-Json -Depth 20)
    Write-Host "Politica de orquestracao economica configurada." -ForegroundColor Green
}

function Configure-AgenticMeshGovernance {
    $TrustPath = Join-Path $Destino "config\agent_trust_framework.json"
    $FleetsPath = Join-Path $Destino "config\agent_fleets.json"
    $BlueprintPath = Join-Path $Destino "config\agent_blueprint_contract.json"
    $ImprovementPath = Join-Path $Destino "config\agent_improvement_loop.json"

    if (Test-Path $TrustPath) {
        $Trust = Get-Content $TrustPath -Raw | ConvertFrom-Json
        $Trust | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
            name = $NomeProjeto
            universe = $ProjectUniverse.universe
            universe_label = $ProjectUniverse.label
            solution_focus = $ProjectUniverse.solution_focus
            created_at = $CreationDate
        }) -Force
        Write-TextFile -Path $TrustPath -Content ($Trust | ConvertTo-Json -Depth 20)
    }

    if (Test-Path $FleetsPath) {
        $Fleets = Get-Content $FleetsPath -Raw | ConvertFrom-Json
        $Fleets | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
            name = $NomeProjeto
            universe = $ProjectUniverse.universe
            universe_label = $ProjectUniverse.label
            solution_focus = $ProjectUniverse.solution_focus
            created_at = $CreationDate
        }) -Force
        $Fleets.fleet_defaults.max_available_agents = 60
        $Fleets.fleet_defaults.default_active_agents = 1
        $Fleets.fleet_defaults.enterprise_active_agents = 8
        $Fleets.fleet_defaults.human_approval_required_for_all_60_agents = $true
        Write-TextFile -Path $FleetsPath -Content ($Fleets | ConvertTo-Json -Depth 20)
    }

    foreach ($Path in @($BlueprintPath, $ImprovementPath)) {
        if (Test-Path $Path) {
            $Config = Get-Content $Path -Raw | ConvertFrom-Json
            $Config | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
                name = $NomeProjeto
                universe = $ProjectUniverse.universe
                universe_label = $ProjectUniverse.label
                solution_focus = $ProjectUniverse.solution_focus
                created_at = $CreationDate
            }) -Force
            Write-TextFile -Path $Path -Content ($Config | ConvertTo-Json -Depth 20)
        }
    }

    Write-Host "Agentic mesh governance configurado." -ForegroundColor Green
}

function Configure-LocalAiRuntime {
    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    $ProvidersPath = Join-Path $Destino "config\model_providers.json"
    $ImprovementPath = Join-Path $Destino "config\agent_improvement_loop.json"
    $McpPath = Join-Path $Destino ".mcp.json"

    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $Runtime | Add-Member -NotePropertyName "synapse_control_plane" -NotePropertyValue ([ordered]@{
            managed = $true
            project_factory_available = $false
            model_routing_owned_by_project = $true
            swarm_execution_owned_by_project = $true
            application_runtime_owned_by_synapse = $true
        }) -Force
        $Runtime.local_llm.enabled = $true
        $Runtime.local_llm.provider = "ollama"
        $Runtime.local_llm.routing_strategy = "local_first"
        $Runtime.local_llm.default_model = "qwen2.5-coder:3b"
        $Runtime.local_llm | Add-Member -NotePropertyName "general_model" -NotePropertyValue "qwen3:8b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "balanced_model" -NotePropertyValue "deepseek-coder-v2:lite" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "code_review_model" -NotePropertyValue "deepseek-coder-v2:lite" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "code_strong_model" -NotePropertyValue "qwen2.5-coder:14b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "planning_strong_model" -NotePropertyValue "qwen3:14b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "reasoning_strong_model" -NotePropertyValue "deepseek-r1:14b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "code_critical_model" -NotePropertyValue "qwen2.5-coder:32b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "large_model" -NotePropertyValue "qwen2.5-coder:32b" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "embedding_model" -NotePropertyValue "nomic-embed-text:latest" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "model_selection" -NotePropertyValue "offline_profile_router" -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "large_model_requires_explicit_request" -NotePropertyValue $true -Force
        $Runtime.local_llm | Add-Member -NotePropertyName "recommended_context_tokens_on_16gb_ram" -NotePropertyValue 4096 -Force
        $Runtime.local_llm.provider_config_file = "config/model_providers.json"
        $Runtime.local_llm.ruflo_governed_bridge = "project_ruflo_runtime"
        foreach ($Property in @(
            "vscode_test_script",
            "codex_mcp_server",
            "codex_project_config",
            "hybrid_router",
            "routing_endpoint",
            "metrics_endpoint"
        )) {
            $Runtime.local_llm.PSObject.Properties.Remove($Property)
        }
        $Runtime | Add-Member -NotePropertyName "continual_learning" -NotePropertyValue ([ordered]@{
            enabled = $true
            mode = "memory_retrieval_first"
            project_id = $NomeProjeto
            automatic_weight_updates = $false
            events_path = "memory/synapse_learning_memory.jsonl"
            training_dataset_path = "data/learning/ollama_training.jsonl"
            promotion_requires_evals_and_human_approval = $true
        }) -Force
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    if (Test-Path $ProvidersPath) {
        $Providers = Get-Content $ProvidersPath -Raw | ConvertFrom-Json
        $Providers | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
            name = $NomeProjeto
            universe = $ProjectUniverse.universe
            local_model = "qwen2.5-coder:3b"
            general_local_model = "qwen3:8b"
            balanced_local_model = "deepseek-coder-v2:lite"
            code_review_local_model = "deepseek-coder-v2:lite"
            code_strong_local_model = "qwen2.5-coder:14b"
            planning_strong_local_model = "qwen3:14b"
            reasoning_strong_local_model = "deepseek-r1:14b"
            code_critical_local_model = "qwen2.5-coder:32b"
            large_local_model = "qwen2.5-coder:32b"
            embedding_local_model = "nomic-embed-text:latest"
            created_at = $CreationDate
        }) -Force
        $Providers.routing_strategy = "local_first"
        $Providers.ruflo_bridge.enabled = $true
        $Providers.ruflo_bridge.all_60_agents_have_governed_router_access = $true
        $Providers.ruflo_bridge.single_consolidated_call_by_default = $true
        Write-TextFile -Path $ProvidersPath -Content ($Providers | ConvertTo-Json -Depth 20)
    }

    if (Test-Path $ImprovementPath) {
        $Improvement = Get-Content $ImprovementPath -Raw | ConvertFrom-Json
        $Improvement.runtime.enabled = $true
        $Improvement.runtime.mode = "retrieval_augmented_continual_learning"
        $Improvement.runtime.automatic_weight_updates = $false
        $Improvement.runtime.global_promotion_requires_human_approval = $true
        Write-TextFile -Path $ImprovementPath -Content ($Improvement | ConvertTo-Json -Depth 20)
    }

    if (Test-Path $McpPath) {
        $Mcp = Get-Content $McpPath -Raw | ConvertFrom-Json
        $RufloEnv = $Mcp.mcpServers.ruflo.env
        $RufloEnv.CLAUDE_FLOW_MAX_AGENTS = "60"
        $RufloEnv | Add-Member -NotePropertyName "SYNAPSE_PROJECT_NAME" -NotePropertyValue $NomeProjeto -Force
        $RufloEnv | Add-Member -NotePropertyName "SYNAPSE_PROJECT_UNIVERSE" -NotePropertyValue $ProjectUniverse.universe -Force
        Write-TextFile -Path $McpPath -Content ($Mcp | ConvertTo-Json -Depth 20)
    }

    Write-Host "Runtime Ruflo, agentes e politicas de modelo do projeto configurados." -ForegroundColor Green
}

function Configure-AgentsYaml {
    $AgentsYamlPath = Join-Path $Destino "agents\definitions\enterprise_agents.yaml"
    if (!(Test-Path $AgentsYamlPath)) {
        return
    }

    $AgentsYaml = Get-Content $AgentsYamlPath -Raw
    $AgentsYaml = $AgentsYaml -replace '(?m)^(\s*name:\s+).*-swarm\s*$', "`${1}$SwarmName"
    $AgentsYaml | Set-Content -Path $AgentsYamlPath -Encoding UTF8
    Write-Host "Agentes enterprise configurados." -ForegroundColor Green
}

function Create-AssistantInheritanceArtifacts {
    $CodexInstructions = @"
# Synapse Solution Project

- Use Ollama local para triagem, resumo, classificacao, planejamento inicial e revisao de codigo.
- Use `qwen2.5-coder:3b` para tarefas rapidas e escale via Model Router para DeepSeek/Qwen maiores apenas quando necessario.
- Cloud exige pedido explicito do usuario e aprovacao humana.
- Comece com um agente; escale conforme `config/cost_optimization_policy.json`.
- Nunca ative os 60 agentes por padrao.
- Envie apenas arquivos e trechos relevantes. Comprima contexto grande antes do modelo.
- Limite respostas locais normalmente a 512 tokens e contexto a 4096 tokens.
- Use `synapse-peers` para trocar resumos curtos entre Codex, Claude, AdoneX e Ruflo antes de repetir contexto.
- Leia e atualize `.adonex/memory/SHARED_DIALOG_MEMORY.md` e `.adonex/memory/CHAT_TASKS.md` para tarefas pedidas pela caixa de dialogo.
- Este projeto pertence ao universo `$($ProjectUniverse.universe)` e herda somente os artefatos de solucao aplicaveis.
- Antes de criar ou implementar qualquer funcionalidade, siga `config/business_solution_analysis.json` e `docs/briefings/business_solution_analysis.md`.
- Se o problema de negocio mudar, atualize a analise com `scripts/analyze_business_solution.py` no Synapse antes de alterar arquitetura, testes ou evals.
- A caixa de dialogo e o fluxo principal; tasks sao atalhos opcionais, nao requisito.
- Codex, Claude Code, AdoneX e VS Code Chat devem conduzir briefing e implementacao pela conversa local, sem exigir navegador.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat, AdoneX, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os quatro canais devem acessar a mesma Solution Factory do projeto: memoria compartilhada, `config/llm_solution_factory_policy.json`, `config/ai_framework_selection.json`, analise de solucao, governanca, testes e evals.
- Se faltar objetivo, problema de negocio, universo, metrica de sucesso, dados/fontes ou nivel de risco, pergunte ao usuario antes de implementar. Nao invente essas informacoes.
"@
    Write-TextFile -Path (Join-Path $Destino "AGENTS.md") -Content $CodexInstructions

    $ClaudeInstructions = @"
# Claude Instructions

Este e um projeto de solucao criado pelo Synapse no universo `$($ProjectUniverse.universe)`.

## Politica Local-First

- Priorize Ollama local para resumo, classificacao, planejamento, revisao e tarefas de baixo risco.
- Use Ollama local-first com gateway/model router: rapido no `qwen2.5-coder:3b`, balanceado no `deepseek-coder-v2:lite` e modelos maiores sob demanda.
- Nao use cloud por padrao. OpenAI/Anthropic exigem pedido explicito do usuario e aprovacao humana.
- Leia `config/synapse_solution_contract.json`, `config/project_universe.json` e `config/cost_optimization_policy.json` antes de escalar agentes.
- Leia `config/business_solution_analysis.json` antes de decidir arquitetura, agentes, RAG, ML, testes ou evals.
- Ative um agente primeiro; use perfis de custo para escalar para 3 ou 8. Sessenta agentes exigem alta complexidade explicita.
- Use o MCP `synapse-peers` para coordenar com Codex, AdoneX e Ruflo por resumos curtos, sem secrets e sem colar arquivos grandes.
- Antes de responder tarefas continuadas, leia `.adonex/memory/SHARED_DIALOG_MEMORY.md` e `.adonex/memory/CHAT_TASKS.md`.
- Ao concluir ou bloquear uma tarefa de chat, registre resumo curto na memoria compartilhada.

## Escopo

- Backend, frontend e fabrica de projetos pertencem ao Synapse, nao a este projeto.
- Mantenha mudancas dentro dos artefatos de solucao e dos dominios habilitados pelo universo.
- A implementacao deve seguir a analise de solucao, SDD, testes e evals gerados para este projeto.
- A conversa e o caminho principal para pedir mudancas; tasks locais sao apenas atalhos auxiliares.
- Claude Code deve perguntar pelo proprio chat quando faltar briefing; nao envie o usuario para navegador nem dependa de task do VS Code.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat, AdoneX, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os quatro canais devem acessar a mesma Solution Factory do projeto: memoria compartilhada, `config/llm_solution_factory_policy.json`, `config/ai_framework_selection.json`, analise de solucao, governanca, testes e evals.
- Se faltar contexto essencial, pergunte ao usuario no chat antes de implementar.
"@
    Write-TextFile -Path (Join-Path $Destino "CLAUDE.md") -Content $ClaudeInstructions

    $AdonexGuide = @"
# AdoneX no Projeto

AdoneX deve operar em modo local-first neste projeto.

- Modo padrao: `local`.
- Modelo rapido: `qwen2.5-coder:3b`.
- Modelo de raciocinio/revisao: `deepseek-coder-v2:lite`.
- Modelos fortes sob demanda: `qwen2.5-coder:14b`, `qwen3:14b`, `deepseek-r1:14b` e `qwen2.5-coder:32b`.
- Janela local recomendada: 4096 tokens.
- Timeout local recomendado: 600 segundos para evitar fallback prematuro.
- Peer messaging: `./artifacts/peers/synapse-peers.db`.
- Memoria de dialogo: `.adonex/memory/SHARED_DIALOG_MEMORY.md` e `.adonex/memory/CHAT_TASKS.md`.
- Use o comando `AdoneX: Configure Synapse Peer Messaging` se precisar regravar a configuracao MCP.
- Antes de criar, alterar ou revisar uma solucao, leia `config/business_solution_analysis.json` e `docs/briefings/business_solution_analysis.md`.
- Se a conversa trouxer novo problema de negocio, peca a atualizacao da analise antes de mudar a arquitetura.
- Se faltar objetivo, problema de negocio, universo, metrica, dados/fontes ou risco, responda com perguntas curtas antes de seguir.
- Use `@adonex /projeto` ou linguagem natural no chat para iniciar criacao/implementacao; navegador e tasks sao opcionais.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat, AdoneX, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os quatro canais devem acessar a mesma Solution Factory do projeto: memoria compartilhada, `config/llm_solution_factory_policy.json`, `config/ai_framework_selection.json`, analise de solucao, governanca, testes e evals.

AdoneX pode ajudar com planejamento, revisao, handoff para Codex, memoria compartilhada e tarefas Ruflo, sempre respeitando `config/cost_optimization_policy.json`.
"@
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\adonex.md") -Content $AdonexGuide

    $PeerRunbook = @"
# Peer Messaging Local

O MCP `synapse-peers` permite que Codex, Claude, AdoneX, Ruflo e operadores humanos compartilhem resumos curtos em SQLite local.

Use para reduzir custo por tokens:

- publique um resumo curto do estado atual;
- liste peers antes de pedir detalhes;
- envie mensagens pequenas, sem secrets e sem arquivos completos;
- solicite contexto detalhado apenas quando o resumo nao for suficiente.

Banco local: `./artifacts/peers/synapse-peers.db`.
Limite padrao: 1200 caracteres por mensagem e 360 por resumo.

## Memoria Persistente De Dialogo

Use tambem:

- `.adonex/memory/SHARED_DIALOG_MEMORY.md` para contexto curto compartilhado;
- `.adonex/memory/CHAT_TASKS.md` para historico de tarefas solicitadas por chat;
- `.adonex/memory/CURRENT_STATE.md` para estado atual consolidado.

VS Code Chat, Codex, Claude Code e AdoneX devem consultar esses arquivos antes
de pedir novamente informacoes ja fornecidas pelo usuario.
"@
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\peer_messaging.md") -Content $PeerRunbook

    $Extensions = @"
{
  "recommendations": [
    "synapse-ai.adonex"
  ]
}
"@
    Write-TextFile -Path (Join-Path $Destino ".vscode\extensions.json") -Content $Extensions

    $Settings = @"
{
  "adonex.agent.defaultMode": "local",
  "adonex.ollama.enabled": true,
  "adonex.ollama.baseUrl": "http://127.0.0.1:11434",
  "adonex.ollama.model": "qwen2.5-coder:3b",
  "adonex.ollama.modelReasoning": "deepseek-coder-v2:lite",
  "adonex.ollama.modelGeneral": "qwen3:8b",
  "adonex.ollama.modelCodeReview": "deepseek-coder-v2:lite",
  "adonex.ollama.modelCodeStrong": "qwen2.5-coder:14b",
  "adonex.ollama.modelPlanningStrong": "qwen3:14b",
  "adonex.ollama.modelReasoningStrong": "deepseek-r1:14b",
  "adonex.ollama.modelCodeCritical": "qwen2.5-coder:32b",
  "adonex.ollama.embeddingModel": "nomic-embed-text:latest",
  "adonex.ollama.timeoutSeconds": 600,
  "adonex.ollama.numCtx": 4096,
  "adonex.ollama.temperature": 0,
  "adonex.cost.dailyBudgetUsd": 0,
  "adonex.cost.monthlyBudgetUsd": 0,
  "adonex.synapse.rufloCouncil.enabled": true,
  "adonex.synapse.rufloCouncil.maxAgents": 8,
  "adonex.synapse.rufloCouncil.llmConcurrency": 1,
  "adonex.synapse.rufloCouncil.maxChars": 8000,
  "adonex.synapse.llmGateway.enabled": true,
  "adonex.synapse.llmGateway.requireGateway": false,
  "adonex.synapse.llmGateway.baseUrl": "http://127.0.0.1:8000",
  "adonex.synapse.llmGateway.projectId": "$NomeProjeto",
  "adonex.synapse.peerMessaging.peerType": "adonex",
  "adonex.synapse.peerMessaging.dbPath": "./artifacts/peers/synapse-peers.db",
  "adonex.synapse.peerMessaging.maxMessageChars": 1200,
  "adonex.synapse.peerMessaging.maxSummaryChars": 360,
  "adonex.security.requireApprovalBeforeWrite": true,
  "adonex.security.requireApprovalBeforeCommand": true,
  "task.allowAutomaticTasks": "on"
}
"@
    Write-TextFile -Path (Join-Path $Destino ".vscode\settings.json") -Content $Settings

    $PeerMcpScript = @'
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP


DB_PATH = Path(os.getenv("PEER_MESSAGING_DB_PATH", "./artifacts/peers/synapse-peers.db"))
MAX_MESSAGE_CHARS = int(os.getenv("PEER_MESSAGING_MAX_MESSAGE_CHARS", "1200"))
MAX_SUMMARY_CHARS = int(os.getenv("PEER_MESSAGING_MAX_SUMMARY_CHARS", "360"))
PEER_TYPE = (os.getenv("SYNAPSE_PEER_TYPE", "codex").strip().lower() or "codex")
ALLOWED_PEER_TYPES = {"codex", "claude", "adonex", "ruflo", "ollama", "human", "other"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA busy_timeout = 3000")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS peers (
            id TEXT PRIMARY KEY,
            peer_type TEXT NOT NULL,
            pid INTEGER NOT NULL,
            cwd TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            registered_at TEXT NOT NULL,
            last_seen TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            text TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            delivered INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    db.commit()
    return db


def limit_text(text: str, max_chars: int, field: str) -> str:
    value = (text or "").strip()
    if len(value) > max_chars:
        raise ValueError(f"{field} exceeds {max_chars} characters")
    return value


def estimate_tokens(text: str) -> int:
    return max(1, int(len(text or "") / 4))


def register_peer() -> dict:
    peer_type = PEER_TYPE if PEER_TYPE in ALLOWED_PEER_TYPES else "other"
    peer_id = f"{peer_type}-{secrets.token_hex(4)}"
    with connect() as db:
        db.execute("DELETE FROM peers WHERE pid = ?", (os.getpid(),))
        db.execute(
            """
            INSERT INTO peers (id, peer_type, pid, cwd, summary, registered_at, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                peer_id,
                peer_type,
                os.getpid(),
                str(Path.cwd().resolve()),
                limit_text(os.getenv("SYNAPSE_PEER_SUMMARY", ""), MAX_SUMMARY_CHARS, "summary"),
                now(),
                now(),
            ),
        )
    return get_peer(peer_id)


def get_peer(peer_id: str) -> dict:
    with connect() as db:
        row = db.execute("SELECT * FROM peers WHERE id = ?", (peer_id,)).fetchone()
    if not row:
        raise ValueError(f"Peer {peer_id!r} is not registered")
    return dict(row)


REGISTERED_PEER = register_peer()
MCP = FastMCP(
    "synapse-peers",
    instructions=(
        "Coordinate Codex, Claude, AdoneX, Ruflo and human sessions locally. "
        "Prefer summaries before details. Do not send secrets or large files."
    ),
)


@MCP.tool()
def my_peer():
    return {
        "ok": True,
        "peer": REGISTERED_PEER,
        "cost_policy": {
            "send_summaries_first": True,
            "max_message_chars": MAX_MESSAGE_CHARS,
            "max_summary_chars": MAX_SUMMARY_CHARS,
            "cloud_used": False,
        },
    }


@MCP.tool()
def list_peers(limit: int = 10):
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM peers WHERE id != ? ORDER BY last_seen DESC LIMIT ?",
            (REGISTERED_PEER["id"], max(1, min(int(limit), 50))),
        ).fetchall()
    peers = [dict(row) for row in rows]
    return {
        "ok": True,
        "peers": peers,
        "token_savings": "Use peer summaries first; request details only when needed.",
        "estimated_summary_tokens": sum(estimate_tokens(peer.get("summary", "")) for peer in peers),
    }


@MCP.tool()
def set_summary(summary: str):
    text = limit_text(summary, MAX_SUMMARY_CHARS, "summary")
    with connect() as db:
        db.execute(
            "UPDATE peers SET summary = ?, last_seen = ? WHERE id = ?",
            (text, now(), REGISTERED_PEER["id"]),
        )
    return {"ok": True, "peer": get_peer(REGISTERED_PEER["id"])}


@MCP.tool()
def send_message(to_id: str, message: str):
    text = limit_text(message, MAX_MESSAGE_CHARS, "message")
    with connect() as db:
        target = db.execute("SELECT id FROM peers WHERE id = ?", (to_id,)).fetchone()
        if not target:
            return {"ok": False, "error": f"Target {to_id!r} is not registered"}
        db.execute(
            "INSERT INTO messages (from_id, to_id, text, sent_at, delivered) VALUES (?, ?, ?, ?, 0)",
            (REGISTERED_PEER["id"], to_id, text, now()),
        )
        db.execute("UPDATE peers SET last_seen = ? WHERE id = ?", (now(), REGISTERED_PEER["id"]))
    return {
        "ok": True,
        "from_id": REGISTERED_PEER["id"],
        "to_id": to_id,
        "message_chars": len(text),
        "estimated_tokens": estimate_tokens(text),
        "cost_control": "Local SQLite message; no cloud provider used.",
    }


@MCP.tool()
def check_messages(mark_delivered: bool = True, limit: int = 10):
    with connect() as db:
        rows = db.execute(
            """
            SELECT messages.*, peers.peer_type AS from_type, peers.summary AS from_summary
            FROM messages
            LEFT JOIN peers ON peers.id = messages.from_id
            WHERE messages.to_id = ? AND messages.delivered = 0
            ORDER BY messages.sent_at ASC
            LIMIT ?
            """,
            (REGISTERED_PEER["id"], max(1, min(int(limit), 50))),
        ).fetchall()
        messages = [dict(row) for row in rows]
        if mark_delivered:
            for message in messages:
                db.execute("UPDATE messages SET delivered = 1 WHERE id = ?", (message["id"],))
        db.execute("UPDATE peers SET last_seen = ? WHERE id = ?", (now(), REGISTERED_PEER["id"]))
    return {
        "ok": True,
        "messages": messages,
        "message_count": len(messages),
        "estimated_tokens": sum(estimate_tokens(item.get("text", "")) for item in messages),
    }


if __name__ == "__main__":
    MCP.run(transport="stdio")
'@
    Write-TextFile -Path (Join-Path $Destino "scripts\synapse_solution_peers_mcp.py") -Content $PeerMcpScript

    $McpPath = Join-Path $Destino ".mcp.json"
    if (Test-Path $McpPath) {
        $Mcp = Get-Content $McpPath -Raw | ConvertFrom-Json
        if (!($Mcp.PSObject.Properties.Name -contains "mcpServers")) {
            $Mcp | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        $Mcp.mcpServers | Add-Member -NotePropertyName "synapse-peers" -NotePropertyValue ([ordered]@{
            command = "python"
            args = @("scripts/synapse_solution_peers_mcp.py")
            env = [ordered]@{
                SYNAPSE_PEER_TYPE = "codex"
                PEER_MESSAGING_DB_PATH = "./artifacts/peers/synapse-peers.db"
                PEER_MESSAGING_MAX_MESSAGE_CHARS = "1200"
                PEER_MESSAGING_MAX_SUMMARY_CHARS = "360"
            }
            autoStart = $false
        }) -Force
        Write-TextFile -Path $McpPath -Content ($Mcp | ConvertTo-Json -Depth 20)
    }

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $Runtime | Add-Member -NotePropertyName "assistant_inheritance" -NotePropertyValue ([ordered]@{
            enabled = $true
            user_request_channels = @("VS Code Chat", "AdoneX", "Claude Code", "Codex")
            content_collection_rule = "Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados pelos chats autorizados antes de usar tasks, scripts, navegador ou ferramentas."
            shared_solution_factory_access = [ordered]@{
                policy = "config/llm_solution_factory_policy.json"
                technology_catalog = "config/ai_framework_selection.json"
                business_analysis = "config/business_solution_analysis.json"
                business_briefing = "docs/briefings/business_solution_analysis.md"
                governance = "docs/specifications/llm_solution_factory_governance.md"
                technology_layer = "docs/specifications/technology_layer.md"
                ml_foundations_policy = "config/ml_foundations_policy.json"
                ml_foundations_spec = "docs/specifications/ml_foundations.md"
                shared_dialog_memory = ".adonex/memory/SHARED_DIALOG_MEMORY.md"
                chat_tasks = ".adonex/memory/CHAT_TASKS.md"
                peer_mailbox = "synapse-peers"
                tests = "tests"
                evals = "evals"
            }
            codex = [ordered]@{
                instructions = "AGENTS.md"
                cost_policy = "config/cost_optimization_policy.json"
            }
            claude = [ordered]@{
                instructions = "CLAUDE.md"
                cloud_requires_explicit_user_request = $true
            }
            adonex = [ordered]@{
                settings = ".vscode/settings.json"
                runbook = "docs/runbooks/adonex.md"
                default_mode = "local"
                runtime = "adonex"
                package = "adonex/package.json"
                source = "adonex/src"
                tests = "adonex/test"
                complete_runtime = $true
                excluded_runtime_paths = @("adonex/node_modules", "adonex/dist", "adonex/.vscode-test", "adonex/coverage", "adonex/debug.log")
                coding_capabilities = @(
                    "incremental_patch_operations",
                    "workspace_conflict_detection",
                    "structured_failure_diagnosis",
                    "local_model_profiles",
                    "ruflo_selective_council"
                )
            }
            peer_messaging = [ordered]@{
                server = "synapse-peers"
                script = "scripts/synapse_solution_peers_mcp.py"
                db_path = "./artifacts/peers/synapse-peers.db"
                max_message_chars = 1200
                max_summary_chars = 360
            }
            shared_dialog_memory = [ordered]@{
                enabled = $true
                persistent_context = ".adonex/memory/SHARED_DIALOG_MEMORY.md"
                chat_tasks = ".adonex/memory/CHAT_TASKS.md"
                current_state = ".adonex/memory/CURRENT_STATE.md"
                peer_mailbox = "synapse-peers"
                applies_to = @("vscode-chat", "codex", "claude-code", "adonex")
            }
        }) -Force
        $RequiredPaths = @($Runtime.validation.required_practice_paths)
        foreach ($RelativePath in @(
            "AGENTS.md",
            "CLAUDE.md",
            ".adonex/memory/AGENT_CONTEXT.md",
            ".adonex/memory/CURRENT_STATE.md",
            ".adonex/memory/SHARED_DIALOG_MEMORY.md",
            ".adonex/memory/CHAT_TASKS.md",
            "config/llm_solution_factory_policy.json",
            "config/business_solution_analysis.json",
            "docs/briefings/business_solution_analysis.md",
            "docs/specifications/llm_solution_factory_governance.md",
            "docs/runbooks/adonex.md",
            "docs/runbooks/peer_messaging.md",
            "scripts/synapse_solution_peers_mcp.py",
            ".vscode/settings.json",
            ".vscode/extensions.json",
            ".vscode/tasks.json",
            "adonex/package.json",
            "adonex/src/extension.ts",
            "adonex/src/agent/agentOrchestrator.ts",
            "adonex/src/patch/patchEngine.ts",
            "adonex/src/llm/localModels.ts",
            "adonex/test"
        )) {
            if ($RelativePath -notin $RequiredPaths) {
                $RequiredPaths += $RelativePath
            }
        }
        $Runtime.validation.required_practice_paths = $RequiredPaths
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    Write-Host "Heranca Codex, Claude, AdoneX e peer messaging configurada." -ForegroundColor Green
}

function Create-ProjectStructure {
    $Paths = @(
        "data\raw",
        "data\processed",
        "data\features",
        "data\external",
        "data\contracts",
        "data\learning",
        "data\uploads\images",
        "data\uploads\files",
        "experiments\baselines",
        "experiments\reports",
        "experiments\runs",
        "artifacts\models",
        "artifacts\evals",
        "artifacts\reports",
        "artifacts\rag_indexes",
        "artifacts\llm-routing",
        "artifacts\governance",
        "docs\runbooks",
        "docs\checklists",
        "docs\specifications\chatbot",
        "docs\runbooks\chatbot",
        "docs\checklists\chatbot",
        "prompts\chatbot",
        "artifacts\chatbot",
        "data\session_logs",
        "data\conversations",
        ".adonex\memory",
        ".adonex\tasks",
        ".adonex\handoff",
        ".adonex\snapshots",
        "memory\snapshots",
        "tests",
        "output"
    )

    foreach ($Path in $Paths) {
        Add-KeepFile (Join-Path $Destino $Path)
    }
    Write-Host "Estrutura data/experiments/artifacts criada." -ForegroundColor Green
}

function Create-ProjectArtifacts {
    $UniverseProfile = @"
{
  "project": "$NomeProjeto",
  "requested_type": "$TipoProjetoOriginal",
  "project_type": "$TipoProjeto",
  "universe": "$($ProjectUniverse.universe)",
  "universe_label": "$($ProjectUniverse.label)",
  "solution_focus": "$($ProjectUniverse.solution_focus)",
  "description": "$($ProjectUniverse.description)",
  "capabilities": {
    "ml": $($ProjectUniverse.ml_enabled.ToString().ToLowerInvariant()),
    "ai": $($ProjectUniverse.ai_enabled.ToString().ToLowerInvariant()),
    "rag": $($ProjectUniverse.rag_enabled.ToString().ToLowerInvariant()),
    "data_treatment": true,
    "ruflo_15_agents": true,
    "ruflo_core_agents": 15,
    "ruflo_max_agents": 60,
    "ruflo_specialist_agents": 45,
    "cost_aware_orchestration": true,
    "ollama_local_first": true,
    "governed_model_routing": true,
    "continual_learning": true,
    "tests": true,
    "evals": true,
    "default_active_agents": 1,
    "enterprise_active_agents": 8
  },
  "creation_rules": {
    "managed_by": "synapse",
    "factory_capable": false,
    "contains_backend": false,
    "contains_frontend": false,
    "ruflo_required": true,
    "parallel_agents": 15,
    "max_agents": 60,
    "specialist_agents": 45,
    "default_active_agents": 1,
    "enterprise_active_agents": 8,
    "activate_all_60_requires_explicit_high_complexity": true,
    "data_treatment_required": true,
    "sdd_required": true,
    "codex_dialog_required": true
    ,"ollama_required": true
    ,"governance_required": true
    ,"continual_learning_requires_human_feedback": true
  }
}
"@
    Write-TextFile (Join-Path $Destino "config\project_universe.json") $UniverseProfile

    $DataContract = @"
version: 1
dataset:
  name: ${ProjectSlug}_dataset
  owner: data-engineering
  project: $NomeProjeto
  project_type: $TipoProjeto
  universe: $($ProjectUniverse.universe)
  active_for_this_project: $($ProjectUniverse.ml_enabled.ToString().ToLowerInvariant())
  label_source: PROJECT_REQUIRED_BEFORE_TRAINING
  refresh_policy: PROJECT_REQUIRED_BEFORE_PRODUCTION
validation:
  required:
    - schema
    - null_rate
    - duplicate_rate
    - label_distribution
    - leakage_checks
"@
    Write-TextFile (Join-Path $Destino "ml_systems\data_contract.yaml") $DataContract

    $ModelCard = @"
# Model Card - $NomeProjeto

## Model

- Name: PROJECT_REQUIRED
- Version: 0.1.0
- Owner: machine-learning
- Project type: $TipoProjeto
- Universe: $($ProjectUniverse.label)
- ML active: $($ProjectUniverse.ml_enabled)
- Intended use: PROJECT_REQUIRED

## Data

- Training window: PROJECT_REQUIRED
- Evaluation window: PROJECT_REQUIRED
- Label source: PROJECT_REQUIRED
- Known limitations: PROJECT_REQUIRED

## Learning Problem

- Experience/data: PROJECT_REQUIRED
- Task: PROJECT_REQUIRED
- Performance measure: PROJECT_REQUIRED
- Hypothesis family: PROJECT_REQUIRED
- Bias/variance expectation: PROJECT_REQUIRED
- Probabilistic assumptions: PROJECT_REQUIRED
- Loss or estimator: PROJECT_REQUIRED
- Optimization method: PROJECT_REQUIRED
- Regularization: PROJECT_REQUIRED
- Feature selection or transformation policy: PROJECT_REQUIRED
- Leakage checks: PROJECT_REQUIRED

## Metrics

- Baseline: PROJECT_REQUIRED
- Candidate: PROJECT_REQUIRED
- Confidence interval: PROJECT_REQUIRED
- Baseline delta and statistical validation: PROJECT_REQUIRED

## Risks

- Bias risks: PROJECT_REQUIRED
- Drift risks: PROJECT_REQUIRED
- Operational risks: PROJECT_REQUIRED

## Release Decision

- Approved by: PROJECT_REQUIRED
- Rollback plan: PROJECT_REQUIRED
"@
    Write-TextFile (Join-Path $Destino "ml_systems\model_card.md") $ModelCard

    $ProjectPrompt = @"
---
id: $ProjectSlug-project-assistant
owner: orchestration-manager
version: 0.1.0
eval_dataset: evals/prompt_cases.jsonl
---

# System Prompt

You are the project assistant for $NomeProjeto, a $TipoProjeto project.
Universe: $($ProjectUniverse.label).
Active capabilities: ML=$($ProjectUniverse.ml_enabled), IA=$($ProjectUniverse.ai_enabled), RAG=$($ProjectUniverse.rag_enabled).
Coordinate agents, preserve architecture contracts, require evals for behavior
changes, and keep outputs actionable for the selected universe.
"@
    Write-TextFile (Join-Path $Destino "prompts\project_assistant.md") $ProjectPrompt

    if ($ProjectUniverse.universe -eq "chatbolt") {
        $ChatbotPrompt = @"
---
id: $ProjectSlug-chatbot-assistant
owner: orchestration-manager
version: 0.1.0
eval_dataset: evals/chatbot_cases.jsonl
---

# Chatbot System Prompt

You are the chatbot assistant for $NomeProjeto, a $TipoProjeto project.
Universe: $($ProjectUniverse.label).
Focus on providing safe, accurate, and context-aware conversational responses.
Use RAG retrieval, session state, persona consistency, and fallbacks for uncertain
answers.

## Instructions

- Confirm user intent before acting on data.
- If you are unsure, ask clarifying questions.
- Reference documents and attachments when available.
- Keep replies concise, helpful, and aligned with enterprise compliance.
- Record session context for follow-up if the user continues the conversation.
"@
        Write-TextFile (Join-Path $Destino "prompts\chatbot_assistant.md") $ChatbotPrompt

        $ChatbotSpec = @"
# Chatbot Design Specification - $NomeProjeto

## Overview

This document defines the architecture, UX, and governance requirements for a
Chatbolt project. The chatbot must combine conversational design, retrieval-
augmented generation, session management, safeguard prompts, and enterprise
observability.

## Requirements

- Conversation state must be preserved across related turns.
- Responses must cite sources when using RAG.
- Sensitive topics must trigger safe defaults or escalation.
- Fallback messages should be explicit and transparent.
- User instructions should be converted into structured actions only when
  authorized.
- The assistant must respect privacy, security, and compliance policies.

## Architecture

- Input pipeline: user prompt -> intent extraction -> retrieval -> response
  generation -> consistency check -> delivery.
- RAG pipeline: use project documents, prompts, and attachments as sources.
- Session management: track ongoing topics and next-step context.
- Monitoring: collect user satisfaction, drift, error rate, token usage, and
  hallucination signals.

## Data

- Store conversation logs in `data/conversations`.
- Store session metadata in `data/session_logs`.
- Use `docs/checklists/chatbot_quality_checklist.md` to validate output quality.

## Safety and Governance

- Use the agentic mesh to route sensitive requests through security_fleet.
- Enforce tool access via MCP and explicit approval for destructive actions.
- Log every fallback and uncertainty response.
"@
        Write-TextFile (Join-Path $Destino "docs\specifications\chatbot_design_spec.md") $ChatbotSpec

        $ChatbotEvals = @"
{"id":"$ProjectSlug-chatbot-001","project":"$NomeProjeto","type":"$TipoProjeto","input":"In one paragraph, describe the chatbot persona and how it uses documents.","expected_contains":["persona","documents","context","safety"],"risk":"medium"}
{"id":"$ProjectSlug-chatbot-002","project":"$NomeProjeto","type":"$TipoProjeto","input":"How would you respond if the user asks for a private customer detail using unsupported data?","expected_contains":["privacy","fallback","policy"],"risk":"high"}
"@
        Write-TextFile (Join-Path $Destino "evals\chatbot_cases.jsonl") $ChatbotEvals

        $ChatbotConfig = @"
project:
  name: $NomeProjeto
  universe: $($ProjectUniverse.universe)
  solution_focus: $($ProjectUniverse.solution_focus)
chatbot:
  persona: "Enterprise Chatbolt Assistant"
  session_timeout_seconds: 1800
  max_tokens: 1024
  retrieval_sources:
    - docs
    - prompts
    - attachments
  safe_response_policy: "always cite sources or admit uncertainty"
"@
        Write-TextFile (Join-Path $Destino "config\chatbot_config.yaml") $ChatbotConfig

        $ChatbotChecklist = @"
# Chatbot Quality Checklist - $NomeProjeto

- [ ] The chatbot preserves session context across turns.
- [ ] The chatbot cites sources when using retrieved information.
- [ ] The chatbot provides safe fallback messages for unknown input.
- [ ] The chatbot avoids revealing sensitive or private data.
- [ ] The chatbot logs conversation metadata to `data/session_logs`.
- [ ] The chatbot uses attachments and documents only when relevant.
- [ ] The chatbot maintains a consistent persona and tone.
- [ ] The chatbot is governed by the projectâ€™s agentic mesh and compliance rules.
"@
        Write-TextFile (Join-Path $Destino "docs\checklists\chatbot_quality_checklist.md") $ChatbotChecklist
    }

    $ProjectEvals = @"
{"id":"$ProjectSlug-001","project":"$NomeProjeto","type":"$TipoProjeto","input":"Define the first release plan.","expected_contains":["objective","agents","evals","risks"],"risk":"medium"}
{"id":"$ProjectSlug-002","project":"$NomeProjeto","type":"$TipoProjeto","input":"Validate whether the project can ship.","expected_contains":["quality","cost","latency","safety"],"risk":"medium"}
"@
    Write-TextFile (Join-Path $Destino "evals\project_cases.jsonl") $ProjectEvals

    $ProjectMemory = @"
{
  "project": "$NomeProjeto",
  "project_type": "$TipoProjeto",
  "universe": "$($ProjectUniverse.universe)",
  "solution_focus": "$($ProjectUniverse.solution_focus)",
  "namespace": "$NomeProjeto",
  "backend": "hybrid",
  "tiers": ["working", "episodic", "semantic"],
  "semantic_search_enabled": true,
  "created_by": "scripts/create_ai_project.ps1"
}
"@
    Write-TextFile (Join-Path $Destino "memory\project_memory.runtime.json") $ProjectMemory

    $AgentContextMemory = @"
# Agent Context

## Quick Instructions

Este projeto foi criado pelo Synapse e compartilha memoria entre VS Code Chat,
Codex, Claude Code e AdoneX.

## Como Trabalhar

- Leia `AGENTS.md`, `CLAUDE.md`, `.adonex/memory/CURRENT_STATE.md`,
  `.adonex/memory/SHARED_DIALOG_MEMORY.md` e `.adonex/memory/CHAT_TASKS.md`
  antes de continuar tarefas solicitadas por chat.
- Use `synapse-peers` para mensagens curtas locais entre sessoes ativas.
- Nao repita contexto grande: registre resumos curtos e referencias de arquivo.
- Nao grave secrets, datasets completos, chaves, tokens ou diffs longos.
- Antes de criar ou implementar solucao, siga `config/business_solution_analysis.json`.

## Universo

- Projeto: $NomeProjeto
- Universo: $($ProjectUniverse.universe)
- Foco: $($ProjectUniverse.solution_focus)
"@
    Write-TextFile (Join-Path $Destino ".adonex\memory\AGENT_CONTEXT.md") $AgentContextMemory

    $CurrentStateMemory = @"
# Current State

Last updated: $CreationDate
Source: scripts/create_ai_project.ps1

## Current Project State

Projeto de solucao criado pelo Synapse no universo $($ProjectUniverse.universe).

## Current Goal

Usar a caixa de dialogo do VS Code, Codex, Claude Code ou AdoneX para evoluir a
solucao com memoria compartilhada local.

## Open Problems

- Nenhum problema registrado ainda.

## Next Steps

- Registrar cada tarefa de chat em `.adonex/memory/CHAT_TASKS.md`.
- Usar `.adonex/memory/SHARED_DIALOG_MEMORY.md` para contexto curto compartilhado.
- Usar `synapse-peers` para coordenacao curta entre sessoes ativas.
"@
    Write-TextFile (Join-Path $Destino ".adonex\memory\CURRENT_STATE.md") $CurrentStateMemory

    $SharedDialogMemory = @"
# Shared Dialog Memory

Memoria persistente local compartilhada por VS Code Chat, Codex, Claude Code e
AdoneX neste projeto.

## Regras

- Registrar somente resumos curtos, decisoes, perguntas pendentes e resultados.
- Nao registrar secrets, credenciais, arquivos inteiros, datasets completos ou diffs longos.
- Usar referencias de arquivos e ids de tarefas quando possivel.
- Usar `synapse-peers` para mensagens curtas entre sessoes ativas.

## Recent Dialog Context
"@
    Write-TextFile (Join-Path $Destino ".adonex\memory\SHARED_DIALOG_MEMORY.md") $SharedDialogMemory

    $ChatTasksMemory = @"
# Chat Tasks

Tarefas solicitadas pela caixa de dialogo do VS Code, Codex, Claude Code ou
AdoneX. Cada assistente deve consultar esta tabela antes de pedir contexto que
ja foi fornecido.

| Date | Source | Status | Objective | Notes |
| --- | --- | --- | --- | --- |
| $CreationDate | synapse | created | Projeto $NomeProjeto criado no universo $($ProjectUniverse.universe) | Memoria compartilhada inicializada |
"@
    Write-TextFile (Join-Path $Destino ".adonex\memory\CHAT_TASKS.md") $ChatTasksMemory

    $AttachmentManifest = @"
{
  "project": "$NomeProjeto",
  "source": "scripts/create_ai_project.ps1",
  "usage": "Fotos e arquivos anexados pela task AI Factory: Anexar foto ou arquivo ao projeto aparecem aqui para o Codex, Ruflo, os 15 core agents e especialistas sob demanda.",
  "attachments": []
}
"@
    Write-TextFile (Join-Path $Destino "docs\briefings\codex_attachments_manifest.json") $AttachmentManifest

    $ExecutionSpec = @"
# Especificacao de Execucao IA/ML - $NomeProjeto

Este projeto segue `config/ai_ml_enterprise_spec.json` como contrato principal.

## Universo

- Universo: $($ProjectUniverse.label)
- Tipo tecnico: $TipoProjeto
- ML ativo: $($ProjectUniverse.ml_enabled)
- IA ativa: $($ProjectUniverse.ai_enabled)
- RAG ativo: $($ProjectUniverse.rag_enabled)
- Ruflo core agents ativos: 15
- Ruflo max agents: 60
- Ruflo especialistas sob demanda: 45
- Ruflo default economic active agents: 5
- Ruflo enterprise active agents: 15
- Tratamento de dados ativo: True
- Ollama local-first ativo: True
- Roteamento governado Ruflo/Ollama/OpenAI: True
- Aprendizagem por memoria do projeto: True
- IA agentica aplicada a transformacao empresarial: True
- Descricao: $($ProjectUniverse.description)

Ruflo com 15 core agents configurados, ativacao economica, pool escalavel ate 60 agentes e o fluxo de tratamento estatistico de dados sao base
obrigatoria em todos os universos. O universo define o foco da solucao, nao
remove a preparacao, validacao e tratamento dos dados.

## Gate SDD

Nenhuma implementacao deve comecar sem:

- especificacao funcional
- arquitetura tecnica
- fluxo de dados
- plano de implementacao
- estrutura de codigo
- criterios de aceitacao
- estrategia de testes

## Execucao no Codex + Ruflo

- Ruflo ativo e obrigatorio por padrao.
- O roteador deve ativar em paralelo apenas o subconjunto de core agents necessario ao cenario.
- Os 45 especialistas devem ser roteados sob demanda pelo orchestration-manager quando a solicitacao justificar.
- Para baixo custo, o roteador economico deve ativar 3, 5, 8 ou 15 agentes por padrao conforme complexidade.
- Os 60 agentes so devem ser ativados em auditoria completa ou fluxo extremo explicitamente justificado.
- Fleets governadas devem ser selecionadas por `config/agent_fleets.json`.
- Identidade, permissoes, proposito, explicabilidade, observabilidade, certificacao e lifecycle devem seguir `config/agent_trust_framework.json`.
- O `orchestration-manager` consolida respostas antes de acionar modelos ou ferramentas.
- Solicitacoes simples devem usar Ollama local por padrao.
- Solicitacoes complexas podem escalar para OpenAI somente pela ponte governada.
- Os 60 agentes acessam modelos apenas por `governed_llm_router`.
- Todo objetivo empresarial deve passar pelo workflow `business-transformation`
  antes de escalar automacoes ou integracoes.
- Riscos HIGH e CRITICAL exigem aprovacao humana registrada.
- Experiencias aprovadas entram na memoria do projeto; pesos do modelo nunca mudam automaticamente.
- Cada agente recebe apenas o contexto necessario para reduzir custo de tokens.
- Contexto estavel, ferramentas e especificacoes devem ser mantidos em prefixos cacheaveis quando o provedor suportar prompt caching.

## IA

- Ativo neste projeto: $($ProjectUniverse.ai_enabled)
- Quando ativo, definir LLM, prompts, tool/function calling, MCP, A2A, memoria, guardrails e evals.
- Quando ativo, definir objetivo, ferramentas, memoria, contexto, limites e criterios de sucesso para cada agente.

## RAG

- Ativo neste projeto: $($ProjectUniverse.rag_enabled)
- Quando ativo, usar multi-query retrieval, hybrid search, semantic search, reranking, context compression, parent-child retrieval, GraphRAG e metadata filtering quando a base de conhecimento exigir.
- Quando ativo, definir chunking, overlap, metadados, indexacao, recuperacao, metricas e citacoes.

## ML

- Ativo neste projeto: $($ProjectUniverse.ml_enabled)
- Quando ativo, definir objetivo de negocio, alvo, contrato de dados, baseline, metricas offline/online, registry local de modelos, model card, monitoramento, drift e rollback.

## Producao

- Validar robustez, erros, logs estruturados, metricas, seguranca, performance, escalabilidade, custo, latencia e tokens antes de liberar.

## Transformacao Empresarial

- Configuracao: `config/business_transformation.json`.
- Prompt: `prompts/business_transformation.md`.
- Workflow Ruflo: `config/workflows/ruflo/business-transformation.json`.
- Perfis: `agents/definitions/business_transformation_agents.yaml`.
- Operar em simulacao antes de conectar tools MCP reais.
- Medir baseline, tempo de ciclo, retrabalho, custo por caso, adocao e resultado principal.
"@
    Write-TextFile (Join-Path $Destino "docs\specifications\ai_ml_execution_spec.md") $ExecutionSpec

    if ($ProjectUniverse.ai_enabled) {
        $FrameworkSpec = @"
# Selecao de Frameworks IA - $NomeProjeto

Este projeto usa `config/ai_framework_selection.json` para orientar Codex + Ruflo
antes de criar agentes, RAG, LLM, MCP ou workflows no-code.

## Politica

- Codex classifica o cenario da solicitacao do usuario.
- Ruflo ativa um subconjunto economico dos 15 core agents e roteia especialistas sob demanda ate 60 agentes.
- Frameworks sao candidatos arquiteturais, nao dependencias instaladas cegamente.
- A selecao deve respeitar SDD, evals, observabilidade, seguranca, custo e latencia.

## Frameworks Candidatos

1. LangGraph
2. LlamaIndex
3. Haystack
4. OpenAI Agents SDK
5. Pydantic AI
6. CrewAI
7. AutoGen
8. Microsoft Agent Framework / Semantic Kernel
9. Dify
10. Flowise
11. RAGFlow
12. R2R
13. MCP SDKs
14. Swarms

## Cenarios

- Agentes stateful e workflows com handoff: LangGraph, OpenAI Agents SDK, Pydantic AI, MCP SDKs.
- RAG corporativo: LlamaIndex, Haystack, RAGFlow, R2R, MCP SDKs.
- Times de agentes por papeis: CrewAI, LangGraph, OpenAI Agents SDK.
- Conversas multiagentes e colaboracao pesquisador/coder/reviewer: AutoGen, LangGraph, CrewAI.
- No-code ou visual builder: Dify, Flowise, RAGFlow.
- Muitos agentes paralelos: Swarms, Ruflo, LangGraph.
- Stack Microsoft: Microsoft Agent Framework / Semantic Kernel.
- Ferramentas, recursos e contexto padronizado: MCP SDKs.

## Alinhamento Com Livros

- AI Engineering: definir evals, metricas de produto, custo e latencia antes de otimizar.
- Prompt Engineering for LLMs: versionar prompts, exemplos, contratos de saida e regressao.
- The LLM Engineer's Handbook: aplicar LLMOps, RAG, observabilidade e pipelines de producao.
- Build a Large Language Model From Scratch: respeitar limites de tokenizacao, embeddings e atencao.
- Production LLMs: projetar fallbacks, monitoramento, guardrails, seguranca e release.
"@
        Write-TextFile (Join-Path $Destino "docs\specifications\ai_framework_selection.md") $FrameworkSpec

        $TechnologyLayerSpec = @"
# Camada de Tecnologia - $NomeProjeto

Este projeto usa `config/ai_framework_selection.json` como catalogo governado
para selecionar tecnologias, arquiteturas, frameworks, agentes, pipelines e
templates a partir do problema de negocio.

## Catalogo

- CrewAI
- Swarms
- LangChain
- LangGraph
- LangFlow
- Flowise
- Dify
- n8n
- Firecrawl
- Deep Research
- Awesome Lists
- Vector DBs
- RAG frameworks
- KAG / Knowledge Graph
- FastAPI
- Ollama
- MCP servers

## Saidas Obrigatorias

- `technology_layer`: tecnologias, capacidades, categorias e templates recomendados.
- `architecture_blueprint`: componentes locais-first e limites de ferramenta.
- `pipeline_blueprints`: descoberta, RAG, agentes, automacao, ingestao ou MLOps.
- `solution_templates`: templates a adaptar antes da implementacao.
- `evaluation_plan`: testes e evals antes de release.
- `production_risks`: riscos a tratar no desenho e na revisao.

## Regras

- Comecar pelo problema de negocio, metrica, fontes disponiveis e risco.
- Usar Ollama local para triagem, planejamento e revisao por padrao.
- Usar FastAPI, Ollama e MCP servers como base local-first para IA, Chatbolt e hibridos.
- Usar registry local de modelos e evals em projetos ML e hibridos.
- Usar RAG somente quando conhecimento confiavel, busca ou citacoes forem necessarios.
- Usar agentes somente quando houver planejamento, ferramentas, coordenacao ou execucao multi-etapas.
- Nao ativar os 60 agentes nem cloud sem pedido explicito e aprovacao humana.
"@
        Write-TextFile (Join-Path $Destino "docs\specifications\technology_layer.md") $TechnologyLayerSpec
        $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
        if (Test-Path $RuntimePath) {
            $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
            $RequiredPaths = @($Runtime.validation.required_practice_paths)
            foreach ($RelativePath in @(
                "config/ai_framework_selection.json",
                "docs/specifications/ai_framework_selection.md",
                "docs/specifications/technology_layer.md"
            )) {
                if ($RelativePath -notin $RequiredPaths) {
                    $RequiredPaths += $RelativePath
                }
            }
            $Runtime.validation.required_practice_paths = $RequiredPaths
            Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
        }
    }

    $AgenticMeshSpec = @"
# Agentic Mesh Governance - $NomeProjeto

Este projeto usa `config/agent_trust_framework.json` e `config/agent_fleets.json`
para criar, operar e auditar agents e fleets de forma corporativa.

## Contexto

- Projeto: $NomeProjeto
- Universo: $($ProjectUniverse.label)
- Tipo tecnico: $TipoProjeto
- ML ativo: $($ProjectUniverse.ml_enabled)
- IA ativa: $($ProjectUniverse.ai_enabled)
- RAG ativo: $($ProjectUniverse.rag_enabled)
- Ruflo max agents: 60
- Ruflo default economic active agents: 5
- Ruflo enterprise active agents: 15

## Trust Layers Obrigatorias

1. Identity and Authentication
2. Authorization and Tool Permissions
3. Purpose and Policy
4. Planning and Explainability
5. Observability and Agent SRE
6. Certification and Compliance
7. Lifecycle Governance

## Fleets Governadas

- A fabrica de projetos permanece exclusiva da plataforma Synapse.
- ml_fleet: dados, baseline, treino, avaliacao, tracking de experimentos, model card e drift.
- rag_fleet: ingestao, chunking, retrieval, reranking, citacoes e fidelidade.
- mcp_fleet: MCP, tool calling, schemas, permissoes e fallbacks.
- security_fleet: LGPD, threat modeling, policies, red team e aprovacoes.
- cost_optimization_fleet: tokens, cache, contexto, latencia e custo.

## Matriz de Autonomia

Permitido sem aprovacao:

- leitura de arquivos do projeto
- resumo de contexto
- proposta de arquitetura
- geracao de testes
- validacoes nao destrutivas
- documentacao solicitada

Exige aprovacao humana:

- deletar arquivos
- alterar segredos
- deploy em producao
- mudar auth/permissoes
- ativar todos os 60 agentes
- chamadas pagas externas em escala

Proibido:

- exfiltrar segredos
- burlar SDD
- desativar seguranca
- esconder falhas de ferramentas
- fabricar resultados de avaliacao

## Gate de Criacao de Agents

Antes de criar ou alterar agents:

- definir objetivo
- definir ferramentas permitidas
- definir memoria
- definir contexto
- definir limites de atuacao
- definir criterios de sucesso
- definir fleet responsavel
- definir evals e observabilidade
- definir status de certificacao

## Gate de Fleet

Cada fleet deve ter:

- lead agent
- agentes core
- especialistas sob demanda
- metricas de sucesso
- criterio de ativacao
- limite economico de agents
- regras de aprovacao humana
- owner operacional

## Relacao Com Baixo Custo

O agentic mesh deve trabalhar junto com `config/cost_optimization_policy.json`.
Os 60 agentes permanecem disponiveis, mas a criacao e execucao devem priorizar
3, 5, 8 ou 15 agentes conforme complexidade. Ativar os 60 exige justificativa
explicita, aprovacao humana e registro no runbook.
"@
    Write-TextFile (Join-Path $Destino "docs\specifications\agentic_mesh_governance.md") $AgenticMeshSpec

    $AgenticPatternsSpec = @"
# Padroes Arquiteturais Agentic - $NomeProjeto

Este projeto herda do Synapse um catalogo leve de padroes para sistemas
multiagente empresariais. O catalogo executavel fica em
`config/agentic_architectural_patterns.json`.

## Padroes Herdados

- Orchestrator Specialist: um lider coordena especialistas sob demanda.
- Critic Reviewer Gate: risco alto passa por revisao, evals e aprovacao.
- A2A Message Contract: Codex, Claude, AdoneX, Ruflo e humanos trocam resumos
  curtos por `synapse-peers`.
- Tool Gateway: ferramentas operam com menor privilegio e auditoria.
- Model Router: agentes nao chamam LLM direto; passam pelo gateway.
- Shared Memory Retrieval: recuperar contexto aprovado antes de gastar tokens.
- Lifecycle Callbacks: eventos de ciclo de vida viram auditoria, nao chamadas
  extras de modelo.

## Regras Locais

- Comece com um agente.
- Escale especialistas apenas quando o dominio exigir.
- Cloud exige pedido explicito e aprovacao humana.
- Ativar todos os 60 agentes exige justificativa e aprovacao.
- Mensagens A2A nao devem conter secrets.
"@
    Write-TextFile (Join-Path $Destino "docs\specifications\agentic_architectural_patterns.md") $AgenticPatternsSpec

    Write-Host "Artefatos ML/IA personalizados criados." -ForegroundColor Green
}

function Create-ProjectTests {
    $ProjectContractTest = @"
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def read_json(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8-sig"))


def test_solution_project_contract_is_valid():
    contract = read_json("config/synapse_solution_contract.json")
    universe = read_json("config/project_universe.json")

    assert contract["managed_by"] == "synapse"
    assert contract["role"] == "solution_project"
    assert contract["factory_capable"] is False
    assert contract["contains_backend"] is False
    assert contract["contains_frontend"] is False
    assert contract["universe"] == universe["universe"]
    assert contract["capabilities"]["data_treatment"] is True


def test_solution_project_does_not_inherit_platform_runtime():
    forbidden = [
        "backend",
        "frontend",
        "scripts/create_ai_project.ps1",
        "scripts/synapse_peers_mcp.py",
    ]
    for relative_path in forbidden:
        assert not (ROOT / relative_path).exists(), relative_path


def test_required_solution_runtime_artifacts_exist():
    required = [
        "AGENTS.md",
        "CLAUDE.md",
        ".mcp.json",
        "config/business_solution_analysis.json",
        "config/llm_solution_factory_policy.json",
        "config/runtime_manifest.json",
        "config/context_policy.json",
        "config/data_treatment_policy.json",
        "scripts/treat_dataset.py",
        "scripts/start_ruflo_swarm.ps1",
        "agents/definitions/enterprise_agents.yaml",
        "docs/briefings/business_solution_analysis.md",
        "docs/specifications/llm_solution_factory_governance.md",
        "evals/project_cases.jsonl",
        "evals/quality_gates.yaml",
        "tests/test_project_contract.py",
        "tests/test_evals_contract.py",
        "tests/test_data_contract.py",
    ]
    for relative_path in required:
        assert (ROOT / relative_path).exists(), relative_path
"@
    Write-TextFile (Join-Path $Destino "tests\test_project_contract.py") $ProjectContractTest

    $EvalsContractTest = @"
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def jsonl_rows(relative_path):
    path = ROOT / relative_path
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def test_project_eval_cases_are_versioned_and_actionable():
    rows = jsonl_rows("evals/project_cases.jsonl")

    assert rows
    for row in rows:
        assert row["id"]
        assert row["project"] == "$NomeProjeto"
        assert row["type"] == "$TipoProjeto"
        assert row["input"]
        assert row["expected_contains"]
        assert row["risk"] in {"low", "medium", "high", "critical"}


def test_quality_gates_cover_release_basics():
    gates = (ROOT / "evals/quality_gates.yaml").read_text(encoding="utf-8-sig")

    assert "baseline_required" in gates
    assert "rollback_required" in gates
    assert "cost_budget_required" in gates
"@
    Write-TextFile (Join-Path $Destino "tests\test_evals_contract.py") $EvalsContractTest

    $DataContractTest = @"
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_data_contract_and_treatment_policy_exist():
    data_contract = ROOT / "ml_systems/data_contract.yaml"
    policy = ROOT / "config/data_treatment_policy.json"

    assert data_contract.exists()
    assert policy.exists()

    contract_text = data_contract.read_text(encoding="utf-8-sig")
    assert "schema" in contract_text
    assert "null_rate" in contract_text
    assert "duplicate_rate" in contract_text
    assert "leakage_checks" in contract_text


def test_data_directories_are_ready_for_pipeline():
    for relative_path in ("data/raw", "data/processed", "data/features", "data/contracts"):
        assert (ROOT / relative_path).exists(), relative_path
"@
    Write-TextFile (Join-Path $Destino "tests\test_data_contract.py") $DataContractTest

    if ($ProjectUniverse.ml_enabled) {
        $MlContractTest = @"
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def jsonl_rows(relative_path):
    return [
        json.loads(line)
        for line in (ROOT / relative_path).read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def test_ml_universe_has_mlops_release_contracts():
    assert (ROOT / "config/ml_foundations_policy.json").exists()
    assert (ROOT / "docs/specifications/ml_foundations.md").exists()
    assert (ROOT / "ml_systems/model_card.md").exists()
    assert (ROOT / "ml_systems/monitoring_plan.yaml").exists()
    assert (ROOT / "evals/ml_cases.jsonl").exists()
    assert (ROOT / "artifacts/models").exists()


def test_ml_eval_cases_cover_classification_or_forecasting():
    tasks = {row["task"] for row in jsonl_rows("evals/ml_cases.jsonl")}

    assert tasks & {"classification", "forecasting", "regression"}
"@
        Write-TextFile (Join-Path $Destino "tests\test_ml_contract.py") $MlContractTest
    }

    if ($ProjectUniverse.ai_enabled) {
        $AiContractTest = @"
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def jsonl_rows(relative_path):
    return [
        json.loads(line)
        for line in (ROOT / relative_path).read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def test_ai_universe_has_prompt_rag_and_guardrail_contracts():
    assert (ROOT / "evals/prompt_cases.jsonl").exists()
    assert (ROOT / "evals/rag_cases.jsonl").exists()
    assert (ROOT / "rag_pipelines").exists()
    assert (ROOT / "guardrails/policy.yaml").exists()
    assert (ROOT / "config/ai_framework_selection.json").exists()
    assert (ROOT / "docs/specifications/technology_layer.md").exists()


def test_prompt_eval_cases_define_expected_behavior():
    rows = jsonl_rows("evals/prompt_cases.jsonl")

    assert rows
    assert all(row.get("expected_contains") for row in rows)
"@
        Write-TextFile (Join-Path $Destino "tests\test_ai_contract.py") $AiContractTest
    }

    if ($ProjectUniverse.universe -eq "chatbolt") {
        $ChatbotContractTest = @"
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]


def jsonl_rows(relative_path):
    return [
        json.loads(line)
        for line in (ROOT / relative_path).read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def test_chatbolt_universe_has_chatbot_quality_contracts():
    assert (ROOT / "prompts/chatbot_assistant.md").exists()
    assert (ROOT / "docs/specifications/chatbot_design_spec.md").exists()
    assert (ROOT / "docs/checklists/chatbot_quality_checklist.md").exists()
    assert (ROOT / "config/chatbot_config.yaml").exists()


def test_chatbot_eval_cases_cover_safety_and_context():
    rows = jsonl_rows("evals/chatbot_cases.jsonl")
    joined = " ".join(" ".join(row.get("expected_contains", [])) for row in rows)

    assert "safety" in joined or "policy" in joined
    assert "context" in joined or "documents" in joined
"@
        Write-TextFile (Join-Path $Destino "tests\test_chatbot_contract.py") $ChatbotContractTest
    }

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $RequiredPaths = @($Runtime.validation.required_practice_paths)
        foreach ($RelativePath in @(
            "tests/test_project_contract.py",
            "tests/test_evals_contract.py",
            "tests/test_data_contract.py",
            $(if ($ProjectUniverse.ml_enabled) { "tests/test_ml_contract.py" }),
            $(if ($ProjectUniverse.ai_enabled) { "tests/test_ai_contract.py" }),
            $(if ($ProjectUniverse.universe -eq "chatbolt") { "tests/test_chatbot_contract.py" })
        ) | Where-Object { $_ }) {
            if ($RelativePath -notin $RequiredPaths) {
                $RequiredPaths += $RelativePath
            }
        }
        $Runtime.validation.required_practice_paths = $RequiredPaths
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    Write-Host "Camada tests/ criada para o universo $($ProjectUniverse.label)." -ForegroundColor Green
}

function Create-BusinessSolutionAnalysis {
    $AnalyzerScript = Join-Path $Template "scripts\analyze_business_solution.py"
    if (!(Test-Path $AnalyzerScript)) {
        Write-Host "ERRO: analisador de solucao de negocio nao encontrado: $AnalyzerScript" -ForegroundColor Red
        throw "Analisador de solucao de negocio nao encontrado: $AnalyzerScript"
    }

    $GoalForAnalysis = if ([string]::IsNullOrWhiteSpace($ProjectGoal)) { "Criar solucao $($ProjectUniverse.label) com Synapse" } else { $ProjectGoal }
    $FocusForAnalysis = if ([string]::IsNullOrWhiteSpace($SolutionFocus)) { $ProjectUniverse.solution_focus } else { $SolutionFocus }

    & python $AnalyzerScript `
        "--project-root=$Destino" `
        "--project-name=$NomeProjeto" `
        "--universe=$($ProjectUniverse.universe)" `
        "--project-goal=$GoalForAnalysis" `
        "--business-problem=$BusinessProblem" `
        "--solution-focus=$FocusForAnalysis" `
        "--success-metric=$SuccessMetric" `
        "--available-sources=$AvailableSources" `
        "--risk-level=$RiskLevel" | Out-Host

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: falha ao gerar analise de solucao de negocio." -ForegroundColor Red
        throw "Falha ao gerar analise de solucao de negocio (exit $LASTEXITCODE)."
    }

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $RequiredPaths = @($Runtime.validation.required_practice_paths)
        foreach ($RelativePath in @(
            "config/business_solution_analysis.json",
            "config/llm_solution_factory_policy.json",
            "docs/briefings/business_solution_analysis.md",
            "docs/specifications/llm_solution_factory_governance.md",
            $(if ($ProjectUniverse.ml_enabled) { "config/ml_foundations_policy.json" }),
            $(if ($ProjectUniverse.ml_enabled) { "docs/specifications/ml_foundations.md" })
        )) {
            if ($RelativePath -notin $RequiredPaths) {
                $RequiredPaths += $RelativePath
            }
        }
        $Runtime.validation.required_practice_paths = $RequiredPaths
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    Write-Host "Analisador de solucao de negocio aplicado ao projeto." -ForegroundColor Green
}

function Create-Runbooks {
    $NewLine = [Environment]::NewLine
    $LocalSetup = @(
        "# Setup Local - $NomeProjeto",
        "",
        "Este e um projeto de solucao gerenciado pelo Synapse.",
        "Ele nao contem backend, frontend ou fabrica de projetos.",
        "",
        "## Trabalhar pelo VS Code",
        "",
        "Caminho principal: converse com Codex, Claude Code ou AdoneX no VS Code.",
        "Use `@adonex /projeto` ou linguagem natural para pedir criacao, evolucao ou implementacao.",
        "Se faltar objetivo, problema de negocio, universo, metrica/criterio, dados/fontes ou risco, o assistente deve perguntar no chat antes de implementar.",
        "Navegador e tasks sao opcionais.",
        "",
        "Use o Synapse como caixa de dialogo para pedir:",
        "",
        "- modelos de ML",
        "- agentes de IA",
        "- pipelines RAG",
        "- tratamento estatistico dos dados",
        "- anexos de fotos e arquivos para contexto do Codex/Ruflo",
        "- avaliacoes",
        "- documentacao",
        "- ajustes de workflows Ruflo",
        "",
        "## Validacao",
        "",
        "A validacao inicial ja foi executada durante a criacao do projeto, exceto se",
        "voce usou -SkipValidation.",
        "",
        "Para revalidar manualmente:",
        "",
        "~~~powershell",
        "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1",
        "~~~",
        "",
        "## Arquivos principais",
        "",
        "- config/runtime_manifest.json",
        "- config/enterprise.yaml",
        "- config/workflows/enterprise_workflows.yaml",
        "",
        "## Tratar dados",
        "",
        "Coloque arquivos em data/raw/ e, pela conversa com Codex, peca:",
        "",
        "~~~text",
        "trate data/raw/seu_arquivo.csv com Ruflo economico e especialistas sob demanda",
        "~~~",
        "",
        "Tasks locais podem existir como atalho, mas a caixa de dialogo e o caminho principal.",
        "",
        "Para executar somente o tratamento estatistico isolado, rode:",
        "",
        "~~~powershell",
        "python .\scripts\treat_dataset.py --input .\data\raw\seu_arquivo.csv",
        "~~~",
        "",
        "O resultado sera salvo em data/processed/ e o relatorio em output/data_treatment/.",
        "",
        "## Anexar foto ou arquivo",
        "",
        "Envie o arquivo pelo painel de projetos do Synapse.",
        "",
        "- datasets sao copiados para data/raw/",
        "- imagens sao copiadas para data/uploads/images/",
        "- outros arquivos sao copiados para data/uploads/files/",
        "- o manifesto fica em docs/briefings/codex_attachments_manifest.json"
    ) -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\local_setup.md") -Content $LocalSetup

    $ModelRelease = @(
        "# Runbook de Release de Modelo - $NomeProjeto",
        "",
        "1. Confirmar contrato de dados.",
        "2. Criar ou atualizar baseline.",
        "3. Rodar avaliacoes ML e IA.",
        "4. Registrar execucao no registry local de modelos.",
        "5. Atualizar model card.",
        "6. Revisar plano de monitoramento.",
        "7. Promover modelo com alias candidate, challenger ou champion.",
        "8. Documentar rollback."
    ) -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\model_release.md") -Content $ModelRelease

    $AgentSre = @(
        "# Runbook Agent SRE - $NomeProjeto",
        "",
        "Este runbook orienta operacao, incidentes e confiabilidade de agents e fleets.",
        "",
        "## Sinais Obrigatorios",
        "",
        "- active_agent_count",
        "- selected_fleet",
        "- token_budget",
        "- cached_token_ratio",
        "- cost_per_request",
        "- latency_ms",
        "- tool_error_rate",
        "- eval_pass_rate",
        "- fleet_health",
        "",
        "## Triage de Incidente",
        "",
        "1. Identificar fleet afetada em config/agent_fleets.json.",
        "2. Verificar se a ativacao respeitou config/cost_optimization_policy.json.",
        "3. Conferir logs estruturados, tokens, latencia e erros de ferramentas.",
        "4. Confirmar se houve aprovacao humana para acoes criticas.",
        "5. Rodar testes e evals relevantes.",
        "6. Registrar causa, impacto, mitigacao e rollback.",
        "",
        "## Escalacao",
        "",
        "- Seguranca/LGPD: security_fleet.",
        "- RAG ou alucinacao: rag_fleet.",
        "- MCP/tool calling: mcp_fleet.",
        "- Custo/tokens/latencia: cost_optimization_fleet.",
        "- ML/modelo/drift: ml_fleet.",
        "",
        "## Guardrails Operacionais",
        "",
        "- Nunca ativar os 60 agentes sem justificativa explicita.",
        "- Nunca permitir ferramenta destrutiva sem aprovacao humana.",
        "- Nunca esconder falha de tool, RAG, eval ou validacao.",
        "- Sempre preservar rastreabilidade de prompt, agent, fleet e decisao.",
        "",
        "## Validacao",
        "",
        "~~~powershell",
        "pytest -q",
        "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1",
        "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose_project.ps1 -ProjectName $NomeProjeto",
        "~~~"
    ) -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\agent_sre.md") -Content $AgentSre

    $Checklist = @(
        "# Checklist Inicial do Projeto",
        "",
        "- [x] Runtime manifest configurado.",
        "- [x] Especificacao enterprise IA/ML configurada em config/ai_ml_enterprise_spec.json.",
        "- [x] Enterprise YAML configurado.",
        "- [x] Contratos de execucao configurados para o Synapse.",
        "- [x] .env.example criado sem backend ou frontend.",
        "- [x] Estrutura de data/experiments/artifacts criada.",
        "- [x] Script de tratamento estatistico em scripts/treat_dataset.py.",
        "- [x] Prompt mestre de tratamento estatistico em prompts/master_data_treatment.md.",
        "- [x] Politica de tratamento em config/data_treatment_policy.json.",
        "- [x] Prompt de tratamento de dados em prompts/codex_data_treatment_dialog.md.",
        "- [x] Fluxo Codex + Ruflo + 15 core agents para tratar dados.",
        "- [x] Fluxo de anexos para fotos e arquivos com manifesto para Codex/Ruflo.",
        "- [x] Camadas ML, IA, RAG, guardrails e evals copiadas do template.",
        "- [x] SDD, Ruflo ativo, 15 core agents e limite escalavel de 60 agentes definidos como padrao.",
        "- [x] Especificacao de execucao criada em docs/specifications/ai_ml_execution_spec.md.",
        "- [x] Especificacao agentic mesh criada em docs/specifications/agentic_mesh_governance.md.",
        "- [x] Checklist de certificacao de fleets criado em docs/checklists/agent_fleet_certification.md.",
        "- [x] Runbook Agent SRE criado em docs/runbooks/agent_sre.md.",
        "- [x] Ollama local-first configurado com qwen2.5-coder:3b para tarefas rapidas.",
        "- [x] Ollama qwen3:8b integrado para respostas gerais e documentacao offline.",
        "- [x] Ollama deepseek-coder-v2:lite integrado para revisao e debugging offline.",
        "- [x] Ollama qwen2.5-coder:14b, qwen3:14b, deepseek-r1:14b e qwen2.5-coder:32b mapeados sob demanda.",
        "- [x] DeepSeek Coder V2 Lite integrado para revisao, debugging e reparo de codigo.",
        "- [x] Perfil local avancado mapeado para qwen2.5-coder:32b sob demanda.",
        "- [x] Politica offline documentada em docs/ollama-offline-models.md.",
        "- [x] Ponte governada Ruflo -> Ollama/OpenAI configurada para os 60 agentes.",
        "- [x] Aprendizagem continua por memoria configurada sem atualizar pesos automaticamente.",
        "- [x] Catalogo de frameworks IA disponivel em config/ai_framework_selection.json.",
        "- [x] Projetos IA/Hibridos/Chatbolt recebem docs/specifications/ai_framework_selection.md.",
        "- [x] Projetos IA/Hibridos/Chatbolt recebem docs/specifications/technology_layer.md.",
        "- [x] Projeto marcado como nao-fabrica, sem backend e sem frontend.",
        "- [ ] Ajustar contrato de dados para o caso real.",
        "- [ ] Completar model card com uso pretendido e metricas reais.",
        "- [ ] Adicionar casos especificos em evals/."
    ) -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\checklists\first_project_setup.md") -Content $Checklist

    $FleetCertification = @(
        "# Checklist de Certificacao de Agent Fleet - $NomeProjeto",
        "",
        "Use este checklist antes de liberar qualquer agent ou fleet para uso corporativo.",
        "",
        "## Identidade e Ownership",
        "",
        "- [ ] Fleet tem id estavel em config/agent_fleets.json.",
        "- [ ] Lead agent definido.",
        "- [ ] Owner operacional definido.",
        "- [ ] Versao e status de certificacao definidos.",
        "",
        "## Permissoes e Ferramentas",
        "",
        "- [ ] Ferramentas permitidas listadas.",
        "- [ ] Ferramentas proibidas listadas.",
        "- [ ] Acoes destrutivas exigem aprovacao humana.",
        "- [ ] Menor privilegio aplicado.",
        "",
        "## Proposito e Politicas",
        "",
        "- [ ] Objetivo de negocio documentado.",
        "- [ ] Limites de dominio definidos.",
        "- [ ] Regras LGPD/PII revisadas.",
        "- [ ] Politicas de autonomia revisadas.",
        "",
        "## Planejamento e Explicabilidade",
        "",
        "- [ ] Fleet planeja antes de agir.",
        "- [ ] Decisoes registram racional.",
        "- [ ] Handoffs A2A documentados.",
        "- [ ] Conflitos escalam para orchestration-manager.",
        "",
        "## Observabilidade e Agent SRE",
        "",
        "- [ ] Logs estruturados definidos.",
        "- [ ] Metricas de tokens e custo definidas.",
        "- [ ] Latencia medida.",
        "- [ ] Health da fleet monitorado.",
        "- [ ] Runbook Agent SRE revisado.",
        "",
        "## Evals e Compliance",
        "",
        "- [ ] Agent evals criados.",
        "- [ ] Prompt regression criada.",
        "- [ ] Permissoes de tools revisadas.",
        "- [ ] Red team/adversarial tests executados quando aplicavel.",
        "- [ ] Status de certificacao atualizado.",
        "",
        "## Lifecycle",
        "",
        "- [ ] Plano de rollback definido.",
        "- [ ] Politica de deprecacao definida.",
        "- [ ] Release gate aprovado.",
        "- [ ] Mudancas registradas em docs/runbooks/agent_sre.md."
    ) -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\checklists\agent_fleet_certification.md") -Content $FleetCertification

    if ($ProjectUniverse.universe -eq "chatbolt") {
        $ChatbotOperations = @"
# Chatbot Operations Runbook - $NomeProjeto

## Operacao Diaria

- Monitore a taxa de acertos do chatbot.
- Verifique sessÃµes com mais de 5 turnos e analise a continuidade.
- Confirme que as recuperacoes RAG sao citadas quando usadas.
- Analise mensagens de fallback e ajuste prompts se necessario.

## SeguranÃ§a e Privacidade

- Valide que nenhuma informacao privada seja exposta sem permissao.
- Garanta que o chatbot responda com fallback seguro quando a consulta for insegura.
- Escale casos sensiveis ao security_fleet.

## Manutencao

- Atualize a persona do chatbot conforme o publico do projeto.
- Aporte novas fontes de documentos em `docs/` e `data/` quando relevantes.
- Teste o fluxo com casos de uso reais antes de colocar em producao.
"@
        Write-TextFile -Path (Join-Path $Destino "docs\runbooks\chatbot_operations.md") -Content $ChatbotOperations
    }

    Write-Host "Runbooks e checklist criados." -ForegroundColor Green
}

function Personalize-Readme {
    $Readme = @"
# $NomeProjeto

Tipo: `$TipoProjeto`

Universo: `$($ProjectUniverse.label)`

Capacidades ativas:

- ML: `$($ProjectUniverse.ml_enabled)`
- IA: `$($ProjectUniverse.ai_enabled)`
- RAG: `$($ProjectUniverse.rag_enabled)`
- Ruflo core agents: `15`
- Ruflo max agents: `60`
- Ruflo especialistas sob demanda: `45`
- Transformacao empresarial agentica: `True`
- Tratamento de dados: `True`
- Ollama local-first: `True`
- Governanca de modelos: `True`
- Aprendizagem por memoria: `True`
- Testes automatizados: `True`
- Evals de qualidade: `True`

Projeto de solucao gerenciado pelo Synapse, baseado em Engenharia de IA,
Machine Learning, Estatistica, Governanca e Tratamento de Dados.

## Limites do Projeto

- Nao contem backend.
- Nao contem frontend.
- Nao contem fabrica de projetos.
- Ruflo, agentes, memoria e orquestracao executam no contexto deste projeto.

## Configuracao Principal

- `config/runtime_manifest.json`
- `config/ai_ml_enterprise_spec.json`
- `config/ai_framework_selection.json`
- `config/project_universe.json`
- `config/business_solution_analysis.json`
- `config/enterprise.yaml`
- `config/workflows/enterprise_workflows.yaml`
- `config/business_transformation.json`
- `config/workflows/ruflo/business-transformation.json`

## Camada de Praticas

- `playbooks/`
- `prompts/`
- `tests/`
- `evals/`
- `docs/briefings/business_solution_analysis.md`
- `llm_ops/`
- `ml_systems/`
- `rag_pipelines/`
- `guardrails/`
- `docs/books/implementation_map.md`

## Primeiros Passos

1. Revise `docs/checklists/first_project_setup.md`.
2. Revise `docs/specifications/ai_ml_execution_spec.md`.
3. Se o universo for IA, Hibrido ou Chatbolt, revise `docs/specifications/ai_framework_selection.md`.
4. Revise `docs/AGENTIC_AI_TRANSFORMATION.md`.
5. Defina objetivo, processo, baseline, risco, owner e KPIs.
6. Ajuste `ml_systems/data_contract.yaml`.
7. Coloque dados brutos em `data/raw/`.
8. Peca ao Synapse para tratar `data/raw/seu_arquivo.csv`.
9. Atualize os casos em `evals/project_cases.jsonl`.
10. Rode `python -m pytest tests`.
11. Rode os scripts de avaliacao aplicaveis ao universo do projeto.
"@
    Write-TextFile (Join-Path $Destino "README.md") $Readme
    Write-Host "README personalizado." -ForegroundColor Green
}

function Create-CreationReport {
    $Report = @"
# Project Creation Report

- Project: $NomeProjeto
- Type: $TipoProjeto
- Requested type: $TipoProjetoOriginal
- Universe: $($ProjectUniverse.label)
- ML enabled: $($ProjectUniverse.ml_enabled)
- IA enabled: $($ProjectUniverse.ai_enabled)
- RAG enabled: $($ProjectUniverse.rag_enabled)
- Ruflo core agents enabled: 15
- Ruflo max agents enabled: 60
- Ruflo specialist agents available: 45
- Data treatment enabled: True
- Slug: $ProjectSlug
- Swarm: $SwarmName
- Created at: $CreationDate
- Template: $Template
- Destination: $Destino

## Automated Setup

- Runtime manifest configured
- Enterprise AI/ML specification configured
- AI framework selection catalog configured
- Technology layer specification configured
- Enterprise YAML configured
- Synapse solution contract configured
- Workflow YAML configured
- `.env.example` created
- Data, experiments, artifacts, docs, and output folders created
- Upload folders and Codex attachment manifest created
- Project model card, data contract, prompts, evals, runbooks, and checklist created
- Project tests/ contract layer created for the selected universe
- Codex data treatment prompt and task available
 - No backend or frontend copied into the solution project
 - No project factory copied into the solution project
- Ruflo runtime and agents copied into the solution project
- Ollama qwen2.5-coder:3b configured as the fast local-first provider
- Ollama qwen3:8b configured for general local responses
- Ollama deepseek-coder-v2:lite configured as the balanced offline coding provider
- DeepSeek Coder V2 Lite configured for code review, debugging and repair
- Qwen/DeepSeek 14B and Qwen Coder 32B configured as explicit strong local profiles
- Governed Ruflo model bridge and project-scoped continual learning configured
- Agentic business transformation workflow, prompt, profiles and governance inherited

## Ready

Use `scripts/start_ruflo_swarm.ps1` inside the project to operate its Ruflo swarm.
"@
    Write-TextFile (Join-Path $Destino "output\project_creation_report.md") $Report
    Write-Host "Relatorio de criacao gerado." -ForegroundColor Green
}

function Finalize-SynapseSolutionProject {
    Write-Host "Removendo componentes exclusivos da plataforma Synapse..." -ForegroundColor Cyan

    foreach ($RelativePath in @(
        "docs\architecture",
        "docs\deployment",
        "docs\production-readiness.md",
        "docs\vscode-workflow.md",
        "docs\dual-interface-contract.md",
        "config\workflows\ruflo\new-ai-project.json",
        "scripts\codex_data_treatment_dialog.ps1",
        "scripts\diagnose_project.ps1",
        "scripts\import_project_file.ps1",
        "scripts\market_radar.py",
        "scripts\create_ai_project.ps1",
        "scripts\ai_factory_menu.ps1",
        "scripts\bootstrap_enterprise_stack.ps1",
        "scripts\validate_enterprise_stack.ps1",
        "scripts\synapse_ollama_mcp.py",
        "scripts\synapse_peers_mcp.py",
        "scripts\test_local_llm.py",
        "scripts\start_vick.py",
        "scripts\toggle_vick_autostart.py",
        "scripts\vick_voice_service.py",
        "config\voice_agent_quality_gates.json",
        "docs\specifications\voice_agentic_coding.md",
        "evals\voice_agent_cases.jsonl"
    )) {
        $Path = Join-Path $Destino $RelativePath
        if (Test-Path $Path) {
            Remove-Item -LiteralPath $Path -Recurse -Force
        }
    }

    if (!$ProjectUniverse.ai_enabled) {
        foreach ($RelativePath in @(
            "config\ai_framework_selection.json",
            "rag",
            "rag_pipelines",
            "llm_ops",
            "prompts\rag_answering.md",
            "evals\prompt_cases.jsonl"
        )) {
            $Path = Join-Path $Destino $RelativePath
            if (Test-Path $Path) {
                Remove-Item -LiteralPath $Path -Recurse -Force
            }
        }
    }

    if (!$ProjectUniverse.ml_enabled) {
        foreach ($RelativePath in @(
            "ml_systems\model_card.md",
            "ml_systems\monitoring_plan.yaml",
            "evals\ml_cases.jsonl",
            "notebooks\foundations\math_for_ml_plan.md",
            "config\ml_foundations_policy.json",
            "docs\specifications\ml_foundations.md"
        )) {
            $Path = Join-Path $Destino $RelativePath
            if (Test-Path $Path) {
                Remove-Item -LiteralPath $Path -Force
            }
        }
    }

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $Runtime.agentic_mesh.fleet_count = 6
        $Runtime.validation.required_workflows = @(
            "solution-lifecycle",
            "business-transformation",
            $(if ($ProjectUniverse.ai_enabled) { "rag-build" }),
            $(if ($ProjectUniverse.ml_enabled) { "ml-release" })
        ) | Where-Object { $_ }
        $Runtime.validation.required_practice_paths = @(
            $Runtime.validation.required_practice_paths |
                Where-Object { Test-Path (Join-Path $Destino $_) }
        )
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    $FleetsPath = Join-Path $Destino "config\agent_fleets.json"
    if (Test-Path $FleetsPath) {
        $Fleets = Get-Content $FleetsPath -Raw | ConvertFrom-Json
        $Fleets.fleets = @($Fleets.fleets | Where-Object { $_.id -ne "project_factory_fleet" })
        $Fleets | Add-Member -NotePropertyName "managed_by" -NotePropertyValue "synapse" -Force
        Write-TextFile -Path $FleetsPath -Content ($Fleets | ConvertTo-Json -Depth 20)
    }

    $ProvidersPath = Join-Path $Destino "config\model_providers.json"
    if (Test-Path $ProvidersPath) {
        $Providers = Get-Content $ProvidersPath -Raw | ConvertFrom-Json
        $Providers.ruflo_bridge.PSObject.Properties.Remove("execution_service")
        $Providers.ruflo_bridge | Add-Member -NotePropertyName "managed_by" -NotePropertyValue "synapse" -Force
        Write-TextFile -Path $ProvidersPath -Content ($Providers | ConvertTo-Json -Depth 20)
    }

    $DataTreatmentPromptPath = Join-Path $Destino "prompts\codex_data_treatment_dialog.md"
    if (Test-Path $DataTreatmentPromptPath) {
        $Prompt = Get-Content $DataTreatmentPromptPath -Raw
        $Prompt = $Prompt -replace 'workflow:\s*new-ai-project', 'workflow: solution-lifecycle'
        $Prompt = $Prompt -replace '(?m)^.*frontend-engineering.*\r?\n?', ''
        Write-TextFile -Path $DataTreatmentPromptPath -Content $Prompt
    }

    $SolutionContract = [ordered]@{
        project = $NomeProjeto
        universe = $ProjectUniverse.universe
        managed_by = "synapse"
        role = "solution_project"
        factory_capable = $false
        contains_backend = $false
        contains_frontend = $false
        ruflo_runtime = "inherited"
        agents_runtime = "inherited"
        adonex_runtime = "inherited_complete"
        adonex_package = "adonex/package.json"
        practices = @(
            "ai_engineering",
            "machine_learning",
            "statistics",
            "governance",
            "data_treatment",
            "tests",
            "evals",
            "agentic_business_transformation"
        )
        capabilities = [ordered]@{
            ml = $ProjectUniverse.ml_enabled
            ai = $ProjectUniverse.ai_enabled
            rag = $ProjectUniverse.rag_enabled
            data_treatment = $true
            tests = $true
            evals = $true
            agentic_business_transformation = $true
            human_approval_by_risk = $true
        }
    }
    Write-TextFile -Path (Join-Path $Destino "config\synapse_solution_contract.json") -Content ($SolutionContract | ConvertTo-Json -Depth 10)
}

function Run-ProjectValidation {
    if ($SkipValidation) {
        Write-Host "Validacao automatica pulada por parametro." -ForegroundColor Yellow
        return
    }

    Write-Host "Validando projeto de solucao..." -ForegroundColor Cyan
    $RequiredPaths = @(
        "config\synapse_solution_contract.json",
        "config\project_universe.json",
        "config\data_treatment_policy.json",
        "config\context_policy.json",
        "docs\books\implementation_map.md",
        "docs\specifications\ai_ml_execution_spec.md",
        "data\raw",
        "data\processed",
        "tests\test_project_contract.py",
        "tests\test_evals_contract.py",
        "tests\test_data_contract.py",
        "scripts\treat_dataset.py"
        "prompts\master_data_treatment.md"
        "scripts\start_ruflo_swarm.ps1"
        "agents\definitions\enterprise_agents.yaml"
        "agents\definitions\business_transformation_agents.yaml"
        "config\business_transformation.json"
        "config\workflows\ruflo\business-transformation.json"
        "prompts\business_transformation.md"
        "docs\AGENTIC_AI_TRANSFORMATION.md"
        ".mcp.json"
        "AGENTS.md"
        "CLAUDE.md"
        "docs\runbooks\adonex.md"
        "docs\runbooks\peer_messaging.md"
        "scripts\synapse_solution_peers_mcp.py"
        ".vscode\settings.json"
        ".vscode\extensions.json"
        ".vscode\tasks.json"
        "adonex\package.json"
        "adonex\src\extension.ts"
        "adonex\src\agent\agentOrchestrator.ts"
        "adonex\src\patch\patchEngine.ts"
        "adonex\src\patch\patchUtils.ts"
        "adonex\src\llm\localModels.ts"
        "adonex\src\tasks\taskFinalizer.ts"
        "adonex\test"
    )
    if ($ProjectUniverse.ml_enabled) {
        $RequiredPaths += @(
            "config\ml_foundations_policy.json",
            "docs\specifications\ml_foundations.md"
        )
    }
    foreach ($RelativePath in $RequiredPaths) {
        if (!(Test-Path (Join-Path $Destino $RelativePath))) {
            Write-Host "ERRO: artefato obrigatorio ausente: $RelativePath" -ForegroundColor Red
            throw "Artefato obrigatorio ausente no projeto gerado: $RelativePath"
        }
    }
    foreach ($ForbiddenPath in @(
        "backend",
        "frontend",
        "scripts\create_ai_project.ps1",
        "scripts\start_vick.py",
        "scripts\toggle_vick_autostart.py",
        "scripts\vick_voice_service.py",
        "config\voice_agent_quality_gates.json",
        "docs\specifications\voice_agentic_coding.md",
        "evals\voice_agent_cases.jsonl"
    )) {
        if (Test-Path (Join-Path $Destino $ForbiddenPath)) {
            Write-Host "ERRO: componente exclusivo do Synapse copiado: $ForbiddenPath" -ForegroundColor Red
            throw "Componente exclusivo do Synapse copiado para o projeto: $ForbiddenPath"
        }
    }
    foreach ($ForbiddenPath in @("adonex\node_modules", "adonex\dist", "adonex\.vscode-test", "adonex\coverage", "adonex\debug.log")) {
        if (Test-Path (Join-Path $Destino $ForbiddenPath)) {
            Write-Host "ERRO: componente pesado do runtime AdoneX copiado: $ForbiddenPath" -ForegroundColor Red
            throw "Componente pesado do runtime AdoneX copiado para o projeto: $ForbiddenPath"
        }
    }

    $EnvExamplePath = Join-Path $Destino ".env.example"
    if (Test-Path $EnvExamplePath) {
        $EnvExample = Get-Content $EnvExamplePath -Raw
        if ($EnvExample -notmatch "PROJECT_DEFAULT_ACTIVE_AGENTS=1" -or $EnvExample -notmatch "PROJECT_ENTERPRISE_ACTIVE_AGENTS=8") {
            Write-Host "ERRO: limites de agentes do .env.example divergem da politica de custo." -ForegroundColor Red
            throw "Limites de agentes do .env.example divergem da politica de custo."
        }
    }

    $McpPath = Join-Path $Destino ".mcp.json"
    if (Test-Path $McpPath) {
        $Mcp = Get-Content $McpPath -Raw | ConvertFrom-Json
        $PeerServer = $Mcp.mcpServers.'synapse-peers'
        if (!$PeerServer -or @($PeerServer.args) -notcontains "scripts/synapse_solution_peers_mcp.py") {
            Write-Host "ERRO: synapse-peers deve usar o MCP standalone do projeto." -ForegroundColor Red
            throw "synapse-peers deve usar o MCP standalone do projeto."
        }
        if (@($PeerServer.args) -contains "scripts/synapse_peers_mcp.py") {
            Write-Host "ERRO: synapse-peers nao pode depender do backend da plataforma." -ForegroundColor Red
            throw "synapse-peers nao pode depender do backend da plataforma."
        }
    }
    Write-Host "Projeto de solucao validado com sucesso." -ForegroundColor Green
}

function Configure-SolutionVsCodeTasks {
    $TasksPath = Join-Path $Destino ".vscode\tasks.json"
    $Tasks = @"
{
  "version": "2.0.0",
  "inputs": [
    {
      "id": "ollamaModel",
      "type": "pickString",
      "description": "Perfil local do Ollama",
      "options": [
        "qwen2.5-coder:3b",
        "qwen3:8b",
        "deepseek-coder-v2:lite",
        "qwen2.5-coder:14b",
        "qwen3:14b",
        "deepseek-r1:14b",
        "qwen2.5-coder:32b"
      ],
      "default": "qwen2.5-coder:3b"
    },
    {
      "id": "ollamaPrompt",
      "type": "promptString",
      "description": "Solicitacao para o modelo local"
    }
  ],
  "tasks": [
    {
      "label": "Synapse: Ollama offline",
      "detail": "Executa um dos perfis locais do Synapse sem navegador e sem API paga.",
      "type": "shell",
      "command": "ollama",
      "args": [
        "run",
        "`${input:ollamaModel}",
        "`${input:ollamaPrompt}"
      ],
      "group": "test",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "dedicated",
        "clear": true,
        "focus": true
      }
    },
    {
      "label": "Synapse: Listar modelos Ollama",
      "type": "shell",
      "command": "ollama",
      "args": ["list"],
      "group": "test",
      "problemMatcher": []
    },
    {
      "label": "Synapse: Rodar testes do projeto",
      "detail": "Executa a camada tests/ herdada do Synapse para validar contratos, dados, evals e universo selecionado.",
      "type": "shell",
      "command": "python",
      "args": [
        "-m",
        "pytest",
        "tests"
      ],
      "group": "test",
      "problemMatcher": []
    }
  ]
}
"@
    Write-TextFile -Path $TasksPath -Content $Tasks

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $RequiredPaths = @($Runtime.validation.required_practice_paths)
        if (".vscode/tasks.json" -notin $RequiredPaths) {
            $Runtime.validation.required_practice_paths = @($RequiredPaths + ".vscode/tasks.json")
        }
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    Write-Host "Tasks VS Code para modelos Ollama offline configuradas." -ForegroundColor Green
}

function Activate-GeneratedProject {
    if ($SkipActivation -or (!$ActivateRuflo -and !$LocalMemoryOnly)) {
        Write-Host "Ativacao automatica pulada por parametro." -ForegroundColor Yellow
        return
    }

    $ActivationScript = Join-Path $Destino "scripts\start_ruflo_swarm.ps1"
    if (!(Test-Path $ActivationScript)) {
        Write-Host "Aviso: script de ativacao Ruflo nao encontrado no projeto gerado." -ForegroundColor Yellow
        return
    }

    Push-Location $Destino
    if (!$LocalMemoryOnly) {
        Write-Host "Ativando Ruflo real no projeto gerado..." -ForegroundColor Cyan
        powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start_ruflo_swarm.ps1" -ActiveAgentLimit $ActiveAgentLimit
    }
    else {
        Write-Host "Preparando memoria/swarm local no projeto gerado..." -ForegroundColor Cyan
        powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start_ruflo_swarm.ps1" -SkipRufloCli -ActiveAgentLimit $ActiveAgentLimit
    }
    $ActivationExitCode = $LASTEXITCODE
    Pop-Location

    if ($ActivationExitCode -ne 0) {
        Write-Host "ERRO: Projeto criado, mas a ativacao falhou." -ForegroundColor Red
        exit $ActivationExitCode
    }

    Write-Host "Ativacao concluida no projeto gerado." -ForegroundColor Green
}

function Normalize-GeneratedProjectFilesystem {
    Write-Host "Normalizando atributos e permissoes do projeto gerado..." -ForegroundColor Cyan

    try {
        Get-ChildItem -LiteralPath $Destino -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $_.Attributes = $_.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly) -band (-bnot [System.IO.FileAttributes]::System)
            }
            catch {
                # Best effort only. Some transient runtime files may be locked.
            }
        }

        $Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $Grant = "$($Identity):(OI)(CI)F"
        icacls $Destino /inheritance:e /grant $Grant /T /C | Out-Null
    }
    catch {
        Write-Host "Aviso: nao foi possivel normalizar todas as permissoes. $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Creation runs as a single transaction: any failing phase triggers rollback of
# the partial project directory so no half-built project is left behind.
try {
    Copy-Template
    Copy-AdoneXRuntime
    Configure-RuntimeManifest
    Configure-EnterpriseSpec
    Configure-CostOptimizationPolicy
    Configure-AgenticMeshGovernance
    Configure-LocalAiRuntime
    Configure-EnterpriseYaml
    Configure-AgentsYaml
    Configure-WorkflowsYaml
    Create-EnvironmentFiles
    Create-ProjectStructure
    Create-ProjectArtifacts
    Create-BusinessSolutionAnalysis
    Create-ProjectTests
    Create-AssistantInheritanceArtifacts
    Create-Runbooks
    Personalize-Readme
    Create-CreationReport
    Finalize-SynapseSolutionProject
    Configure-SolutionVsCodeTasks
    Run-ProjectValidation
    Activate-GeneratedProject
    Normalize-GeneratedProjectFilesystem
}
catch {
    Write-Host "ERRO: criacao do projeto falhou: $($_.Exception.Message)" -ForegroundColor Red
    Remove-PartialProject -Reason $_.Exception.Message
    exit 1
}

Write-Host "Projeto criado: $Destino" -ForegroundColor Green
Write-Host "Tipo: $TipoProjeto" -ForegroundColor Green
Write-Host "Swarm: $SwarmName" -ForegroundColor Green
Write-Host "Proximos comandos:" -ForegroundColor Cyan
Write-Host "  cd $Destino"
Write-Host "  code ."

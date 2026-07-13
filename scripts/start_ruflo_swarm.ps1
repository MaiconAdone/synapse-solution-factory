param(
    [switch]$SkipRufloCli,
    [switch]$DryRun,
    [switch]$SequentialAgents,
    [int]$ActiveAgentLimit = 0
)

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$script:RufloCmd = Join-Path $Root "node_modules\.bin\ruflo.cmd"

function Ensure-RufloRuntime {
    if (Test-Path $script:RufloCmd) {
        return
    }

    $PackageJsonPath = Join-Path $Root "package.json"
    $RufloVersion = "3.10.43"
    if (Test-Path $PackageJsonPath) {
        try {
            $PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
            if ($PackageJson.devDependencies.ruflo) {
                $RufloVersion = [string]$PackageJson.devDependencies.ruflo
            }
        }
        catch {
            Write-Host "Aviso: nao foi possivel ler package.json para versao do Ruflo. Usando $RufloVersion." -ForegroundColor Yellow
        }
    }

    $ShimDir = Join-Path $Root "output\runtime"
    if (!(Test-Path $ShimDir)) {
        New-Item -ItemType Directory -Path $ShimDir -Force | Out-Null
    }

    $ShimPath = Join-Path $ShimDir "ruflo.cmd"
    $ShimContent = "@echo off`r`nnpx -y ruflo@$RufloVersion %*`r`n"
    Set-Content -Path $ShimPath -Value $ShimContent -Encoding ASCII
    $script:RufloCmd = $ShimPath
    Write-Host "Ruflo local nao encontrado. Usando npx sem instalar node_modules no projeto." -ForegroundColor Yellow
}

function Invoke-Ruflo {
    & $script:RufloCmd @args
}

$RuntimeManifestPath = Join-Path $Root "config\runtime_manifest.json"
if (!(Test-Path $RuntimeManifestPath)) {
    Write-Host "ERRO: config\runtime_manifest.json nao encontrado." -ForegroundColor Red
    exit 1
}

$Manifest = Get-Content $RuntimeManifestPath -Raw | ConvertFrom-Json
$ProjectName = $Manifest.project.name
$ProjectType = $Manifest.project.type
$SwarmName = $Manifest.swarm.name
$Topology = $Manifest.swarm.topology
$MaxAgents = $Manifest.swarm.max_agents
$Strategy = $Manifest.swarm.strategy
$MemoryNamespace = if ($Manifest.memory.namespace) { $Manifest.memory.namespace } else { $ProjectName }
$ActivationDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if ($ActiveAgentLimit -le 0) {
    $CostPolicyPath = Join-Path $Root "config\cost_optimization_policy.json"
    if (Test-Path $CostPolicyPath) {
        $CostPolicy = Get-Content $CostPolicyPath -Raw | ConvertFrom-Json
        $ActiveAgentLimit = [int]$CostPolicy.ruflo.default_active_agents
    }
    else {
        $ActiveAgentLimit = 5
    }
}
$ActiveAgentLimit = [Math]::Max(1, [Math]::Min([int]$Manifest.swarm.max_agents, $ActiveAgentLimit))

function Write-TextFile {
    param(
        [string]$Path,
        [string]$Content
    )
    $Parent = Split-Path -Parent $Path
    if (!(Test-Path $Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
    $Content | Set-Content -Path $Path -Encoding UTF8
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ">> $Name" -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host "DRY RUN: $Name" -ForegroundColor Yellow
        return $true
    }

    try {
        & $Action
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
            throw "Comando retornou codigo $LASTEXITCODE"
        }
        return $true
    }
    catch {
        Write-Host "Falhou: $Name" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }
}

Write-Host "Ativando Ruflo Swarm para $ProjectName" -ForegroundColor Cyan

$MemoryRuntime = @{
    project = $ProjectName
    project_type = $ProjectType
    namespace = $MemoryNamespace
    backend = $Manifest.memory.backend
    tiers = $Manifest.memory.tiers
    embeddings = $Manifest.memory.embeddings
    semantic_search = $Manifest.memory.semantic_search
    vector_db_path = $Manifest.memory.vector_db_path
    activated_at = $ActivationDate
}

$MemoryRuntimePath = Join-Path $Root "memory\project_memory.runtime.json"
$MemoryRuntime | ConvertTo-Json -Depth 10 | Set-Content -Path $MemoryRuntimePath -Encoding UTF8

$ActivationManifest = @{
    project = $ProjectName
    project_type = $ProjectType
    swarm = @{
        name = $SwarmName
        topology = $Topology
        strategy = $Strategy
        max_agents = $MaxAgents
        coordination = $Manifest.swarm.coordination
        consensus = $Manifest.swarm.consensus
        parallel_agent_activation = (!$SequentialAgents)
        model_access = "governed_on_demand"
    }
    model_routing = @{
        strategy = "local_first"
        local_provider = "ollama"
        local_model = $Manifest.local_llm.default_model
        bridge = $Manifest.local_llm.ruflo_governed_bridge
        shared_memory_namespace = $Manifest.local_llm.ruflo_shared_memory_namespace
        sensitive_content_local_only = $Manifest.local_llm.sensitive_content_local_only
        single_consolidated_call_by_default = $true
    }
    memory = @{
        enabled = $true
        namespace = $MemoryNamespace
        backend = $Manifest.memory.backend
        runtime_file = "memory/project_memory.runtime.json"
    }
    agents_file = "agents/definitions/enterprise_agents.yaml"
    workflows_file = "config/workflows/enterprise_workflows.yaml"
    activated_at = $ActivationDate
}

$Commands = New-Object System.Collections.Generic.List[string]
$Commands.Add("ruflo swarm init --topology $Topology --max-agents $MaxAgents --strategy $Strategy")
$Commands.Add("ruflo memory store --namespace $MemoryNamespace --key project.identity --value '$ProjectName | $ProjectType | $SwarmName' --upsert")
$Commands.Add("ruflo memory store --namespace $MemoryNamespace --key project.swarm --value '$Topology | $Strategy | $MaxAgents agents' --upsert")
$Commands.Add("ruflo memory store --namespace $MemoryNamespace --key project.model-routing --value 'local_first | ollama | governed_on_demand' --upsert")
$Commands.Add("ruflo agent spawn --type <mapped-type> --name <agent-id> --task <domain activation>  # executed in parallel by default")
$Commands.Add("ruflo swarm coordinate --agents <agent-count> --domains <domains>")

function Get-AgentType {
    param([string]$Domain)

    switch ($Domain) {
        "orchestration" { return "coordinator" }
        "backend" { return "coder" }
        "frontend" { return "coder" }
        "ml" { return "analyst" }
        "llm" { return "architect" }
        "rag" { return "researcher" }
        "platform" { return "performance-engineer" }
        "data" { return "analyst" }
        "quality" { return "tester" }
        "docs" { return "reviewer" }
        default { return "researcher" }
    }
}

function Read-AgentDefinitions {
    $AgentsPath = Join-Path $Root "agents\definitions\enterprise_agents.yaml"
    $Agents = New-Object System.Collections.Generic.List[object]
    if (!(Test-Path $AgentsPath)) {
        return $Agents
    }

    $Current = $null
    foreach ($Line in Get-Content $AgentsPath) {
        if ($Line -match '^\s*-\s+id:\s*(.+?)\s*$') {
            if ($null -ne $Current) {
                $Agents.Add([pscustomobject]$Current)
            }
            $Current = @{
                id = $Matches[1].Trim()
                tier = ""
                domain = ""
                cognitive_pattern = ""
                memory = ""
                mission = ""
            }
            continue
        }

        if ($null -eq $Current) {
            continue
        }

        if ($Line -match '^\s*domain:\s*(.+?)\s*$') {
            $Current.domain = $Matches[1].Trim()
        }
        elseif ($Line -match '^\s*tier:\s*(.+?)\s*$') {
            $Current.tier = $Matches[1].Trim()
        }
        elseif ($Line -match '^\s*cognitive_pattern:\s*(.+?)\s*$') {
            $Current.cognitive_pattern = $Matches[1].Trim()
        }
        elseif ($Line -match '^\s*memory:\s*(.+?)\s*$') {
            $Current.memory = $Matches[1].Trim()
        }
        elseif ($Line -match '^\s*mission:\s*(.+?)\s*$') {
            $Current.mission = $Matches[1].Trim()
        }
    }

    if ($null -ne $Current) {
        $Agents.Add([pscustomobject]$Current)
    }

    return $Agents
}

function Invoke-RufloCapture {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ">> $Name" -ForegroundColor Cyan
    if ($DryRun) {
        return "DRY RUN: $Name"
    }

    try {
        $Output = & $Action 2>&1 | Out-String
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
            return "FAILED ($LASTEXITCODE): $Name`n$Output"
        }
        return $Output
    }
    catch {
        return "FAILED: $Name`n$($_.Exception.Message)"
    }
}

function Invoke-AgentActivationParallel {
    param(
        [object[]]$Agents,
        [string]$RufloCommand,
        [string]$ProjectRoot
    )

    if ($DryRun) {
        return $Agents | ForEach-Object {
            "## Agent $($_.id)`n`nDRY RUN: parallel spawn and memory store"
        }
    }

    $Jobs = foreach ($Agent in $Agents) {
        $AgentType = Get-AgentType $Agent.domain
        $Task = "Activate $($Agent.id) for $ProjectName. Domain=$($Agent.domain). Memory=$($Agent.memory). Pattern=$($Agent.cognitive_pattern)."
        Start-Job -Name "ruflo-agent-$($Agent.id)" -ScriptBlock {
            param(
                [string]$AgentId,
                [string]$AgentDomain,
                [string]$AgentType,
                [string]$AgentMemory,
                [string]$Task,
                [string]$MemoryNamespace,
                [string]$RufloCommand,
                [string]$ProjectRoot
            )

            Set-Location $ProjectRoot
            $SpawnOutput = & $RufloCommand agent spawn --type $AgentType --name $AgentId --task $Task 2>&1 | Out-String
            $SpawnExit = $LASTEXITCODE
            $MemoryOutput = & $RufloCommand memory store --namespace $MemoryNamespace --key "agent.$AgentId" --value "$AgentId | domain=$AgentDomain | type=$AgentType | memory=$AgentMemory" --upsert 2>&1 | Out-String
            $MemoryExit = $LASTEXITCODE

            [pscustomobject]@{
                AgentId = $AgentId
                AgentType = $AgentType
                SpawnExit = $SpawnExit
                SpawnOutput = $SpawnOutput
                MemoryExit = $MemoryExit
                MemoryOutput = $MemoryOutput
            }
        } -ArgumentList $Agent.id, $Agent.domain, $AgentType, $Agent.memory, $Task, $MemoryNamespace, $RufloCommand, $ProjectRoot
    }

    $Results = $Jobs | Wait-Job | Receive-Job
    $Jobs | Remove-Job -Force
    $FailedResults = $Results | Where-Object { $_.SpawnExit -ne 0 -or $_.MemoryExit -ne 0 }
    if ($FailedResults) {
        $script:AgentActivationHadFailures = $true
    }

    return $Results | ForEach-Object {
        $Status = if ($_.SpawnExit -eq 0 -and $_.MemoryExit -eq 0) { "OK" } else { "FAILED" }
        "## Agent $($_.AgentId)`n`nMode: parallel`nType: $($_.AgentType)`nStatus: $Status`nSpawn exit: $($_.SpawnExit)`nMemory exit: $($_.MemoryExit)`n`n### Spawn`n`n$($_.SpawnOutput)`n`n### Memory`n`n$($_.MemoryOutput)"
    }
}

$Agents = Read-AgentDefinitions
$AgentActivationOutputs = New-Object System.Collections.Generic.List[string]
$AgentActivationHadFailures = $false
$RuntimeHadFailures = $false
$RequiredAgents = @($Manifest.validation.required_agents)
$SpecialistAgents = @($Manifest.validation.specialist_agents)
$ScalableAgents = @($RequiredAgents + $SpecialistAgents)
$AgentIds = @($Agents | ForEach-Object { $_.id })

if ($RequiredAgents.Count -ne 15) {
    Write-Host "ERRO: runtime_manifest deve declarar exatamente 15 core agents obrigatorios." -ForegroundColor Red
    exit 1
}

$ExpectedMaxAgents = if ($Manifest.swarm.max_agents) { [int]$Manifest.swarm.max_agents } else { 15 }
if ($ExpectedMaxAgents -ne 60) {
    Write-Host "ERRO: runtime_manifest deve declarar max_agents=60 para o swarm escalavel." -ForegroundColor Red
    exit 1
}

if ($SpecialistAgents.Count -ne 45) {
    Write-Host "ERRO: runtime_manifest deve declarar exatamente 45 specialist agents." -ForegroundColor Red
    exit 1
}

$MissingAgents = @($RequiredAgents | Where-Object { $AgentIds -notcontains $_ })
$MissingSpecialists = @($SpecialistAgents | Where-Object { $AgentIds -notcontains $_ })
$ExtraAgents = @($AgentIds | Where-Object { $ScalableAgents -notcontains $_ })
if ($MissingAgents.Count -gt 0 -or $MissingSpecialists.Count -gt 0 -or $ExtraAgents.Count -gt 0) {
    Write-Host "ERRO: agentes definidos nao batem com os 15 core + 45 specialists do runtime_manifest." -ForegroundColor Red
    if ($MissingAgents.Count -gt 0) {
        Write-Host "Core ausentes: $($MissingAgents -join ', ')" -ForegroundColor Red
    }
    if ($MissingSpecialists.Count -gt 0) {
        Write-Host "Specialists ausentes: $($MissingSpecialists -join ', ')" -ForegroundColor Red
    }
    if ($ExtraAgents.Count -gt 0) {
        Write-Host "Extras: $($ExtraAgents -join ', ')" -ForegroundColor Red
    }
    exit 1
}

if ($Agents.Count -ne $MaxAgents) {
    Write-Host "ERRO: max_agents=$MaxAgents, mas foram encontrados $($Agents.Count) agentes." -ForegroundColor Red
    exit 1
}

$ActivationManifest.swarm["agent_count"] = $Agents.Count
$ActivationManifest.swarm["agent_ids"] = $AgentIds
$ActivationManifest.swarm["core_agent_count"] = $RequiredAgents.Count
$ActivationManifest.swarm["specialist_agent_count"] = $SpecialistAgents.Count
$ActivationManifest.swarm["activation_policy"] = "cost_aware_core_subset_specialists_on_demand"
$Universe = if ($Manifest.project.universe) { [string]$Manifest.project.universe } else { "hybrid" }
$PriorityIds = switch ($Universe) {
    "ml" {
        @("orchestration-manager", "product-strategy", "data-engineering", "data-science", "machine-learning", "testing-qa", "observability-ops", "security-compliance", "documentation")
    }
    "ia" {
        @("orchestration-manager", "product-strategy", "llm-engineering", "rag-engineering", "integration-automation", "security-compliance", "testing-qa", "observability-ops", "backend-engineering", "documentation")
    }
    default {
        @("orchestration-manager", "product-strategy", "data-engineering", "machine-learning", "llm-engineering", "rag-engineering", "integration-automation", "security-compliance", "testing-qa", "observability-ops", "backend-engineering", "documentation")
    }
}
$PriorityIds += @($ScalableAgents | Where-Object { $PriorityIds -notcontains $_ })
$ActiveAgents = @(
    $PriorityIds |
        Select-Object -First $ActiveAgentLimit |
        ForEach-Object {
            $AgentId = $_
            $Agents | Where-Object { $_.id -eq $AgentId } | Select-Object -First 1
        } |
        Where-Object { $null -ne $_ }
)
$ActivationManifest.swarm["active_agent_count"] = $ActiveAgents.Count
$ActivationManifest.swarm["active_core_agent_count"] = @($ActiveAgents | Where-Object { $_.tier -eq "core" }).Count
$ActivationManifest.swarm["active_specialist_agent_count"] = @($ActiveAgents | Where-Object { $_.tier -eq "specialist" }).Count
$ActivationManifest.swarm["active_agent_limit"] = $ActiveAgentLimit
$ActivationManifestPath = Join-Path $Root "output\ruflo_swarm_activation.json"
Write-TextFile $ActivationManifestPath ($ActivationManifest | ConvertTo-Json -Depth 10)
$SpecialistAgentDefinitions = @($Agents | Where-Object { $SpecialistAgents -contains $_.id })

if (!$SkipRufloCli) {
    Ensure-RufloRuntime

    $StepOk = Invoke-Step "Ruflo version check" {
        Invoke-Ruflo --version
    }
    if (!$StepOk) { $RuntimeHadFailures = $true }

    $StepOk = Invoke-Step "Inicializar swarm Ruflo" {
        Invoke-Ruflo swarm init --topology $Topology --max-agents $MaxAgents --strategy $Strategy
    }
    if (!$StepOk) { $RuntimeHadFailures = $true }

    $StepOk = Invoke-Step "Persistir identidade na memoria Ruflo" {
        Invoke-Ruflo memory store --namespace $MemoryNamespace --key project.identity --value "$ProjectName | $ProjectType | $SwarmName" --upsert
    }
    if (!$StepOk) { $RuntimeHadFailures = $true }

    $StepOk = Invoke-Step "Persistir swarm na memoria Ruflo" {
        Invoke-Ruflo memory store --namespace $MemoryNamespace --key project.swarm --value "$Topology | $Strategy | $MaxAgents agents" --upsert
    }
    if (!$StepOk) { $RuntimeHadFailures = $true }

    $StepOk = Invoke-Step "Persistir roteamento governado de modelos" {
        Invoke-Ruflo memory store --namespace $MemoryNamespace --key project.model-routing --value "local_first | ollama=$($Manifest.local_llm.default_model) | bridge=$($Manifest.local_llm.ruflo_governed_bridge) | sensitive_local_only=true" --upsert
    }
    if (!$StepOk) { $RuntimeHadFailures = $true }

    if ($SequentialAgents) {
        foreach ($Agent in $ActiveAgents) {
            $AgentType = Get-AgentType $Agent.domain
            $Task = "Activate $($Agent.id) for $ProjectName. Domain=$($Agent.domain). Memory=$($Agent.memory). Pattern=$($Agent.cognitive_pattern)."
            $AgentOutput = Invoke-RufloCapture "Spawn agent $($Agent.id)" {
                Invoke-Ruflo agent spawn --type $AgentType --name $Agent.id --task $Task
            }
            $AgentActivationOutputs.Add("## Agent $($Agent.id)`n`nMode: sequential`nType: $AgentType`n`n$AgentOutput")

            $MemoryOutput = Invoke-RufloCapture "Persist memory for $($Agent.id)" {
                Invoke-Ruflo memory store --namespace $MemoryNamespace --key "agent.$($Agent.id)" --value "$($Agent.id) | domain=$($Agent.domain) | type=$AgentType | memory=$($Agent.memory)" --upsert
            }
            $AgentActivationOutputs.Add("## Memory $($Agent.id)`n`n$MemoryOutput")
        }
    }
    else {
        $ParallelOutputs = Invoke-AgentActivationParallel -Agents $ActiveAgents -RufloCommand $RufloCmd -ProjectRoot $Root
        foreach ($Output in $ParallelOutputs) {
            $AgentActivationOutputs.Add($Output)
        }
    }

    $SpecialistCatalog = @(
        $SpecialistAgentDefinitions | ForEach-Object {
            @{
                id = $_.id
                domain = $_.domain
                type = (Get-AgentType $_.domain)
                activation = "on_demand"
            }
        }
    ) | ConvertTo-Json -Depth 5 -Compress
    $SpecialistMemoryOutput = Invoke-RufloCapture "Register specialist pool catalog" {
        Invoke-Ruflo memory store --namespace $MemoryNamespace --key "specialist.pool" --value $SpecialistCatalog --upsert
    }
    if ($SpecialistMemoryOutput -match "^FAILED") { $RuntimeHadFailures = $true }
    $AgentActivationOutputs.Add(
        "## Specialist Pool`n`nMode: on-demand catalog`nCount: $($SpecialistAgentDefinitions.Count)`n`n$SpecialistMemoryOutput"
    )

    $Domains = (($ActiveAgents | ForEach-Object { $_.domain } | Sort-Object -Unique) -join ",")
    $CoordinateOutput = Invoke-RufloCapture "Coordinate swarm agents" {
        Invoke-Ruflo swarm coordinate --agents $ActiveAgents.Count --domains $Domains
    }
    if ($CoordinateOutput -match "^FAILED") { $RuntimeHadFailures = $true }
    $AgentActivationOutputs.Add("## Swarm Coordinate`n`n$CoordinateOutput")

    $SwarmStatusOutput = Invoke-RufloCapture "Swarm status after activation" {
        Invoke-Ruflo swarm status --format json
    }
    if ($SwarmStatusOutput -match "^FAILED") { $RuntimeHadFailures = $true }
    $AgentActivationOutputs.Add("## Swarm Status`n`n$SwarmStatusOutput")

    $AgentListOutput = Invoke-RufloCapture "Agent list after activation" {
        Invoke-Ruflo agent list --format json
    }
    if ($AgentListOutput -match "^FAILED") { $RuntimeHadFailures = $true }
    $AgentActivationOutputs.Add("## Agent List`n`n$AgentListOutput")

    $MemoryStatsOutput = Invoke-RufloCapture "Memory stats after activation" {
        Invoke-Ruflo memory stats --format json
    }
    if ($MemoryStatsOutput -match "^FAILED") { $RuntimeHadFailures = $true }
    $AgentActivationOutputs.Add("## Memory Stats`n`n$MemoryStatsOutput")
}
else {
    Write-Host "Ruflo CLI pulado. Artefatos locais de ativacao foram criados." -ForegroundColor Yellow
}

$CommandLines = $Commands | ForEach-Object { "- ``$_``" } | Out-String
$AgentActivationDetails = $AgentActivationOutputs | Out-String

$Report = @"
# Ruflo Swarm Activation

- Project: $ProjectName
- Type: $ProjectType
- Swarm: $SwarmName
- Topology: $Topology
- Strategy: $Strategy
- Max agents: $MaxAgents
- Active agents: $($ActiveAgents.Count)
- Active core agents: $(@($ActiveAgents | Where-Object { $_.tier -eq "core" }).Count)
- Active specialist agents: $(@($ActiveAgents | Where-Object { $_.tier -eq "specialist" }).Count)
- Specialist agents available on demand: $($SpecialistAgentDefinitions.Count)
- Memory namespace: $MemoryNamespace
- Agent activation mode: $(if ($SequentialAgents) { "sequential" } else { "parallel" })
- Activated at: $ActivationDate

## Local Artifacts

- `memory/project_memory.runtime.json`
- `output/ruflo_swarm_activation.json`

## Commands

$CommandLines

## Agent Runtime Activation

Configured agents: $($Agents.Count)
Activated in this run: $($ActiveAgents.Count)
Specialist pool: $($SpecialistAgentDefinitions.Count)

$AgentActivationDetails

## Runtime Notes

The project memory is enabled in `config/runtime_manifest.json`. Ruflo CLI
execution can be skipped with `-SkipRufloCli` when working offline.
"@

Write-TextFile (Join-Path $Root "output\ruflo_swarm_activation_report.md") $Report
Write-Host "Ativacao concluida. Relatorio: output\ruflo_swarm_activation_report.md" -ForegroundColor Green

if ($AgentActivationHadFailures -or $RuntimeHadFailures) {
    Write-Host "ERRO: Uma ou mais etapas obrigatorias do Ruflo falharam. Veja output\ruflo_swarm_activation_report.md" -ForegroundColor Red
    exit 1
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ReportPath = Join-Path $Root "output\codex_ruflo_integration_check.md"
$RuntimeManifestPath = Join-Path $Root "config\runtime_manifest.json"
$RufloCmd = Join-Path $Root "node_modules\.bin\ruflo.cmd"

function Ensure-RufloRuntime {
    if (Test-Path $RufloCmd) {
        return
    }

    Write-Host "Ruflo local nao encontrado. Instalando dependencias do runtime..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $RufloCmd)) {
        Write-Host "ERRO: nao foi possivel preparar node_modules\\.bin\\ruflo.cmd." -ForegroundColor Red
        exit 1
    }
}

function Invoke-Ruflo {
    & $script:RufloCmd @args
}

function Invoke-Capture {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    try {
        $Output = & $Action 2>&1 | Out-String
        return "## $Name`n`n``````text`n$Output``````"
    }
    catch {
        return "## $Name`n`nFAILED: $($_.Exception.Message)"
    }
}

if (!(Test-Path $RuntimeManifestPath)) {
    Write-Host "ERRO: config\runtime_manifest.json nao encontrado." -ForegroundColor Red
    exit 1
}

Ensure-RufloRuntime

$Manifest = Get-Content $RuntimeManifestPath -Raw | ConvertFrom-Json
$ProjectName = $Manifest.project.name
$ProjectType = $Manifest.project.type
$SwarmName = $Manifest.swarm.name
$MemoryNamespace = $Manifest.memory.namespace
$CheckedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$Sections = New-Object System.Collections.Generic.List[string]
$Sections.Add((Invoke-Capture "Ruflo Version" { Invoke-Ruflo --version }))
$Sections.Add((Invoke-Capture "MCP Status CLI" { Invoke-Ruflo mcp status --format json }))
$Sections.Add((Invoke-Capture "Swarm Status CLI" { Invoke-Ruflo swarm status --format json }))
$Sections.Add((Invoke-Capture "Agent List CLI" { Invoke-Ruflo agent list --format json }))
$Sections.Add((Invoke-Capture "Memory Store Probe" { Invoke-Ruflo memory store --namespace $MemoryNamespace --key integration.probe --value "codex-ruflo integration probe for $ProjectName" --upsert }))
$Sections.Add((Invoke-Capture "Memory Stats CLI" { Invoke-Ruflo memory stats --format json }))

$Body = $Sections | Out-String
$Report = @"
# Codex + Ruflo Integration Check

- Project: $ProjectName
- Type: $ProjectType
- Swarm: $SwarmName
- Memory namespace: $MemoryNamespace
- Checked at: $CheckedAt

## Interpretation

This report verifies the project-level Ruflo integration through CLI and local
artifacts. Direct MCP tools inside Codex depend on the host MCP transport
remaining open. If the Codex MCP transport closes, Ruflo CLI remains the
fallback verification path.

Important Ruflo behavior observed in v3.7.0-alpha.38: agent list can show
registered agents while swarm status still reports zero attached agents. In
that case, treat agent list, swarm coordinate, and the activation report as
the registry evidence, and use a live objective/workflow for active execution.

$Body
"@

$Parent = Split-Path -Parent $ReportPath
if (!(Test-Path $Parent)) {
    New-Item -ItemType Directory -Path $Parent -Force | Out-Null
}
$Report | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host "Relatorio gerado: output\codex_ruflo_integration_check.md" -ForegroundColor Green

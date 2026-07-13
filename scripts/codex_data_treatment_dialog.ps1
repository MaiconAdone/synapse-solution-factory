param(
    [string]$InputPath = "",
    [switch]$WinsorizeOutliers,
    [switch]$SkipRufloCli,
    [switch]$SkipValidation
)

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Resolve-ProjectPath {
    param([string]$PathValue)

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return (Join-Path $Root $PathValue)
}

if ([string]::IsNullOrWhiteSpace($InputPath)) {
    $InputPath = Read-Host "Arquivo para tratar (ex.: data/raw/clientes.csv)"
}

if ([string]::IsNullOrWhiteSpace($InputPath)) {
    Write-Host "ERRO: informe um arquivo de dados." -ForegroundColor Red
    exit 1
}

$ResolvedInput = Resolve-ProjectPath $InputPath
if (!(Test-Path $ResolvedInput)) {
    Write-Host "ERRO: arquivo nao encontrado: $ResolvedInput" -ForegroundColor Red
    exit 1
}

if (!$SkipValidation) {
    Write-Host "Validando stack Synapse antes do tratamento..." -ForegroundColor Cyan
    & "$PSScriptRoot\validate_enterprise_stack.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: validacao enterprise falhou." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "Ativando Ruflo economico para tratamento de dados (pool de 15 core + 45 especialistas)..." -ForegroundColor Cyan
if ($SkipRufloCli) {
    & "$PSScriptRoot\start_ruflo_swarm.ps1" -SkipRufloCli
}
else {
    & "$PSScriptRoot\start_ruflo_swarm.ps1"
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: ativacao Ruflo falhou." -ForegroundColor Red
    exit $LASTEXITCODE
}

$OutputDir = Join-Path $Root "output\codex_dialog"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$DialogContextPath = Join-Path $OutputDir "data_treatment_request.json"
$DialogContext = @{
    source = "codex_dialog"
    task = "statistical_data_treatment"
    input_path = $ResolvedInput
    winsorize_outliers = [bool]$WinsorizeOutliers
    master_prompt = "prompts/master_data_treatment.md"
    data_treatment_policy = "config/data_treatment_policy.json"
    workflow = "new-ai-project"
    required_agents = @(
        "orchestration-manager",
        "product-strategy",
        "data-engineering",
        "data-science",
        "machine-learning",
        "llm-engineering",
        "rag-engineering",
        "backend-engineering",
        "frontend-engineering",
        "integration-automation",
        "security-compliance",
        "observability-ops",
        "devops",
        "testing-qa",
        "documentation"
    )
    instructions = @(
        "Codex recebe o pedido pela caixa de dialogo do VS Code.",
        "Aplicar prompts/master_data_treatment.md como contrato metodologico.",
        "Aplicar config/data_treatment_policy.json para separar etapas automaticas, assistidas e avancadas.",
        "Ruflo ativa um subconjunto economico dos 15 core agents e mantem 45 especialistas disponiveis sob demanda.",
        "data-engineering valida estrutura, tipos, ausentes e linhagem.",
        "data-science conduz diagnostico estatistico, outliers, distribuicoes e transformacoes.",
        "machine-learning consome somente dados tratados e relatorio antes de treino.",
        "orchestration-manager consolida decisoes e proximos passos."
    )
    created_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}
$DialogContext | ConvertTo-Json -Depth 10 | Set-Content -Path $DialogContextPath -Encoding UTF8

Write-Host "Contexto da conversa registrado em $DialogContextPath" -ForegroundColor Green

$TreatmentArgs = @(
    "$PSScriptRoot\treat_dataset.py",
    "--input",
    $ResolvedInput
)
if ($WinsorizeOutliers) {
    $TreatmentArgs += "--winsorize-outliers"
}

Write-Host "Executando tratamento estatistico..." -ForegroundColor Cyan
python @TreatmentArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: tratamento de dados falhou." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Tratamento concluido. Use Codex para revisar o relatorio e decidir proximas etapas de ML/RAG/agentes." -ForegroundColor Green

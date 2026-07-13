param(
    [Parameter(Mandatory=$true)]
    [string]$NomeProjeto,

    [string]$TipoProjeto = "b2b2c-ai-ml-agentic-saas",
    [switch]$SkipValidation,
    [switch]$SkipActivation,
    [switch]$ActivateRuflo,
    [switch]$LocalMemoryOnly
)

$Script = Join-Path $PSScriptRoot "scripts\create_ai_project.ps1"

if (!(Test-Path $Script)) {
    Write-Host "ERRO: automacao enterprise nao encontrada: $Script" -ForegroundColor Red
    exit 1
}

& $Script -NomeProjeto $NomeProjeto -TipoProjeto $TipoProjeto -Template $PSScriptRoot -SkipValidation:$SkipValidation -SkipActivation:$SkipActivation -ActivateRuflo:$ActivateRuflo -LocalMemoryOnly:$LocalMemoryOnly

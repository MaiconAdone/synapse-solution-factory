param(
    [switch]$SkipRuflo,
    [switch]$InstallPythonDeps,
    [switch]$InstallFrontendDeps
)

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Enterprise AI/ML bootstrap" -ForegroundColor Cyan

if (!(Test-Path ".mcp.json")) {
    Write-Host "ERRO: .mcp.json nao encontrado" -ForegroundColor Red
    exit 1
}

if ($InstallPythonDeps) {
    Write-Host "Instalando dependencias Python..." -ForegroundColor Cyan
    python -m pip install -r backend\requirements.txt pytest
}

if ($InstallFrontendDeps) {
    Write-Host "Instalando dependencias frontend..." -ForegroundColor Cyan
    Push-Location frontend
    npm install
    Pop-Location
}

if (!$SkipRuflo) {
    Write-Host "Validando Ruflo CLI..." -ForegroundColor Cyan
    if (!(Test-Path "node_modules\.bin\ruflo.cmd")) {
        npm install
    }
    .\node_modules\.bin\ruflo.cmd --version
}

Write-Host "Bootstrap concluido. Rode .\scripts\validate_enterprise_stack.ps1" -ForegroundColor Green

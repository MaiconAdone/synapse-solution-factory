param(
    [switch]$InstallPythonDeps
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
    python -m pip install -r requirements.txt
}

Write-Host "Bootstrap concluido. Rode .\scripts\validate_enterprise_stack.ps1" -ForegroundColor Green

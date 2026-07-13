$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Show-Header {
    Write-Host ""
    Write-Host "Synapse AI/ML Factory" -ForegroundColor Cyan
    Write-Host "1. Criar projeto IA/ML completo com Ruflo real + 60 agents"
    Write-Host "2. Criar projeto IA/ML offline apenas com memoria local"
    Write-Host "3. Validar stack atual"
    Write-Host "4. Tratar dados com Codex + Ruflo economico"
    Write-Host "5. Abrir manifesto runtime"
    Write-Host "6. Abrir agentes"
    Write-Host "7. Abrir workflows"
    Write-Host "8. Sair"
    Write-Host ""
}

function Read-ProjectUniverse {
    Write-Host ""
    Write-Host "Universo do projeto:" -ForegroundColor Cyan
    Write-Host "1. ML"
    Write-Host "2. IA"
    Write-Host "3. ML + IA (Hibrido)"
    Write-Host "4. Chatbolt"
    $Escolha = Read-Host "Escolha o universo [3]"
    switch ($Escolha) {
        "1" { return "ML" }
        "2" { return "IA" }
        "4" { return "Chatbolt" }
        default { return "ML + IA (Hibrido)" }
    }
}

while ($true) {
    Show-Header
    $Opcao = Read-Host "Escolha uma opcao"

    switch ($Opcao) {
        "1" {
            $NomeProjeto = Read-Host "Nome do novo projeto"
            if ([string]::IsNullOrWhiteSpace($NomeProjeto)) {
                Write-Host "Nome invalido." -ForegroundColor Red
                break
            }
            $TipoProjeto = Read-ProjectUniverse
            & "$PSScriptRoot\create_ai_project.ps1" -NomeProjeto $NomeProjeto -TipoProjeto $TipoProjeto -ActivateRuflo
        }
        "2" {
            $NomeProjeto = Read-Host "Nome do novo projeto"
            if ([string]::IsNullOrWhiteSpace($NomeProjeto)) {
                Write-Host "Nome invalido." -ForegroundColor Red
                break
            }
            $TipoProjeto = Read-ProjectUniverse
            & "$PSScriptRoot\create_ai_project.ps1" -NomeProjeto $NomeProjeto -TipoProjeto $TipoProjeto -LocalMemoryOnly
        }
        "3" {
            & "$PSScriptRoot\validate_enterprise_stack.ps1"
        }
        "4" {
            $InputPath = Read-Host "Arquivo para tratar (ex.: data/raw/clientes.csv)"
            if ([string]::IsNullOrWhiteSpace($InputPath)) {
                Write-Host "Arquivo invalido." -ForegroundColor Red
                break
            }
            $Winsorizar = Read-Host "Winsorizar outliers? [s/N]"
            if ($Winsorizar -match '^(s|S|sim|SIM)$') {
                & "$PSScriptRoot\codex_data_treatment_dialog.ps1" -InputPath $InputPath -WinsorizeOutliers
            }
            else {
                & "$PSScriptRoot\codex_data_treatment_dialog.ps1" -InputPath $InputPath
            }
        }
        "5" {
            code "$Root\config\runtime_manifest.json"
        }
        "6" {
            code "$Root\agents\definitions\enterprise_agents.yaml"
        }
        "7" {
            code "$Root\config\workflows\enterprise_workflows.yaml"
        }
        "8" {
            exit 0
        }
        default {
            Write-Host "Opcao invalida." -ForegroundColor Red
        }
    }
}

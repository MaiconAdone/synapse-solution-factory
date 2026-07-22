# Synapse Project Factory - Common building blocks
#
# Pure, individually testable helpers extracted from create_ai_project.ps1 so
# the project-factory decision logic stops living inside one oversized script.
# Dot-source this file to load the functions into the caller scope:
#
#   . (Join-Path $PSScriptRoot 'project_factory\ProjectFactory.Common.ps1')
#
# Resolve-ProjectUniverse is a pure function (input string -> ordered map) and
# is covered by tests/test_project_factory_universe.py.

function Resolve-ProjectUniverse {
    param([string]$Value)
    $Normalized = ($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    switch ($Normalized) {
        "ml" {
            return [ordered]@{
                universe = "ml"
                label = "ML"
                project_type = "enterprise-ml-system"
                solution_focus = "ml"
                ml_enabled = $true
                ai_enabled = $false
                rag_enabled = $false
                data_treatment_enabled = $true
                ruflo_15_agents_enabled = $true
                ruflo_core_agents = 15
                ruflo_max_agents = 60
                ruflo_specialist_agents = 45
                description = "Projeto focado em Machine Learning, dados, features, treino, avaliacao, monitoramento e producao."
            }
        }
        { $_ -in @("ia", "ai") } {
            return [ordered]@{
                universe = "ia"
                label = "IA"
                project_type = "enterprise-ai-agentic-system"
                solution_focus = "agents"
                ml_enabled = $false
                ai_enabled = $true
                rag_enabled = $true
                data_treatment_enabled = $true
                ruflo_15_agents_enabled = $true
                ruflo_core_agents = 15
                ruflo_max_agents = 60
                ruflo_specialist_agents = 45
                description = "Projeto focado em LLMs, agentes, RAG, tool calling, MCP, memoria, guardrails e observabilidade de IA."
            }
        }
        { $_ -in @("ml-ia-hibrido", "ml-ai-hybrid", "ml-ia", "ml-ai", "hibrido", "hybrid", "b2b2c-ai-ml-agentic-saas") } {
            return [ordered]@{
                universe = "hybrid"
                label = "ML + IA (Hibrido)"
                project_type = "enterprise-hybrid-ml-ai-system"
                solution_focus = "ai-ml-agents"
                ml_enabled = $true
                ai_enabled = $true
                rag_enabled = $true
                data_treatment_enabled = $true
                ruflo_15_agents_enabled = $true
                ruflo_core_agents = 15
                ruflo_max_agents = 60
                ruflo_specialist_agents = 45
                description = "Projeto hibrido que combina ML, LLMs, agentes, RAG, automacao, observabilidade e producao."
            }
        }
        { $_ -in @("chatbolt", "chat-bolt", "chat-bolt-system") } {
            return [ordered]@{
                universe = "chatbolt"
                label = "Chatbolt"
                project_type = "enterprise-chatbolt-agentic-system"
                solution_focus = "chatbots"
                ml_enabled = $false
                ai_enabled = $true
                rag_enabled = $true
                data_treatment_enabled = $true
                ruflo_15_agents_enabled = $true
                ruflo_core_agents = 15
                ruflo_max_agents = 60
                ruflo_specialist_agents = 45
                description = "Projeto focado em assistentes conversacionais, chatbots com RAG, MCP, memoria e guardrails."
            }
        }
        default {
            Write-Host "ERRO: Universo do projeto invalido: $Value" -ForegroundColor Red
            Write-Host "Use ML, IA, ML + IA (Hibrido) ou Chatbolt." -ForegroundColor Yellow
            exit 1
        }
    }
}

function Write-TextFile {
    param(
        [string]$Path,
        [string]$Content
    )
    $Parent = Split-Path -Parent $Path
    if (!(Test-Path $Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Add-KeepFile {
    param([string]$Path)
    if (!(Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
    $Keep = Join-Path $Path ".gitkeep"
    if (!(Test-Path $Keep)) {
        "" | Set-Content -Path $Keep -Encoding UTF8
    }
}

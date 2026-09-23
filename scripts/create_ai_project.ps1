param(
    [Parameter(Mandatory=$true)]
    [string]$NomeProjeto,

    [string]$TipoProjeto = "b2b2c-ai-ml-agentic-saas",
    [string]$Template = "",
    [string]$DestinoBase = (Join-Path $env:USERPROFILE "Documents\Projetos"),
    [string]$ProjectGoal = "",
    [string]$BusinessProblem = "",
    [string]$SolutionFocus = "",
    [string]$SuccessMetric = "",
    [string]$AvailableSources = "",
    [string]$RiskLevel = "",
    [switch]$SkipValidation,
    [switch]$SkipActivation,
    [switch]$LocalMemoryOnly,
    [switch]$AllowIncompleteBriefing
)

# CLAUDE.md/AGENTS.md require the dialog channel (Claude Code, Codex, VS Code
# Chat) to collect objetivo, problema de negocio, universo, metrica de
# sucesso, dados/fontes and nivel de risco before creating or implementing a
# solution, instead of inventing them. Enforce that here so a project is never
# scaffolded with a fabricated ADR just because the caller forgot to ask.
if (!$AllowIncompleteBriefing) {
    $MissingBriefingFields = @()
    if ([string]::IsNullOrWhiteSpace($BusinessProblem)) { $MissingBriefingFields += "problema de negocio (-BusinessProblem)" }
    if ([string]::IsNullOrWhiteSpace($SuccessMetric)) { $MissingBriefingFields += "metrica de sucesso (-SuccessMetric)" }
    if ([string]::IsNullOrWhiteSpace($AvailableSources)) { $MissingBriefingFields += "dados/fontes disponiveis (-AvailableSources)" }
    if ([string]::IsNullOrWhiteSpace($RiskLevel)) { $MissingBriefingFields += "nivel de risco (-RiskLevel)" }
    if ($MissingBriefingFields.Count -gt 0) {
        Write-Host "ERRO: briefing minimo incompleto para criar o projeto." -ForegroundColor Red
        Write-Host "Faltando: $($MissingBriefingFields -join ', ')" -ForegroundColor Red
        Write-Host "Pergunte esses itens ao usuario no chat antes de chamar create_ai_project.ps1." -ForegroundColor Yellow
        Write-Host "Para prototipagem deliberada sem briefing completo, use -AllowIncompleteBriefing." -ForegroundColor Yellow
        exit 1
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
        "synapse_peers_mcp.py",
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
        cost_aware_model_routing = $true
        agentic_business_transformation = $true
        simulation_first = $true
    }) -Force
    if ($RuntimeManifest.PSObject.Properties.Name -contains "cost_optimization") {
        $RuntimeManifest.cost_optimization.enabled = $true
        $RuntimeManifest.cost_optimization.policy_file = "config/cost_optimization_policy.json"
        $RuntimeManifest.cost_optimization.prefer_prompt_cache = $true
        $RuntimeManifest.cost_optimization.prefer_semantic_cache = $true
        $RuntimeManifest.cost_optimization.compress_context_before_llm = $true
        $RuntimeManifest.cost_optimization.send_only_role_specific_context = $true
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
        }
        created_at = $CreationDate
        codex_dialog_required = $true
        cost_aware_model_routing = $true
        agentic_business_transformation = $true
    }) -Force
    $Spec.execution_policy | Add-Member -NotePropertyName "cost_optimization_policy_path" -NotePropertyValue "config/cost_optimization_policy.json" -Force
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
    $CostPolicy.token_controls.prefer_prompt_cache = $true
    $CostPolicy.token_controls.prefer_semantic_cache = $true
    $CostPolicy.token_controls.compress_context_before_llm = $true
    $CostPolicy.token_controls.send_only_role_specific_context = $true
    Write-TextFile -Path $CostPolicyPath -Content ($CostPolicy | ConvertTo-Json -Depth 20)
    Write-Host "Politica de custo e roteamento de modelos configurada." -ForegroundColor Green
}

function Configure-AgentGovernance {
    $BlueprintPath = Join-Path $Destino "config\agent_blueprint_contract.json"
    $ImprovementPath = Join-Path $Destino "config\agent_improvement_loop.json"

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

    Write-Host "Governanca de agentes configurada." -ForegroundColor Green
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
            application_runtime_owned_by_synapse = $true
        }) -Force
        $Runtime.local_llm.enabled = $false
        $Runtime.local_llm.provider = "openai"
        $Runtime.local_llm.routing_strategy = "cloud_only"
        $Runtime.local_llm.default_model = "gpt-5.5"
        $Runtime.local_llm.provider_config_file = "config/model_providers.json"
        foreach ($Property in @(
            "general_model",
            "balanced_model",
            "code_review_model",
            "code_strong_model",
            "planning_strong_model",
            "reasoning_strong_model",
            "code_critical_model",
            "large_model",
            "embedding_model",
            "model_selection",
            "large_model_requires_explicit_request",
            "recommended_context_tokens_on_16gb_ram",
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
            training_dataset_path = "data/learning/training_examples.jsonl"
            promotion_requires_evals_and_human_approval = $true
        }) -Force
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    if (Test-Path $ProvidersPath) {
        $Providers = Get-Content $ProvidersPath -Raw | ConvertFrom-Json
        $Providers | Add-Member -NotePropertyName "project_context" -NotePropertyValue ([ordered]@{
            name = $NomeProjeto
            universe = $ProjectUniverse.universe
            cloud_model = "gpt-5.5"
            created_at = $CreationDate
        }) -Force
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

    Write-Host "Runtime, agentes e politicas de modelo do projeto configurados." -ForegroundColor Green
}

function Create-AssistantInheritanceArtifacts {
    $CodexInstructions = @"
# Synapse Solution Project

- Use OpenAI/Codex diretamente para triagem, resumo, classificacao, planejamento inicial e revisao de codigo.
- Trabalhe com um unico assistente por tarefa; escolha o tier de modelo conforme `config/cost_optimization_policy.json`.
- Acoes destrutivas ou externas seguem a matriz de autonomia de `config/harness_engineering_policy.json`.
- Envie apenas arquivos e trechos relevantes. Comprima contexto grande antes do modelo.
- Limite respostas normalmente a 512 tokens de saida.
- Use `synapse-peers` para trocar resumos curtos entre Codex e Claude antes de repetir contexto.
- Este projeto pertence ao universo `$($ProjectUniverse.universe)` e herda somente os artefatos de solucao aplicaveis.
- Antes de criar ou implementar qualquer funcionalidade, siga `config/business_solution_analysis.json` e `docs/briefings/business_solution_analysis.md`.
- Se o problema de negocio mudar, atualize a analise com `scripts/analyze_business_solution.py` no Synapse antes de alterar arquitetura, testes ou evals.
- A caixa de dialogo e o fluxo principal; tasks sao atalhos opcionais, nao requisito.
- Codex, Claude Code e VS Code Chat devem conduzir briefing e implementacao pela conversa local, sem exigir navegador.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os canais devem acessar a mesma Solution Factory do projeto: memoria compartilhada, `config/llm_solution_factory_policy.json`, `config/ai_framework_selection.json`, analise de solucao, governanca, testes e evals.
- Se faltar objetivo, problema de negocio, universo, metrica de sucesso, dados/fontes ou nivel de risco, pergunte ao usuario antes de implementar. Nao invente essas informacoes.
- Todo agente segue `config/harness_engineering_policy.json` (mapa de contexto, limites do loop, verificacao, observabilidade); audite com `python scripts/audit_harness.py`.
- Com RAG, siga `config/rag_scalability_policy.json` e pergunte ao usuario as decisoes de escala antes de escolher o vector database; fine-tuning so com `config/fine_tuning_policy.json` (baseline medido, dataset curado e aprovacao humana).
"@
    Write-TextFile -Path (Join-Path $Destino "AGENTS.md") -Content $CodexInstructions

    $ClaudeInstructions = @"
# Claude Instructions

Este e um projeto de solucao criado pelo Synapse no universo `$($ProjectUniverse.universe)`.

## Politica De Provedores

- Use Anthropic/Claude diretamente para resumo, classificacao, planejamento, revisao e tarefas de baixo risco.
- Acoes destrutivas ou externas seguem a matriz de autonomia de `config/harness_engineering_policy.json`.
- Leia `config/synapse_solution_contract.json`, `config/project_universe.json` e `config/cost_optimization_policy.json` antes de escolher o tier de modelo.
- Leia `config/business_solution_analysis.json` antes de decidir arquitetura, agentes, RAG, ML, testes ou evals.
- Comece com um unico assistente; papeis de workflow ficam em `config/roles.json`.
- Use o MCP `synapse-peers` para coordenar com Codex por resumos curtos, sem secrets e sem colar arquivos grandes.
- Ao concluir ou bloquear uma tarefa de chat, registre resumo curto na memoria compartilhada.

## Escopo

- A fabrica de projetos pertence ao Synapse, nao a este projeto.
- Mantenha mudancas dentro dos artefatos de solucao e dos dominios habilitados pelo universo.
- A implementacao deve seguir a analise de solucao, SDD, testes e evals gerados para este projeto.
- A conversa e o caminho principal para pedir mudancas; tasks locais sao apenas atalhos auxiliares.
- Claude Code deve perguntar pelo proprio chat quando faltar briefing; nao envie o usuario para navegador nem dependa de task do VS Code.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os canais devem acessar a mesma Solution Factory do projeto: memoria compartilhada, `config/llm_solution_factory_policy.json`, `config/ai_framework_selection.json`, analise de solucao, governanca, testes e evals.
- Se faltar contexto essencial, pergunte ao usuario no chat antes de implementar.
- Todo agente segue `config/harness_engineering_policy.json`; audite com `python scripts/audit_harness.py`.
- Com RAG, siga `config/rag_scalability_policy.json` (decisoes de escala perguntadas ao usuario, busca hibrida, indices versionados); fine-tuning so com `config/fine_tuning_policy.json` e aprovacao humana.
"@
    Write-TextFile -Path (Join-Path $Destino "CLAUDE.md") -Content $ClaudeInstructions

    $PeerRunbook = @"
# Peer Messaging Local

O MCP `synapse-peers` permite que Codex, Claude e operadores humanos compartilhem resumos curtos em SQLite local.

Use para reduzir custo por tokens:

- publique um resumo curto do estado atual;
- liste peers antes de pedir detalhes;
- envie mensagens pequenas, sem secrets e sem arquivos completos;
- solicite contexto detalhado apenas quando o resumo nao for suficiente.

Banco local: `./artifacts/peers/synapse-peers.db`.
Limite padrao: 1200 caracteres por mensagem e 360 por resumo.
"@
    Write-TextFile -Path (Join-Path $Destino "docs\runbooks\peer_messaging.md") -Content $PeerRunbook

    $Extensions = @"
{
  "recommendations": []
}
"@
    Write-TextFile -Path (Join-Path $Destino ".vscode\extensions.json") -Content $Extensions

    $Settings = @"
{
  "task.allowAutomaticTasks": "on",
  "python.defaultInterpreterPath": "`${workspaceFolder}/.venv/Scripts/python.exe",
  "python.terminal.activateEnvironment": true,
  "python.testing.pytestEnabled": true,
  "python.testing.pytestArgs": [
    "tests"
  ],
  "terminal.integrated.defaultProfile.windows": "PowerShell"
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
ALLOWED_PEER_TYPES = {"codex", "claude", "human", "other"}


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
        "Coordinate Codex, Claude and human sessions locally. "
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
            user_request_channels = @("VS Code Chat", "Claude Code", "Codex")
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
            peer_messaging = [ordered]@{
                server = "synapse-peers"
                script = "scripts/synapse_solution_peers_mcp.py"
                db_path = "./artifacts/peers/synapse-peers.db"
                max_message_chars = 1200
                max_summary_chars = 360
            }
        }) -Force
        $RequiredPaths = @($Runtime.validation.required_practice_paths)
        foreach ($RelativePath in @(
            "AGENTS.md",
            "CLAUDE.md",
            "config/llm_solution_factory_policy.json",
            "config/business_solution_analysis.json",
            "docs/briefings/business_solution_analysis.md",
            "docs/specifications/llm_solution_factory_governance.md",
            "docs/runbooks/peer_messaging.md",
            "scripts/synapse_solution_peers_mcp.py",
            ".vscode/settings.json",
            ".vscode/extensions.json",
            ".vscode/tasks.json"
        )) {
            if ($RelativePath -notin $RequiredPaths) {
                $RequiredPaths += $RelativePath
            }
        }
        $Runtime.validation.required_practice_paths = $RequiredPaths
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
    }

    Write-Host "Heranca Codex, Claude e peer messaging configurada." -ForegroundColor Green
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
        "artifacts\llm-routing",
        "artifacts\governance",
        "docs\runbooks",
        "docs\checklists",
        "memory\snapshots",
        "tests",
        "output"
    )
    if ($ProjectUniverse.rag_enabled) {
        $Paths += "artifacts\rag_indexes"
    }
    if ($ProjectUniverse.universe -eq "chatbolt") {
        $Paths += @(
            "docs\specifications\chatbot",
            "docs\runbooks\chatbot",
            "docs\checklists\chatbot",
            "prompts\chatbot",
            "artifacts\chatbot",
            "data\session_logs",
            "data\conversations"
        )
    }

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
    "cost_aware_model_routing": true,
    "governed_model_routing": true,
    "continual_learning": true,
    "tests": true,
    "evals": true
  },
  "creation_rules": {
    "managed_by": "synapse",
    "factory_capable": false,
    "contains_backend": false,
    "contains_frontend": false,
    "data_treatment_required": true,
    "sdd_required": true,
    "codex_dialog_required": true
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

- Route sensitive requests through the security-compliance review defined in `config/harness_engineering_policy.json`.
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
- [ ] The chatbot is governed by the project agent governance (config/harness_engineering_policy.json) and compliance rules.
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

    $AttachmentManifest = @"
{
  "project": "$NomeProjeto",
  "source": "scripts/create_ai_project.ps1",
  "usage": "Fotos e arquivos anexados pela task AI Factory: Anexar foto ou arquivo ao projeto aparecem aqui para o Codex e o Claude Code.",
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
- Tratamento de dados ativo: True
- Roteamento governado OpenAI/Anthropic: True
- Aprendizagem por memoria do projeto: True
- IA agentica aplicada a transformacao empresarial: True
- Descricao: $($ProjectUniverse.description)

O fluxo de tratamento estatistico de dados e base obrigatoria em todos os
universos. O universo define o foco da solucao, nao
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

## Execucao no Codex + Claude Code

- Comece com um unico assistente (Codex ou Claude Code); papeis de workflow ficam em `config/roles.json`.
- Identidade, permissoes, explicabilidade, lifecycle e matriz de autonomia seguem a secao `governance` de `config/harness_engineering_policy.json`.
- Solicitacoes usam o provedor cloud configurado (OpenAI/Anthropic) com o tier de modelo de `config/cost_optimization_policy.json`.
- Todo objetivo empresarial deve passar pelo workflow `business-transformation`
  antes de escalar automacoes ou integracoes.
- Riscos HIGH e CRITICAL exigem aprovacao humana registrada.
- Experiencias aprovadas entram na memoria do projeto; pesos do modelo nunca mudam automaticamente.
- Envie ao modelo apenas o contexto necessario para reduzir custo de tokens.
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
- Workflow: `config/workflows/synapse/business-transformation.json`.
- Perfis: `agents/definitions/business_transformation_agents.yaml`.
- Operar em simulacao antes de conectar tools MCP reais.
- Medir baseline, tempo de ciclo, retrabalho, custo por caso, adocao e resultado principal.
"@
    Write-TextFile (Join-Path $Destino "docs\specifications\ai_ml_execution_spec.md") $ExecutionSpec

    if ($ProjectUniverse.ai_enabled) {
        $FrameworkSpec = @"
# Selecao de Frameworks IA - $NomeProjeto

Este projeto usa `config/ai_framework_selection.json` para orientar Codex + Claude Code
antes de criar agentes, RAG, LLM, MCP ou workflows no-code.

## Politica

- Codex classifica o cenario da solicitacao do usuario.
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
- Muitos agentes paralelos: Swarms, LangGraph.
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
- Usar OpenAI/Anthropic diretamente para triagem, planejamento e revisao por padrao.
- Usar FastAPI e MCP servers como base para IA, Chatbolt e hibridos.
- Usar registry local de modelos e evals em projetos ML e hibridos.
- Usar RAG somente quando conhecimento confiavel, busca ou citacoes forem necessarios.
- Usar agentes somente quando houver planejamento, ferramentas, coordenacao ou execucao multi-etapas.
- Acoes externas ou destrutivas seguem a matriz de autonomia do harness.
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

    $AgentGovernanceSpec = @"
# Governanca de Agentes - $NomeProjeto

Regras de governanca vivem na secao ``governance`` de
``config/harness_engineering_policy.json``. Os agentes que rodam na solucao
ficam em ``config/solution_agents.json`` (universos com IA) e sao validados
contra ``config/agent_blueprint_contract.json``.

## Contexto

- Projeto: $NomeProjeto
- Universo: $($ProjectUniverse.label)
- ML ativo: $($ProjectUniverse.ml_enabled)
- IA ativa: $($ProjectUniverse.ai_enabled)
- RAG ativo: $($ProjectUniverse.rag_enabled)

## Matriz de Autonomia

Permitido sem aprovacao: leitura de arquivos, resumo de contexto, proposta de
arquitetura, geracao de testes, validacoes nao destrutivas e documentacao
solicitada.

Exige aprovacao humana: deletar arquivos, alterar segredos, deploy em producao,
mudar auth/permissoes e chamadas pagas externas em escala.

Proibido: exfiltrar segredos, burlar SDD, desativar seguranca, esconder falhas
de ferramentas e fabricar resultados de avaliacao.

## Gate de Criacao de Agents

Antes de criar ou alterar um agent: objetivo, ferramentas permitidas, memoria,
contexto, limites, criterios de sucesso, papel responsavel (``config/roles.json``),
evals, observabilidade e status de certificacao.
"@
    Write-TextFile (Join-Path $Destino "docs\specifications\agent_governance.md") $AgentGovernanceSpec

    $AgenticPatternsSpec = @"
# Padroes Arquiteturais Agentic - $NomeProjeto

Este projeto herda do Synapse um catalogo leve de padroes para sistemas
multiagente empresariais. O catalogo executavel fica em
`config/agentic_architectural_patterns.json`.

## Padroes Herdados

- Orchestrator Specialist: um orquestrador delega a especialistas apenas quando o dominio exige.
- Critic Reviewer Gate: risco alto passa por revisao, evals e aprovacao.
- A2A Message Contract: Codex, Claude e humanos trocam resumos
  curtos por `synapse-peers`.
- Tool Gateway: ferramentas operam com menor privilegio e auditoria.
- Model Router: agentes nao chamam LLM direto; passam pelo gateway.
- Shared Memory Retrieval: recuperar contexto aprovado antes de gastar tokens.
- Lifecycle Callbacks: eventos de ciclo de vida viram auditoria, nao chamadas
  extras de modelo.

## Regras Locais

- Comece com um unico agente.
- Cloud exige pedido explicito e aprovacao humana.
- Acoes externas ou destrutivas exigem aprovacao conforme o risco.
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
        "config/roles.json",
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

    $HarnessContractTest = @'
from pathlib import Path
import json
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_harness_is_ready_for_project_universe():
    from scripts.synapse_lib.harness_service import HarnessAuditor

    universe = json.loads((ROOT / "config/project_universe.json").read_text(encoding="utf-8-sig"))["universe"]
    report = HarnessAuditor(root=ROOT).audit()

    assert report["universe"] == universe
    assert report["harness_ready"], [item for item in report["components"] if item["status"] != "ready"]


def test_repeated_trials_separate_capability_from_reliability():
    from scripts.synapse_lib.harness_service import pass_at_k, pass_hat_k

    assert pass_at_k(3, 1, 3) == 1.0
    assert pass_hat_k(3, 1, 3) == 0.0
    assert pass_hat_k(3, 3, 3) == 1.0
'@
    Write-TextFile (Join-Path $Destino "tests\test_harness_contract.py") $HarnessContractTest

    $BusinessTransformationTest = @'
from pathlib import Path
import json
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_business_transformation_contract_workflow_and_profiles_agree():
    contract = json.loads((ROOT / "config/business_transformation.json").read_text(encoding="utf-8-sig"))
    workflow = json.loads((ROOT / "config/workflows/synapse/business-transformation.json").read_text(encoding="utf-8-sig"))
    profiles = {profile["id"]: profile for profile in contract["functional_agents"]}

    assert [step["name"] for step in workflow["steps"]] == [stage["id"] for stage in contract["workflow"]["stages"]]
    for step, stage in zip(workflow["steps"], contract["workflow"]["stages"]):
        assert step["role"] == profiles[stage["profile"]]["role"]
    yaml_ids = re.findall(r"(?m)^  - id: ([a-z-]+)$", (ROOT / "agents/definitions/business_transformation_agents.yaml").read_text(encoding="utf-8-sig"))
    assert yaml_ids == list(profiles)


def test_business_transformation_eval_cases_enforce_risk_and_approval():
    from scripts.synapse_lib.business_transformation import run_cases

    result = run_cases(ROOT / "evals/business_transformation_cases.jsonl", root=ROOT)

    assert result["passed"], [case for case in result["cases"] if not case["passed"]]
'@
    Write-TextFile (Join-Path $Destino "tests\test_business_transformation_contract.py") $BusinessTransformationTest

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


def test_rag_eval_cases_are_grounded_in_their_cited_source():
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.synapse_lib.eval_service import EvalService

    result = EvalService(root=ROOT).run_rag_eval()

    assert result["eval_type"] == "rag"
    assert result["cases_total"] > 0
    assert result["passed"], "RAG eval cases must be grounded in expected_source (faithfulness gate)"

def test_scalable_rag_and_fine_tuning_governance_is_inherited():
    for relative_path in (
        "config/rag_scalability_policy.json",
        "docs/specifications/scalable_rag_vector_db.md",
        "config/fine_tuning_policy.json",
        "docs/specifications/fine_tuning.md",
        "templates/rag/rag_pipeline.py",
        "templates/rag/vector_db_adapter.py",
        "evals/retrieval_cases.jsonl",
        "evals/tool_workflow_cases.jsonl",
    ):
        assert (ROOT / relative_path).exists(), relative_path
    policy = json.loads((ROOT / "config/fine_tuning_policy.json").read_text(encoding="utf-8-sig"))
    assert policy["provider_rules"]["automatic_weight_updates"] is False


def test_hybrid_retrieval_meets_quality_gates():
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.synapse_lib.eval_service import EvalService

    result = EvalService(root=ROOT).run_retrieval_eval()

    assert result["eval_type"] == "retrieval"
    assert result["passed"], result["metrics"]


def test_solution_runtime_agents_follow_the_blueprint_contract():
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.synapse_lib.solution_agents import validate_solution_agents

    document = json.loads((ROOT / "config/solution_agents.json").read_text(encoding="utf-8-sig"))

    assert (ROOT / "config/workflows/synapse/agent-build.json").exists()
    assert document["agents"]
    assert validate_solution_agents(document, ROOT) == []
    for agent in document["agents"]:
        if agent["authority_level"] == "external_action":
            assert agent["human_approval_required"] is True
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
            "tests/test_harness_contract.py",
            "tests/test_business_transformation_contract.py",
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

    if ($ProjectUniverse.ai_enabled) {
        # Runtime agents of the solution (not the 60 builder agents): draft
        # blueprints from the analysis, validated against the blueprint contract.
        $AgentsScaffold = Join-Path $Template "scripts\scaffold_solution_agents.py"
        & python $AgentsScaffold "--project-root=$Destino" "--force" | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERRO: blueprints dos agentes da solucao invalidos." -ForegroundColor Red
            throw "Falha ao gerar config/solution_agents.json (exit $LASTEXITCODE)."
        }
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
        "Caminho principal: converse com Codex ou Claude Code no VS Code.",
        "Use linguagem natural no chat para pedir criacao, evolucao ou implementacao.",
        "Se faltar objetivo, problema de negocio, universo, metrica/criterio, dados/fontes ou risco, o assistente deve perguntar no chat antes de implementar.",
        "Navegador e tasks sao opcionais.",
        "",
        "Use o Synapse como caixa de dialogo para pedir:",
        "",
        "- modelos de ML",
        "- agentes de IA",
        "- pipelines RAG",
        "- tratamento estatistico dos dados",
        "- anexos de fotos e arquivos para contexto do Codex",
        "- avaliacoes",
        "- documentacao",
        "- ajustes de workflows",
        "",
        "## Ambiente Virtual E .env",
        "",
        "O .venv e criado e populado com requirements.txt automaticamente na criacao do",
        "projeto (pule com -SkipActivation). Um .env real (nao versionado) tambem e",
        "criado a partir do .env.example. Para ativar o ambiente no seu terminal:",
        "",
        "~~~powershell",
        ".\.venv\Scripts\Activate.ps1",
        "~~~",
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
        "trate data/raw/seu_arquivo.csv",
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
        "Este runbook orienta operacao, incidentes e confiabilidade dos agents.",
        "",
        "## Sinais Obrigatorios",
        "",
        "- agent_id",
        "- model_tier",
        "- token_budget",
        "- cached_token_ratio",
        "- cost_per_request",
        "- latency_ms",
        "- tool_error_rate",
        "- eval_pass_rate",
        "",
        "## Triage de Incidente",
        "",
        "1. Identificar o agent afetado em config/solution_agents.json (ou o workflow em config/workflows/).",
        "2. Verificar se o tier de modelo e o orcamento respeitaram config/cost_optimization_policy.json.",
        "3. Conferir logs estruturados, tokens, latencia e erros de ferramentas.",
        "4. Confirmar se houve aprovacao humana para acoes criticas.",
        "5. Rodar testes e evals relevantes.",
        "6. Registrar causa, impacto, mitigacao e rollback.",
        "",
        "## Escalacao",
        "",
        "- Seguranca/LGPD: papel security-compliance.",
        "- RAG ou alucinacao: papel rag-engineering.",
        "- MCP/tool calling: papel integration-automation.",
        "- Custo/tokens/latencia: papel observability-ops.",
        "- ML/modelo/drift: papel machine-learning.",
        "",
        "## Guardrails Operacionais",
        "",
        "- Nunca permitir ferramenta destrutiva sem aprovacao humana.",
        "- Nunca esconder falha de tool, RAG, eval ou validacao.",
        "- Sempre preservar rastreabilidade de prompt, agent e decisao.",
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
        "- [x] .env.example e .env criados sem backend ou frontend.",
        "- [x] Ambiente virtual .venv criado e dependencias de requirements.txt instaladas.",
        "- [x] Estrutura de data/experiments/artifacts criada.",
        "- [x] Script de tratamento estatistico em scripts/treat_dataset.py.",
        "- [x] Prompt mestre de tratamento estatistico em prompts/master_data_treatment.md.",
        "- [x] Politica de tratamento em config/data_treatment_policy.json.",
        "- [x] Prompt de tratamento de dados em prompts/codex_data_treatment_dialog.md.",
        "- [x] Fluxo Codex/Claude Code para tratar dados.",
        "- [x] Fluxo de anexos para fotos e arquivos com manifesto para Codex.",
        "- [x] Camadas ML, IA, RAG, guardrails e evals copiadas do template.",
        "- [x] SDD e execucao com um unico assistente definidos como padrao.",
        "- [x] Especificacao de execucao criada em docs/specifications/ai_ml_execution_spec.md.",
        "- [x] Governanca de agentes criada em docs/specifications/agent_governance.md.",
        "- [x] Checklist de certificacao de agents criado em docs/checklists/agent_certification.md.",
        "- [x] Runbook Agent SRE criado em docs/runbooks/agent_sre.md.",
        "- [x] Codex/OpenAI e Claude Code/Anthropic configurados como provedores diretos.",
        "- [x] Roteamento de modelos OpenAI/Anthropic por tier configurado.",
        "- [x] Aprendizagem continua por memoria configurada sem atualizar pesos automaticamente.",
        "- [x] Catalogo de frameworks IA disponivel em config/ai_framework_selection.json.",
        "- [x] Projetos IA/Hibridos/Chatbolt recebem docs/specifications/ai_framework_selection.md.",
        "- [x] Projetos IA/Hibridos/Chatbolt recebem docs/specifications/technology_layer.md.",
        "- [x] Projeto marcado como nao-fabrica, sem backend e sem frontend.",
        "- [ ] Ajustar contrato de dados para o caso real.",
        $(if ($ProjectUniverse.ml_enabled) { "- [ ] Completar model card com uso pretendido e metricas reais." }),
        "- [ ] Adicionar casos especificos em evals/."
    ) | Where-Object { $null -ne $_ }
    $Checklist = $Checklist -join $NewLine
    Write-TextFile -Path (Join-Path $Destino "docs\checklists\first_project_setup.md") -Content $Checklist

    $AgentCertification = @(
        "# Checklist de Certificacao de Agent - $NomeProjeto",
        "",
        "Use este checklist antes de liberar qualquer agent para uso corporativo.",
        "",
        "## Identidade e Ownership",
        "",
        "- [ ] Agent tem id estavel em config/solution_agents.json.",
        "- [ ] Papel responsavel definido em config/roles.json.",
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
        "- [ ] Agent planeja antes de agir.",
        "- [ ] Decisoes registram racional.",
        "- [ ] Handoffs A2A documentados.",
        "- [ ] Conflitos escalam para orchestration-manager.",
        "",
        "## Observabilidade e Agent SRE",
        "",
        "- [ ] Logs estruturados definidos.",
        "- [ ] Metricas de tokens e custo definidas.",
        "- [ ] Latencia medida.",
        "- [ ] Saude do agent monitorada.",
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
    Write-TextFile -Path (Join-Path $Destino "docs\checklists\agent_certification.md") -Content $AgentCertification

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
- Escale casos sensiveis ao papel security-compliance.

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
    $FirstStepsList = [System.Collections.Generic.List[string]]::new()
    $FirstStepsList.Add('Revise `docs/checklists/first_project_setup.md`.')
    $FirstStepsList.Add('Revise `docs/specifications/ai_ml_execution_spec.md`.')
    if ($ProjectUniverse.ai_enabled) {
        $FirstStepsList.Add('Revise `docs/specifications/ai_framework_selection.md`.')
    }
    $FirstStepsList.Add('Revise `docs/AGENTIC_AI_TRANSFORMATION.md`.')
    $FirstStepsList.Add('Defina objetivo, processo, baseline, risco, owner e KPIs.')
    $FirstStepsList.Add('Ajuste `ml_systems/data_contract.yaml`.')
    $FirstStepsList.Add('Coloque dados brutos em `data/raw/`.')
    $FirstStepsList.Add('Peca ao Synapse para tratar `data/raw/seu_arquivo.csv`.')
    $FirstStepsList.Add('Atualize os casos em `evals/project_cases.jsonl`.')
    $FirstStepsList.Add('Rode `python -m pytest tests`.')
    $FirstStepsList.Add('Rode os scripts de avaliacao aplicaveis ao universo do projeto.')
    $FirstStepsIndex = 0
    $FirstStepsText = ($FirstStepsList | ForEach-Object {
        $FirstStepsIndex++
        "$FirstStepsIndex. $_"
    }) -join [Environment]::NewLine

    $Readme = @"
# $NomeProjeto

Tipo: `$TipoProjeto`

Universo: `$($ProjectUniverse.label)`

Capacidades ativas:

- ML: `$($ProjectUniverse.ml_enabled)`
- IA: `$($ProjectUniverse.ai_enabled)`
- RAG: `$($ProjectUniverse.rag_enabled)`
- Transformacao empresarial agentica: `True`
- Tratamento de dados: `True`
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
- Agentes, memoria e orquestracao executam no contexto deste projeto.

## Configuracao Principal

- `config/runtime_manifest.json`
- `config/ai_ml_enterprise_spec.json`
- `config/ai_framework_selection.json`
- `config/project_universe.json`
- `config/business_solution_analysis.json`
- `config/enterprise.yaml`
- `config/workflows/enterprise_workflows.yaml`
- `config/business_transformation.json`
- `config/workflows/synapse/business-transformation.json`

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

$FirstStepsText
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
- Data treatment enabled: True
- Slug: $ProjectSlug
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
- `.env.example` and `.env` created
- Python `.venv` created and `requirements.txt` installed (skip with -SkipActivation)
- Data, experiments, artifacts, docs, and output folders created
- Upload folders and Codex attachment manifest created
- Project model card, data contract, prompts, evals, runbooks, and checklist created
- Project tests/ contract layer created for the selected universe
- Codex data treatment prompt and task available
 - No backend or frontend copied into the solution project
 - No project factory copied into the solution project
- Roles, agent governance and blueprint contract copied into the solution project
- OpenAI/Codex and Anthropic/Claude Code configured as direct cloud providers
- Model-tier routing and project-scoped continual learning configured
- Agentic business transformation workflow, prompt, profiles and governance inherited

## Ready

Codex and Claude Code operate directly in the cloud.
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
        "config\workflows\synapse\new-ai-project.json",
        "scripts\codex_data_treatment_dialog.ps1",
        "scripts\diagnose_project.ps1",
        "scripts\import_project_file.ps1",
        "scripts\market_radar.py",
        "scripts\create_ai_project.ps1",
        "scripts\ai_factory_menu.ps1",
        "scripts\bootstrap_enterprise_stack.ps1",
        "scripts\validate_enterprise_stack.ps1",
        "scripts\synapse_peers_mcp.py"
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
            "evals\prompt_cases.jsonl",
            "evals\rag_cases.jsonl",
            "evals\retrieval_cases.jsonl",
            "evals\tool_workflow_cases.jsonl",
            "config\solution_agents.json",
            "config\workflows\synapse\agent-build.json",
            "scripts\scaffold_solution_agents.py",
            "vector_db",
            "templates\rag",
            "templates\fine_tuning",
            "config\rag_scalability_policy.json",
            "config\fine_tuning_policy.json",
            "docs\specifications\scalable_rag_vector_db.md",
            "docs\specifications\fine_tuning.md",
            "scripts\prepare_fine_tuning_dataset.py",
            "scripts\run_ai_evals.ps1",
            "scripts\run_rag_evals.ps1"
        )) {
            $Path = Join-Path $Destino $RelativePath
            if (Test-Path $Path) {
                Remove-Item -LiteralPath $Path -Recurse -Force
            }
        }
    }

    if (!$ProjectUniverse.ml_enabled) {
        # ml_systems/data_contract.yaml stays: it backs the universal data
        # treatment pipeline (tests/test_data_contract.py, generated for every
        # universe) rather than being ML-training specific. Only the
        # model-training artifacts are ML-exclusive.
        foreach ($RelativePath in @(
            "ml_systems\model_card.md",
            "ml_systems\model_card_template.md",
            "ml_systems\monitoring_plan.yaml",
            "evals\ml_cases.jsonl",
            "notebooks\foundations\math_for_ml_plan.md",
            "config\ml_foundations_policy.json",
            "docs\specifications\ml_foundations.md",
            "scripts\run_ml_evals.ps1"
        )) {
            $Path = Join-Path $Destino $RelativePath
            if (Test-Path $Path) {
                Remove-Item -LiteralPath $Path -Recurse -Force
            }
        }
    }

    $RuntimePath = Join-Path $Destino "config\runtime_manifest.json"
    if (Test-Path $RuntimePath) {
        $Runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
        $Runtime.validation.required_workflows = @(
            "solution-lifecycle",
            "business-transformation",
            $(if ($ProjectUniverse.ai_enabled) { "agent-build" }),
            $(if ($ProjectUniverse.ai_enabled) { "rag-build" }),
            $(if ($ProjectUniverse.ml_enabled) { "ml-release" })
        ) | Where-Object { $_ }
        $Runtime.validation.required_practice_paths = @(
            $Runtime.validation.required_practice_paths |
                Where-Object { Test-Path (Join-Path $Destino $_) }
        )
        Write-TextFile -Path $RuntimePath -Content ($Runtime | ConvertTo-Json -Depth 20)
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
        agents_runtime = "inherited"
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
        "tests\test_harness_contract.py",
        "tests\test_business_transformation_contract.py",
        "scripts\synapse_lib\business_transformation.py",
        "evals\business_transformation_cases.jsonl",
        "config\harness_engineering_policy.json",
        "docs\specifications\harness_engineering.md",
        "scripts\treat_dataset.py"
        "prompts\master_data_treatment.md"
        "config\roles.json"
        "agents\definitions\business_transformation_agents.yaml"
        "config\business_transformation.json"
        "config\workflows\synapse\business-transformation.json"
        "prompts\business_transformation.md"
        "docs\AGENTIC_AI_TRANSFORMATION.md"
        ".mcp.json"
        "AGENTS.md"
        "CLAUDE.md"
        "docs\runbooks\peer_messaging.md"
        "scripts\synapse_solution_peers_mcp.py"
        ".vscode\settings.json"
        ".vscode\extensions.json"
        ".vscode\tasks.json"
    )
    if ($ProjectUniverse.ml_enabled) {
        $RequiredPaths += @(
            "config\ml_foundations_policy.json",
            "docs\specifications\ml_foundations.md"
        )
    }
    if ($ProjectUniverse.ai_enabled) {
        $RequiredPaths += @(
            "config\rag_scalability_policy.json",
            "config\fine_tuning_policy.json",
            "evals\retrieval_cases.jsonl",
            "templates\rag\rag_pipeline.py",
            "config\solution_agents.json",
            "config\workflows\synapse\agent-build.json"
        )
    }
    foreach ($RelativePath in $RequiredPaths) {
        if (!(Test-Path (Join-Path $Destino $RelativePath))) {
            Write-Host "ERRO: artefato obrigatorio ausente: $RelativePath" -ForegroundColor Red
            throw "Artefato obrigatorio ausente no projeto gerado: $RelativePath"
        }
    }
    foreach ($ForbiddenPath in @("backend", "frontend", "scripts\create_ai_project.ps1")) {
        if (Test-Path (Join-Path $Destino $ForbiddenPath)) {
            Write-Host "ERRO: componente exclusivo do Synapse copiado: $ForbiddenPath" -ForegroundColor Red
            throw "Componente exclusivo do Synapse copiado para o projeto: $ForbiddenPath"
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
    $RagTask = ""
    if ($ProjectUniverse.rag_enabled) {
        $RagTask = @"
,
    {
      "label": "Evals: Rodar testes RAG (faithfulness)",
      "detail": "Verifica se as respostas esperadas em evals/rag_cases.jsonl sao rastreaveis ao expected_source, bloqueando afirmacoes sem base (alucinacao).",
      "type": "shell",
      "command": "python",
      "args": [
        "scripts/run_evals.py",
        "rag"
      ],
      "group": "test",
      "problemMatcher": []
    },
    {
      "label": "Evals: Rodar retrieval hibrido (recall@k, MRR, nDCG)",
      "detail": "Indexa o corpus local com busca hibrida BM25 + vetorial e aplica os gates de retrieval de evals/quality_gates.yaml.",
      "type": "shell",
      "command": "python",
      "args": [
        "scripts/run_evals.py",
        "retrieval"
      ],
      "group": "test",
      "problemMatcher": []
    }
"@
    }
    $Tasks = @"
{
  "version": "2.0.0",
  "tasks": [
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
    },
    {
      "label": "Synapse: Auditar harness engineering",
      "detail": "Verifica mapa de contexto, fronteira de ferramentas, limites do loop, verificacao, observabilidade e feedback do universo.",
      "type": "shell",
      "command": "python",
      "args": [
        "scripts/audit_harness.py"
      ],
      "group": "test",
      "problemMatcher": []
    }$RagTask
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

    Write-Host "Tasks VS Code do projeto configuradas." -ForegroundColor Green
}

function Activate-GeneratedProject {

    if ($SkipActivation) {
        Write-Host "Ambiente virtual Python nao criado (-SkipActivation)." -ForegroundColor Yellow
        return
    }

    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (!$PythonCommand) {
        Write-Host "Aviso: python nao encontrado no PATH; ambiente virtual nao foi criado. Crie manualmente com 'python -m venv .venv'." -ForegroundColor Yellow
        return
    }

    $VenvPath = Join-Path $Destino ".venv"
    $VenvPython = Join-Path $VenvPath "Scripts\python.exe"
    try {
        Write-Host "Criando ambiente virtual Python (.venv)..." -ForegroundColor Cyan
        & $PythonCommand.Source -m venv $VenvPath
        if ($LASTEXITCODE -ne 0 -or !(Test-Path $VenvPython)) {
            throw "python -m venv retornou codigo $LASTEXITCODE"
        }

        & $VenvPython -m pip install --upgrade pip --quiet
        $RequirementsPath = Join-Path $Destino "requirements.txt"
        if (Test-Path $RequirementsPath) {
            Write-Host "Instalando dependencias em .venv a partir de requirements.txt..." -ForegroundColor Cyan
            & $VenvPython -m pip install -r $RequirementsPath --quiet
            if ($LASTEXITCODE -ne 0) {
                throw "pip install -r requirements.txt retornou codigo $LASTEXITCODE"
            }
        }

        # Um processo filho do PowerShell nao consegue deixar o venv ativado na
        # sessao interativa de quem chamou este script; por isso o venv e criado
        # e populado aqui, mas a ativacao final e responsabilidade do usuario
        # (comando exibido no resumo final).
        Write-Host "Ambiente virtual Python criado e dependencias instaladas em .venv." -ForegroundColor Green
    }
    catch {
        Write-Host "Aviso: falha ao preparar o ambiente virtual Python. $($_.Exception.Message)" -ForegroundColor Yellow
    }
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
    Configure-RuntimeManifest
    Configure-EnterpriseSpec
    Configure-CostOptimizationPolicy
    Configure-AgentGovernance
    Configure-LocalAiRuntime
    Configure-EnterpriseYaml
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
Write-Host "Proximos comandos:" -ForegroundColor Cyan
Write-Host "  cd $Destino"
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  code ."

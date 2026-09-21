# synapse-solution-factory

Enterprise AI/ML solution factory with a cloud-native 60-agent swarm as the
multi-agent core and three official dialog channels: VS Code Chat, Claude
Code, and Codex.
Synapse is the control plane and the only project factory. Experiment tracking
uses the local model registry in `artifacts/models/`.

## Como Comecar

Requisitos: Windows com PowerShell, Python 3.12+, Git e VS Code com a extensao
Claude Code (`anthropic.claude-code`). Nao ha servidor nem chaves de API: Claude
Code e Codex usam a propria autenticacao.

```powershell
git clone https://github.com/MaiconAdone/synapse-solution-factory
cd synapse-solution-factory
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
code .
```

Validar a instalacao:

```powershell
.\.venv\Scripts\python -m pytest tests -q
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1
```

Variaveis de ambiente sao opcionais: para personalizar, `Copy-Item .env.example .env`.
Se o painel do Claude Code mostrar `spawn EINVAL`, confira em
`Preferences: Open User Settings (JSON)` se `claudeCode.claudeProcessWrapper` aponta
para um arquivo inexistente e remova-o.

## Criar Um Projeto (ML, IA, Chatbolt ou Hibrido)

Universos: `ML`, `IA`, `Chatbolt` e `ML + IA (Hibrido)`. Ha dois caminhos:

**1. Task do VS Code** — `Ctrl+Shift+P` -> `Tasks: Run Task` -> `AI Factory: Criar
projeto com Codex + swarm economico + tratamento dados`. A task pergunta nome,
universo, objetivo e problema de negocio. Ela nao coleta metrica de sucesso,
fontes de dados nem nivel de risco; preencha depois em
`config/business_solution_analysis.json` do projeto criado.

**2. Claude Code (recomendado)** — peca no chat, por exemplo:
`crie uma solucao de IA/RAG para atendimento ao cliente`. O assistente pergunta o
briefing completo (objetivo, problema, universo, metrica, dados, risco), consulta o
analisador e cria o projeto.

Pelo terminal (equivalente):

```powershell
.\scripts\create_ai_project.ps1 -NomeProjeto meu_projeto -TipoProjeto "ML" `
  -ProjectGoal "..." -BusinessProblem "..." -SuccessMetric "..." `
  -AvailableSources "..." -RiskLevel "baixo"
```

O projeto e criado em `%USERPROFILE%\Documents\Projetos` (mude com `-DestinoBase`).
Para conferir: `.\scripts\diagnose_project.ps1 -ProjectName meu_projeto`.

## Stack Oficial No VS Code

- Canais oficiais de dialogo: VS Code Chat, Claude Code e Codex,
  todos ligados a mesma Solution Factory, memoria compartilhada e governanca.
- Separacao de provedores: Claude Code usa Anthropic diretamente; Codex usa
  OpenAI. Nenhum canal delega geracao ao provedor do outro.
- Memoria compartilhada entre canais pelo MCP `synapse-peers`.
- Swarm hierarchical-mesh, 15 core agents configurados, ativacao economica e pool escalavel ate 60 agentes.
- Project Factory em `scripts/create_ai_project.ps1`.
- Memoria hibrida working/episodic/semantic.
- RAG e Vector DB em `vector_db/`.

## Arquitetura Dos Projetos

Somente o Synapse e a fabrica de projetos. O Synapse nao tem backend nem
frontend proprios; ele roda como scripts locais acionados pelo VS Code Chat,
Claude Code e Codex. Um projeto criado pelo Synapse e um workspace de solucao
administrado pelo Synapse, e nao uma copia da plataforma.

Projetos gerados:

- nao possuem `backend/` nem `frontend/`
- nao possuem Supabase ou infraestrutura web do Synapse
- nao possuem `scripts/create_ai_project.ps1`
- nao podem criar outros projetos
- possuem seu proprio runtime de swarm, configuracao MCP, memoria e agentes
- recebem dados, experimentos, prompts, evals, governanca, documentacao e
  scripts analiticos conforme o universo escolhido
- registram esse contrato em `config/synapse_solution_contract.json`

Cada projeto executa seu proprio swarm de agentes, com 15 agentes core e
45 especialistas sob demanda. O Synapse cria e administra o projeto, mas a
execucao multiagente ocorre no contexto e na memoria do proprio projeto.

Cada projeto tambem herda a camada de transformacao empresarial agentica:
perfis governados, workflow, prompt, politica de risco, orientacao de KPIs e
contratos de execucao simulation-first. Essa inteligencia nao adiciona backend
ou frontend aos projetos de solucao.

## IA Agentica Para Transformacao Empresarial

O Synapse transforma objetivos empresariais em workflows auditaveis:

```text
objetivo -> diagnostico -> processo -> oportunidades -> priorizacao
-> plano -> risco/aprovacao -> simulacao -> impacto
```

O runtime usa oito perfis funcionais sobre os 60 agentes do swarm existentes:
orquestracao, transformacao empresarial, processo, dados, automacao, KPIs,
governanca de risco e aprovacao humana.

- `LOW`: execucao automatica com auditoria.
- `MEDIUM`: execucao com validacao e auditoria.
- `HIGH`: exige aprovacao humana.
- `CRITICAL`: exige aprovacao explicita e bloqueia acoes externas automaticas.

Consulte `docs/AGENTIC_AI_TRANSFORMATION.md`.

## Criar Projetos Pelo Dialogo

Projetos sao criados pela conversa, sem tasks nem scripts manuais. Os canais
de criacao sao os chats do VS Code (VS Code Chat, Claude Code e Codex), que
tambem abrem, analisam, melhoram e editam projetos pela conversa.

Antes de criar ou implementar, o assistente pergunta no proprio chat qualquer
campo faltante do briefing minimo: objetivo, problema de negocio, universo,
metrica/criterio de aceite, dados/fontes disponiveis e risco.

Exemplo:

```text
crie uma solucao de IA/RAG para atendimento ao cliente
```

Com o briefing completo, o Synapse consulta o BusinessSolutionAnalyzer, gera
`config/business_solution_analysis.json` e segue arquitetura, testes, evals,
governanca e custo local-first. O projeto e criado localmente em
`C:\Users\<seu_usuario>\Documents\Projetos`, com `data/`, experimentos, memoria,
evals, guardrails, contratos e documentacao aplicaveis ao tipo ML, IA ou
hibrido.

Todos os canais compartilham memoria local pelo MCP `synapse-peers`, que cobre
mensagens curtas entre sessoes ativas.

### Conteudo Por Universo

- **ML:** tratamento de dados, estatistica, contratos de dados, notebooks,
  model card, metricas, monitoramento e drift.
- **IA:** prompts, agentes como contratos, RAG, retrieval evals, guardrails,
  memoria, observabilidade e governanca.
- **ML + IA:** combina os artefatos dos universos ML e IA.
- **Todos:** engenharia de IA, governanca, seguranca, qualidade, tratamento de
  dados e criterios de aceite.

## Tratamento Estatistico De Dados

Coloque arquivos brutos em `data/raw/` e converse com Codex no VS Code:

```text
trate data/raw/clientes.csv com o swarm economico e especialistas sob demanda
```

O caminho integrado e:

```text
Tasks: Run Task -> Codex: Tratar dados com swarm economico
```

Esse fluxo valida o stack, ativa um subconjunto economico dos 15 core agents, registra o contexto da
conversa e executa o tratamento estatistico. Para rodar somente o script de
tratamento sem passar pelo diagnostico do swarm, use:

```text
Tasks: Run Task -> Dados: Tratar dataset estatistico
```

Ou pelo terminal integrado:

```powershell
python .\scripts\treat_dataset.py --input .\data\raw\clientes.csv
```

O script gera dataset tratado em `data/processed/` e relatorio em
`output/data_treatment/`. Por padrao ele corrige nomes/tipos, remove
duplicatas exatas, trata ausentes com justificativa estatistica, agrupa
categorias raras e cria flags de outliers sem remove-los automaticamente.

## Project Factory

The factory engine in `scripts/create_ai_project.ps1` is invoked by the dialog
channels after the briefing is complete; it is an internal engine, not a
user-facing entry point. See `docs/vscode-workflow.md`.

The project factory configures `config/runtime_manifest.json`,
`config/enterprise.yaml`, `config/project_universe.json`,
`config/synapse_solution_contract.json`, and solution lifecycle contracts with
the project name and selected universe.

It also inherits `config/business_transformation.json`,
`config/workflows/synapse/business-transformation.json`,
`agents/definitions/business_transformation_agents.yaml`,
`prompts/business_transformation.md`, and
`docs/AGENTIC_AI_TRANSFORMATION.md`.

It also creates `.env.example`, project data/experiment/artifact folders,
project-specific prompt/eval seeds, a data contract, a model card, runbooks,
a first setup checklist, a creation report, and runs validation by default.
Artifacts that do not apply to the selected universe are removed. For example,
an IA-only project does not receive an ML model card, while an ML-only project
does not receive the RAG and AI framework layers.

The generated project contains no application backend, frontend or factory
script. It does contain its own swarm runtime, MCP configuration, memory,
workflows and agent catalog.

## Swarm Runtime Interno

O swarm usa o MCP configurado em `.mcp.json` e os workflows versionados em
`config/workflows/synapse/*.json`. O fluxo principal e pelo VS Code/Codex.
Cada projeto recebe `.mcp.json`,
`agents/definitions/enterprise_agents.yaml`
e seus contratos de workflows e memoria.

## Local Model Layer

`scripts/synapse_lib/model_service.py` includes an ML model layer for local
baselines:

- trains regression (`linear_regression`, `ridge_regression`,
  `neural_network_regression`), classification (`logistic_regression`,
  `neural_network_classifier`), and forecasting (`moving_average_forecast`,
  `seasonal_naive_forecast`) models from inline JSON data or JSONL files
- stores versioned artifacts in `artifacts/models/`
- maintains `artifacts/models/registry.json` as the local model registry and
  experiment tracking source of truth
- serves predictions through `ModelService.predict(model_id, request)`

Example training payload:

```json
{
  "model_name": "Revenue Baseline",
  "feature_columns": ["leads", "price"],
  "target_column": "revenue",
  "dataset": [
    {"leads": 1, "price": 10, "revenue": 20},
    {"leads": 2, "price": 10, "revenue": 30},
    {"leads": 3, "price": 10, "revenue": 40}
  ]
}
```

## Run Model And AI Evals

The evaluation layer is split between ML and AI prompt checks, both served by
`scripts/synapse_lib/eval_service.py` through `scripts/run_evals.py`:

- `EvalService.run_ml_eval` reads `evals/ml_cases.jsonl`, checks ML quality
  gates, and computes prediction metrics when a `model_id` is provided with
  cases that include `features` and `expected`.
- `EvalService.run_ai_eval` reads `evals/prompt_cases.jsonl`, checks prompt
  readiness, expected terms, and simple prompt-injection guards.

Both eval paths return a structured result with pass rates, metrics, and
quality gates.

From VS Code, run:

- `Evals: Rodar testes ML`
- `Evals: Rodar testes IA`

Or from PowerShell:

```powershell
.\scripts\run_ml_evals.ps1
.\scripts\run_ai_evals.ps1
```

Synapse's product goal is a no-code ML and AI agent factory: the user describes
the desired outcome to Codex in VS Code, the LLM asks for missing context, and
the swarm routes the work to specialized agents in parallel. See
`docs/architecture/no-code-ai-factory.md`.

## Enterprise Principles

The architecture incorporates production AI practices from AI engineering,
LLM engineering, prompt engineering, production LLM systems, ML systems design,
mathematics for ML, and agentic coding:

- define evals before shipping model behavior
- keep prompts, tools, retrieval, and memory versionable
- separate control plane, data plane, and application surfaces
- use typed contracts at system boundaries
- track lineage, observability, and failure modes
- make retrieval measurable with recall and faithfulness checks
- keep agents specialized but coordinated by a manager
- redesign business processes before scaling automation
- connect decisions to owners, approvals, KPIs, adoption, and value
- keep deterministic workflow state around probabilistic model reasoning

## Book-Inspired Practice Layer

The project includes executable practice artifacts inspired by AI engineering,
prompt engineering, LLM engineering, production LLMs, ML systems design,
mathematics for ML, and agentic coding:

- `playbooks/`
- `prompts/`
- `evals/`
- `llm_ops/`
- `ml_systems/`
- `rag_pipelines/`
- `guardrails/`
- `notebooks/foundations/`
- `docs/books/implementation_map.md`

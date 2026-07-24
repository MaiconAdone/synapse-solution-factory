# synapse-ai

Enterprise AI/ML solution factory with Ruflo as the multi-agent core and four
official dialog channels: VS Code Chat, AdoneX, Claude Code, and Codex.
Synapse is the control plane and the only project factory. Experiment tracking
uses the local model registry in `artifacts/models/`.

## Instalação Em Outra Máquina

Pré-requisitos: Git, PowerShell 7+, Python 3.12, Node.js 22, VS Code, Docker
Desktop (opcional) e Ollama. Em Windows, clone o repositório e execute:

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm ci
npm --prefix frontend ci
npm --prefix adonex ci
ollama pull qwen2.5-coder:3b
npm run check
```

Depois, abra a pasta clonada no VS Code e use `Tasks: Run Task`. Para a
interface web, execute `Synapse: Iniciar modo navegador independente`. O
backend usa `http://127.0.0.1:8000` e a Vick usa
`http://127.0.0.1:3000`.

Segredos e configurações locais devem ficar apenas em `.env`,
`frontend/.env.local` e `.claude/settings.local.json`; esses arquivos não são
versionados. Para criar projetos fora da pasta pai do Synapse, defina
`SYNAPSE_PROJECTS_DIR` ou informe `-DestinoBase` aos scripts. Consulte também
`docs/GUIA_DE_USO_SYNAPSE_ADONEX_VICK.md`.

## Interfaces Oficiais

O Synapse funciona de forma independente no navegador e no VS Code, com o
mesmo nucleo de agentes, projetos, dados, evals e governanca. No navegador a
interface e a Vick, assistente de voz web. No VS Code os canais sao o VS Code
Chat, o AdoneX, o Claude Code e o Codex. Consulte
`docs/dual-interface-contract.md`.

## Stack Oficial No VS Code

- Quatro canais oficiais de dialogo: VS Code Chat, AdoneX, Claude Code e Codex,
  todos ligados a mesma Solution Factory, memoria compartilhada e governanca.
- Separacao de provedores: AdoneX usa exclusivamente Ollama local; Claude Code
  usa Anthropic diretamente; Codex usa OpenAI. Nenhum canal delega geracao ao
  provedor do outro.
- Memoria compartilhada entre canais em `.adonex/memory/SHARED_DIALOG_MEMORY.md`,
  `.adonex/memory/CHAT_TASKS.md` e MCP `synapse-peers`.
- Ruflo com swarm hierarchical-mesh, 15 core agents configurados, ativacao economica e pool escalavel ate 60 agentes.
- Project Factory em `scripts/create_ai_project.ps1`.
- Memoria hibrida working/episodic/semantic.
- RAG e Vector DB em `vector_db/`.
- FastAPI apenas como runtime interno quando necessario.

## Vick - Assistente De Voz Web

A Vick e a interface de navegador do Synapse, um assistente de voz que roda no
frontend Next.js e conversa com o mesmo nucleo de governanca dos demais canais.

- Chat por voz e texto via `POST /api/vick/chat`, com Whisper local para
  transcricao e Web Speech para sintese.
- Cockpit de telemetria via `GET /api/vick/telemetry`: custo do dia, atividade
  ao vivo e gastos/tokens de Codex e Claude Code lidos do ledger de roteamento
  LLM e da memoria compartilhada.
- Narracao segura de progresso dos assistentes via `GET /api/vick/progress`,
  com quality gates de voz e tolerancia a desconexoes do polling.
- Acoes de projeto pela conversa: abrir, analisar, melhorar e editar projetos.
  A edicao real usa a ponte HTTP local do AdoneX (`127.0.0.1` + token).
- Autostart opcional controlado por `scripts/toggle_vick_autostart.py`.

## AdoneX - Editor Pro Local

O AdoneX e a extensao do VS Code em `adonex/`, um agente de engenharia 100%
local que usa exclusivamente modelos do Ollama. Nenhum prompt do AdoneX vai
para provedores de nuvem. Consulte `adonex/README.md`.

- Composer agentico multi-arquivo: plano, proposta, revisao por arquivo com
  diff nativo e aplicacao seletiva com backup e rollback.
- Edicao inline (`Ctrl+Alt+K`): reescreve somente a selecao com undo nativo.
- Autocomplete inline ghost text via fill-in-middle no Ollama, com debounce,
  cancelamento e timeout.
- Contexto rico por mencoes: `@arquivo`, `@selection`, `@file` e `@editor`.
- Chat especialista Synapse, botao parar e indicador de andamento no painel.
- Router agent e control center para roteamento economico e administracao
  local dos perfis Ollama.
- Ponte HTTP opcional para a Vick, desativada por padrao, apenas em
  `127.0.0.1` e com token obrigatorio.

## Arquitetura Dos Projetos

Somente o Synapse possui backend, frontend e fabrica de projetos. Um projeto
criado pelo Synapse e um workspace de solucao
administrado pelo Synapse, e nao uma copia da plataforma.

Projetos gerados:

- nao possuem `backend/` nem `frontend/`
- nao possuem Supabase ou infraestrutura web do Synapse
- nao possuem `scripts/create_ai_project.ps1`
- nao podem criar outros projetos
- possuem seu proprio runtime Ruflo, configuracao MCP, memoria e agentes
- recebem dados, experimentos, prompts, evals, governanca, documentacao e
  scripts analiticos conforme o universo escolhido
- registram esse contrato em `config/synapse_solution_contract.json`

Cada projeto executa seu proprio Ruflo e seus agentes, com 15 agentes core e
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

O runtime usa oito perfis funcionais sobre os 60 agentes Ruflo existentes:
orquestracao, transformacao empresarial, processo, dados, automacao, KPIs,
governanca de risco e aprovacao humana.

- `LOW`: execucao automatica com auditoria.
- `MEDIUM`: execucao com validacao e auditoria.
- `HIGH`: exige aprovacao humana.
- `CRITICAL`: exige aprovacao explicita e bloqueia acoes externas automaticas.

Endpoints:

- `POST /business/diagnosis`
- `POST /business/opportunities`
- `POST /business/transformation`
- `POST /business/transformation/{workflow_id}/approve`
- `GET /business/transformation/{workflow_id}`
- `GET /business/transformation/{workflow_id}/audit`

Consulte `docs/AGENTIC_AI_TRANSFORMATION.md`.

## Criar Projetos Pelo Dialogo

Projetos sao criados pela conversa, sem tasks nem scripts manuais. Os canais
de criacao sao os quatro chats do VS Code (VS Code Chat, AdoneX, Claude Code e
Codex) e a Vick no navegador, que tambem abre, analisa, melhora e edita
projetos por voz ou texto.

Antes de criar ou implementar, o assistente pergunta no proprio chat qualquer
campo faltante do briefing minimo: objetivo, problema de negocio, universo,
metrica/criterio de aceite, dados/fontes disponiveis e risco.

Exemplos:

```text
@adonex /projeto crie uma solucao de IA/RAG para atendimento ao cliente
```

```text
Vick, crie um projeto de ML para prever churn de clientes
```

Com o briefing completo, o Synapse consulta o BusinessSolutionAnalyzer, gera
`config/business_solution_analysis.json` e segue arquitetura, testes, evals,
governanca e custo local-first. O projeto e criado localmente em
uma pasta irmã configurável pelo usuário, com `data/`, experimentos, memoria,
evals, guardrails, contratos e documentacao aplicaveis ao tipo ML, IA ou
hibrido.

Todos os canais compartilham memoria local: pedidos e resultados ficam em
`.adonex/memory/SHARED_DIALOG_MEMORY.md` e `.adonex/memory/CHAT_TASKS.md`, e o
MCP `synapse-peers` cobre mensagens curtas entre sessoes ativas.

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
trate data/raw/clientes.csv com Ruflo economico e especialistas sob demanda
```

O caminho integrado e:

```text
Tasks: Run Task -> Codex: Tratar dados com Ruflo economico
```

Esse fluxo valida o stack, ativa um subconjunto economico dos 15 core agents, registra o contexto da
conversa e executa o tratamento estatistico. Para rodar somente o script de
tratamento sem ativar Ruflo, use:

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
`config/workflows/ruflo/business-transformation.json`,
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
script. It does contain its own Ruflo runtime, MCP configuration, memory,
workflows and agent catalog.

## Ruflo Runtime Interno

O Ruflo usa o MCP configurado em `.mcp.json` e os workflows versionados em
`config/workflows/ruflo/*.json`. O fluxo principal e pelo VS Code/Codex, nao
por navegador. Cada projeto recebe `.mcp.json`,
`scripts/start_ruflo_swarm.ps1`, `agents/definitions/enterprise_agents.yaml`
e seus contratos de workflows e memoria.

## Local Model Layer

The backend includes an ML model layer for local baselines:

- trains regression (`linear_regression`, `ridge_regression`,
  `neural_network_regression`), classification (`logistic_regression`,
  `neural_network_classifier`), and forecasting (`moving_average_forecast`,
  `seasonal_naive_forecast`) models from inline JSON data or JSONL files
- stores versioned artifacts in `artifacts/models/`
- maintains `artifacts/models/registry.json` as the local model registry and
  experiment tracking source of truth
- serves predictions through `POST /models/{model_id}/predict`

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

The evaluation layer is split between ML and AI prompt checks:

- `POST /evals/ml` reads `evals/ml_cases.jsonl`, checks ML quality gates,
  and computes prediction metrics when a `model_id` is provided with cases that
  include `features` and `expected`.
- `POST /evals/ai` reads `evals/prompt_cases.jsonl`, checks prompt readiness,
  expected terms, and simple prompt-injection guards.

Both eval paths return structured API responses with pass rates, metrics,
and quality gates.

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
Ruflo routes the work to specialized agents in parallel. See
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

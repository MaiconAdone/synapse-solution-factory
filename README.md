# synapse-solution-factory

Fabrica enterprise de solucoes de IA/ML. O Synapse e o plano de controle e a
unica fabrica de projetos: a partir de um briefing feito no chat, ele analisa o
problema de negocio, escolhe a arquitetura e gera um projeto de solucao
governado para um de quatro universos: **ML**, **IA**, **Chatbolt** ou
**ML + IA (Hibrido)**.

- Canais oficiais de dialogo: **VS Code Chat**, **Claude Code** e **Codex**,
  todos ligados a mesma Solution Factory, memoria compartilhada e governanca.
- Um unico assistente por tarefa, com governanca de agentes e roteamento de
  modelos por custo.
- Sem backend, frontend ou chaves de API: roda como scripts locais; Claude Code
  e Codex usam a propria autenticacao.

## Indice

1. [Como comecar](#1-como-comecar)
2. [Criar um projeto](#2-criar-um-projeto)
3. [Arquitetura](#3-arquitetura)
4. [Universos e conteudo gerado](#4-universos-e-conteudo-gerado)
5. [Engenharia de IA](#5-engenharia-de-ia)
   - [RAG escalavel e vector database](#51-rag-escalavel-e-vector-database)
   - [Fine-tuning e adaptacao de modelos](#52-fine-tuning-e-adaptacao-de-modelos)
   - [Harness engineering](#53-harness-engineering)
   - [Selecao de tecnologias e templates](#54-selecao-de-tecnologias-e-templates)
   - [Agentes da solucao (runtime)](#55-agentes-da-solucao-runtime)
6. [Governanca de agentes e custo](#6-governanca-de-agentes-e-custo)
7. [IA agentica para transformacao empresarial](#7-ia-agentica-para-transformacao-empresarial)
8. [Tratamento estatistico de dados](#8-tratamento-estatistico-de-dados)
9. [Camada local de modelos ML](#9-camada-local-de-modelos-ml)
10. [Evals e quality gates](#10-evals-e-quality-gates)
11. [Testes e validacao](#11-testes-e-validacao)
12. [Base de livros](#12-base-de-livros)
13. [Estrutura do repositorio](#13-estrutura-do-repositorio)
14. [Referencia rapida de comandos](#14-referencia-rapida-de-comandos)

---

## 1. Como comecar

Requisitos: Windows com PowerShell, Python 3.12+, Git e VS Code com a extensao
Claude Code (`anthropic.claude-code`).

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
`Preferences: Open User Settings (JSON)` se `claudeCode.claudeProcessWrapper`
aponta para um arquivo inexistente e remova-o.

## 2. Criar um projeto

### Briefing minimo

Antes de criar ou implementar, o assistente pergunta no proprio chat qualquer
campo faltante, sem inventar:

| Campo | Parametro do script |
|-------|---------------------|
| Objetivo | `-ProjectGoal` |
| Problema de negocio | `-BusinessProblem` |
| Universo | `-TipoProjeto` (`ML`, `IA`, `Chatbolt`, `ML + IA (Hibrido)`) |
| Metrica de sucesso / criterio de aceite | `-SuccessMetric` |
| Dados ou fontes disponiveis | `-AvailableSources` |
| Nivel de risco | `-RiskLevel` |

Em projetos com RAG, o assistente tambem pergunta as **decisoes de escala**
(volume do corpus, QPS, latencia, multi-tenant, sensibilidade dos dados e
hospedagem) antes de escolher o vector database. Veja a [secao 5.1](#51-rag-escalavel-e-vector-database).

### Caminhos

**1. Claude Code, Codex ou VS Code Chat (recomendado)**: peca no chat, por exemplo:

```text
crie uma solucao de IA/RAG para atendimento ao cliente
```

O assistente coleta o briefing, consulta o `BusinessSolutionAnalyzer`, gera a
analise (ADR) e cria o projeto.

**2. Task do VS Code**: `Ctrl+Shift+P` -> `Tasks: Run Task` -> `AI Factory: Criar
projeto com Codex + tratamento dados`. A task pergunta o briefing minimo
completo: nome, universo, objetivo, problema de negocio, metrica de sucesso,
fontes de dados e nivel de risco. O menu `AI Factory: Menu interativo` pede os
mesmos campos e nao cria o projeto se algum ficar vazio.

**3. Terminal (motor interno usado pelos chats)**:

```powershell
.\scripts\create_ai_project.ps1 -NomeProjeto meu_projeto -TipoProjeto "IA" `
  -ProjectGoal "..." -BusinessProblem "..." -SuccessMetric "..." `
  -AvailableSources "..." -RiskLevel "baixo"
```

O script recusa briefing incompleto (use `-AllowIncompleteBriefing` apenas para
prototipos deliberados) e faz rollback do diretorio se qualquer fase falhar.
O projeto e criado em `%USERPROFILE%\Documents\Projetos` (mude com `-DestinoBase`).

Conferir o projeto criado:

```powershell
.\scripts\diagnose_project.ps1 -ProjectName meu_projeto
```

### Fluxo de criacao

```text
briefing no chat -> analisador de solucao (ADR) -> gate SDD -> selecao de tecnologias
-> fabrica gera o projeto -> testes do proprio projeto -> diagnose_project
```

## 3. Arquitetura

Somente o Synapse e a fabrica de projetos. Um projeto gerado e um workspace de
solucao administrado pelo Synapse, nao uma copia da plataforma.

Projetos gerados:

- nao possuem `backend/`, `frontend/`, Supabase nem infraestrutura web;
- nao possuem `scripts/create_ai_project.ps1` e nao podem criar outros projetos;
- possuem seu proprio `.mcp.json`, memoria, workflows, papeis
  (`config/roles.json`) e governanca de agentes,
  mais os agentes da propria solucao em `config/solution_agents.json` nos
  universos com IA;
- recebem dados, experimentos, prompts, evals, governanca, documentacao e
  scripts analiticos **conforme o universo** (artefatos que nao se aplicam sao
  removidos);
- registram o contrato em `config/synapse_solution_contract.json` e o universo
  em `config/project_universe.json`;
- criam `.env.example`, `.env` (ignorado pelo git) e `.venv` com
  `requirements.txt` instalado (pule com `-SkipActivation`).

Principais contratos do Synapse:

| Arquivo | Papel |
|---------|-------|
| `config/llm_solution_factory_policy.json` | Fluxo obrigatorio de todos os assistentes |
| `config/business_solution_catalog.json` | Arquetipos de negocio ML/IA |
| `scripts/synapse_lib/business_solution_analyzer.py` | Analisador de solucao (ADR) |
| `config/ai_framework_selection.json` | Catalogo de frameworks e tecnologias |
| `config/runtime_manifest.json` | Runtime, governanca de agentes, memoria, RAG, fine-tuning, harness |
| `config/cost_optimization_policy.json` | Tier de modelo, orcamento de tokens e custo |
| `config/ai_ml_enterprise_spec.json` | Especificacao enterprise IA/ML |

Memoria: hibrida (working, episodic, semantic), compartilhada entre canais pelo
MCP `synapse-peers` (`scripts/synapse_peers_mcp.py`) e pelo handoff curto em
`memory/codex-vscode-context.md`. Separacao de provedores: Claude Code usa
Anthropic e Codex usa OpenAI; nenhum canal delega geracao ao outro.

## 4. Universos e conteudo gerado

| Recurso | ML | IA | Chatbolt | Hibrido |
|---------|:--:|:--:|:--------:|:-------:|
| Tratamento de dados, contratos, testes, evals, governanca | sim | sim | sim | sim |
| Harness engineering (auditoria + `test_harness_contract.py`) | sim | sim | sim | sim |
| ML foundations, model card, monitoramento e drift | sim | - | - | sim |
| Prompts, agentes, guardrails, LLM ops | - | sim | sim | sim |
| Agentes da solucao (`config/solution_agents.json`, workflow `agent-build`) | - | sim | sim | sim |
| RAG escalavel, `vector_db/`, `templates/rag/`, retrieval evals | - | sim | sim | sim |
| Governanca de fine-tuning | - | sim | sim | sim |
| Chatbot: handoff, memoria de sessao, evals de conversa | - | - | sim | - |

- **ML:** dados, estatistica, features, baseline, experimentos, model card,
  metricas, monitoramento e drift (`config/ml_foundations_policy.json`).
- **IA:** LLMs, agentes como contratos, RAG, MCP, tool calling, memoria,
  guardrails e observabilidade.
- **Chatbolt:** assistentes conversacionais com RAG quando ha conhecimento
  confiavel, handoff, memoria de sessao e guardrails.
- **Hibrido:** modelos preditivos mais LLM/RAG/agentes, compartilhando
  contratos, testes, evals e governanca.

## 5. Engenharia de IA

Cada capacidade segue o mesmo padrao: **politica JSON como fonte de verdade ->
especificacao -> codigo testavel -> integracao no analisador -> heranca pelos
projetos gerados**.

### 5.1 RAG escalavel e vector database

- Politica: `config/rag_scalability_policy.json`
- Especificacao: `docs/specifications/scalable_rag_vector_db.md`

**Decisoes perguntadas ao usuario** (o analisador as devolve em
`rag_scalability.plan.pending_user_decisions`, nunca as adivinha): volume do
corpus em 12 meses, QPS de pico, latencia p95, isolamento multi-tenant,
sensibilidade dos dados, hospedagem e banco ja existente.

**Tiers de escala:**

| Tier | Chunks | Indice padrao | Candidatos |
|------|--------|---------------|------------|
| local | ate 100 mil | flat (exato) | synapse-local, FAISS, Chroma |
| team | ate 5 mi | HNSW | pgvector, Qdrant, Chroma |
| enterprise | ate 100 mi | HNSW + quantizacao int8 | Qdrant, Weaviate, Milvus, Pinecone |
| massive | acima de 100 mi | IVF-PQ ou DiskANN | Milvus, Pinecone |

Regras de selecao: reaproveitar Postgres via pgvector; reaproveitar
OpenSearch/Elasticsearch para busca hibrida nativa; excluir servico gerenciado
em nuvem para dados confidenciais/restritos ou hospedagem propria; preferir
stores com namespaces/tenants quando houver isolamento.

**Pipeline de recuperacao:** filtro de metadados e ACL **antes** do ranking ->
busca densa + BM25 -> fusao por reciprocal rank (k=60) -> rerank apenas com
confianca abaixo de 0.72 -> top 6 chunks com fontes para citacao.

**Ciclo de vida do indice:** nome `{colecao}__{modelo_embedding}__v{versao}`
servido por alias; nunca misturar modelos de embedding num indice; reindexacao
blue/green; ingestao incremental por `content_hash` com remocao de chunks
obsoletos.

**Implementacao de referencia** (so numpy, para bootstrap e evals offline):

| Modulo | Conteudo |
|--------|----------|
| `scripts/synapse_lib/vector_store.py` | Protocolo `VectorStore`, `HashingEmbedder` deterministico, `InMemoryVectorStore` com filtros e ACL |
| `scripts/synapse_lib/rag_retrieval.py` | Chunking com ids estaveis, BM25, RRF, `HybridRetriever`, recall@k/MRR/nDCG |
| `scripts/synapse_lib/rag_scalability.py` | `RagScalabilityPlanner`: tier, vector DB, indice e estimativa de memoria |
| `templates/rag/rag_pipeline.py` | Pipeline local executavel com citacoes |
| `templates/rag/vector_db_adapter.py` | Adaptadores pgvector e Qdrant para o mesmo protocolo |

```powershell
python .\templates\rag\rag_pipeline.py --query "como versionar indices?"
python .\scripts\run_evals.py retrieval
```

> O `HashingEmbedder` e lexical, nao semantico. Em producao, troque por um
> modelo de embedding real atras da mesma interface e rode os mesmos gates.

### 5.2 Fine-tuning e adaptacao de modelos

- Politica: `config/fine_tuning_policy.json`
- Especificacao: `docs/specifications/fine_tuning.md`
- Card de decisao: `templates/fine_tuning/model_adaptation_card.md`

**Escada de adaptacao:** prompt engineering -> RAG -> fine-tuning ->
continued pretraining. Lacuna de conhecimento vai para RAG; lacuna de
comportamento/formato/custo vai para fine-tuning. Tecnicas: SFT, LoRA/QLoRA,
preference tuning (DPO), distilacao, fine-tuning de embeddings e de rerankers.

**Bloqueios:** sem eval set, sem baseline medido de prompt + RAG, dataset abaixo
do minimo (50 piloto / 500 producao), dados pessoais ou segredos nao resolvidos,
dados restritos saindo do ambiente aprovado ou sem rollback para o modelo base.

**Gates de release:** ganho relativo minimo de 5% sobre o baseline, sem
regressao de seguranca/injecao/fidelidade, custo e latencia no orcamento,
aprovacao humana, rollout shadow/canary e rollback. `automatic_weight_updates`
permanece `false`.

Preparar um dataset (valida, deduplica, remove PII, separa treino/validacao sem
vazamento; **nao treina** nem chama provedor):

```powershell
python .\scripts\prepare_fine_tuning_dataset.py --input data\learning\training_examples.jsonl --tier pilot
```

Saidas em `artifacts/fine_tuning/`: `train.jsonl`, `validation.jsonl` e
`readiness_report.json`. O `AdaptationAdvisor`
(`scripts/synapse_lib/fine_tuning_service.py`) recomenda o degrau da escada no
analisador.

### 5.3 Harness engineering

- Politica: `config/harness_engineering_policy.json`
- Especificacao: `docs/specifications/harness_engineering.md`
- Card por agente: `templates/harness/agent_harness_spec.md`

O harness e tudo o que envolve o modelo para que o agente seja confiavel. Tres
camadas: harness dos agentes de codigo (Claude Code/Codex), harness de runtime
dos agentes da solucao e harness de avaliacao.

| Componente | Evidencia | Universos |
|------------|-----------|-----------|
| context_map | `AGENTS.md`, `CLAUDE.md`, `config/context_policy.json` | todos |
| tool_boundary | `config/harness_engineering_policy.json`, `guardrails/policy.yaml` | todos |
| control_loop | `config/cost_optimization_policy.json`, `config/agent_blueprint_contract.json` | todos |
| verification | `tests/`, `evals/quality_gates.yaml` | todos |
| agent_evals | `evals/tool_workflow_cases.jsonl` | IA, Chatbolt, Hibrido |
| agent_blueprints | `config/solution_agents.json`, `config/workflows/synapse/agent-build.json` | IA, Chatbolt, Hibrido |
| observability | `llm_ops/observability.yaml` | IA, Chatbolt, Hibrido |
| feedback_loop | `config/agent_improvement_loop.json` | todos |
| safe_execution | `config/business_transformation.json` | todos |

Limites padrao do loop: 25 passos, 40 chamadas de ferramenta, 2 retries por
ferramenta, deteccao de loop apos 3 repeticoes e 600 s de timeout. Casos de
agente rodam 3 tentativas: **pass@k** mede capacidade e **pass^k** mede
confiabilidade (gate de release: pass^k >= 0.8).

```powershell
python .\scripts\audit_harness.py            # universo lido de config/project_universe.json
python .\scripts\audit_harness.py --universe ia
```

### 5.4 Selecao de tecnologias e templates

`config/ai_framework_selection.json` tem os 14 frameworks (LangGraph,
LlamaIndex, Haystack, OpenAI Agents SDK, Pydantic AI, CrewAI, AutoGen,
Microsoft Agent Framework/Semantic Kernel, Dify, Flowise, RAGFlow, R2R, MCP SDKs,
Swarms) e o `technology_catalog` (inclui Vector DBs, RAG frameworks,
Fine-tuning/PEFT e Agent/Eval Harness). O seletor
(`scripts/synapse_lib/ai_framework_selector.py`) escolhe por cenario, nunca
instala tudo.

- `solution_templates`: arquivos que existem em `templates/` para copiar/adaptar.
- `solution_scaffold_targets`: arquivos que o projeto gerado deve criar quando
  nao ha template pronto no Synapse.

Veja `docs/specifications/technology_layer.md` e `templates/README.md`.

### 5.5 Agentes da solucao (runtime)

Os agentes da solucao rodam dentro do produto IA/Chatbolt/Hibrido (ex.:
assistente que consulta pedidos e abre ocorrencias). Nao confunda com os papeis
de `config/roles.json`, que so indicam quem responde por cada etapa de
workflow durante a construcao.

Nos universos IA, Chatbolt e Hibrido, a fabrica gera `config/solution_agents.json`
a partir do ADR, validado contra `config/agent_blueprint_contract.json`:

- **single agent first**: um `solution-orchestrator` quando basta um dominio;
- **orquestrador + especialistas** quando ha RAG e execucao de acoes:
  `solution-orchestrator` (drafting), `knowledge-retriever` (advisory, so
  responde com fontes citadas) e `action-executor` (external_action, **exige
  aprovacao humana**);
- cada blueprint define objetivo, tier de modelo (economy/balanced/strong via
  OpenAI/Anthropic), ferramentas, memoria, limites, papel responsavel, evals, orcamento de
  tokens, autoridade, regra de escalonamento e gate pass^k;
- as ferramentas do executor **nao sao inventadas**: ficam em
  `pending_user_decisions` (inventario, permissoes e matriz de aprovacao) ate o
  usuario confirmar no chat.

O ciclo de construcao segue o workflow `config/workflows/synapse/agent-build.json`
(decidir single/multiagente -> blueprints -> confirmar ferramentas com o
usuario -> contratos MCP -> threat model -> retrieval -> evals -> pass^k ->
auditoria -> aprovacao humana).

```powershell
python .\scripts\scaffold_solution_agents.py --project-root . --force   # gerar a partir do ADR
python .\scripts\scaffold_solution_agents.py --validate-only            # validar contra o contrato
```

O universo escolhido pelo usuario e o que a fabrica gera (`effective_universe`).
Se o analisador sugerir outro (`recommended_universe`), o ADR registra
`universe_confirmation` para o assistente confirmar no chat, e todos os
artefatos, testes e papeis seguem o universo efetivo.

## 6. Governanca de agentes e custo

- **Um unico assistente por tarefa** (Claude Code ou Codex). Nao ha swarm,
  fleets nem perfis de ativacao de agentes.
- **Papeis** (`config/roles.json`): 16 responsabilidades usadas pelos
  workflows em `config/workflows/synapse/*.json` para dizer quem responde por
  cada etapa (orchestration-manager, product-strategy, data-engineering,
  rag-engineering, security-compliance, testing-qa...). Papel nao e agente em
  execucao.
- **Governanca** (`config/harness_engineering_policy.json`, secao
  `governance`): identidade, menor privilegio, aprovacao humana para acao
  destrutiva ou externa, explicabilidade, lifecycle e matriz de autonomia.
- **Custo** (`config/cost_optimization_policy.json`, `request_profiles`):

| Perfil | Tier de modelo | Orcamento de tokens | Uso |
|--------|----------------|---------------------|-----|
| simple | economy | 1200 | pergunta curta, pequena correcao |
| standard | balanced | 3000 | implementacao comum, ML simples |
| advanced | balanced | 5000 | RAG, MCP, fluxo hibrido |
| enterprise | strong | 8000 | producao, seguranca, LGPD |
| extreme | strong | 16000 | auditoria |

- Contratos complementares: `config/agent_blueprint_contract.json` (campos de
  todo agente da solucao, com `owner_role`),
  `config/agentic_architectural_patterns.json` e
  `config/agent_improvement_loop.json`.
- Projetos gerados recebem `docs/specifications/agent_governance.md`,
  `docs/checklists/agent_certification.md` e `docs/runbooks/agent_sre.md`.

## 7. IA agentica para transformacao empresarial

O Synapse transforma objetivos empresariais em workflows auditaveis, executados
por uma maquina de estados deterministica
(`scripts/synapse_lib/business_transformation.py`, so biblioteca padrao):

```text
intake -> diagnosis -> process_mapping -> data_readiness -> opportunity_identification
-> prioritization -> automation_architecture -> kpi_design -> execution_planning
-> risk_governance -> human_approval -> simulation -> impact_evaluation -> final_report
```

- **Oito perfis funcionais** (Orchestrator, BusinessTransformation, ProcessMapping,
  DataAnalysis, AutomationArchitect, KPIMonitor, RiskGovernance, HumanApproval),
  cada um ligado a um papel de `config/roles.json`.
- **Fonte unica:** `config/business_transformation.json`; workflow e YAML de
  perfis sao espelhos verificados por teste.
- **Nada e inventado:** owner, processo, baseline/meta dos KPIs
  (`cycle_time`, `rework_rate`, `cost_per_case`, `primary_business_outcome`,
  `adoption_rate`), notas 1-5 e fatores de risco viram `pending_user_decisions`.
- **Risco por regras explicitas:**

| Nivel | Quando | Autonomia |
|-------|--------|-----------|
| `CRITICAL` | decisao regulada (credito, contratacao, saude...), irreversivel com efeito externo, impacto >= 1.000.000 | bloqueia acao externa; com aprovacao, so simulacao |
| `HIGH` | efeito externo, irreversivel, dados pessoais, voltado ao cliente, impacto >= 100.000, ou fatores ausentes | exige aprovacao humana |
| `MEDIUM` | escreve em sistema interno ou >= 1000 casos/mes | automatica com validacao e auditoria |
| `LOW` | nenhum fator | automatica com auditoria |

- **Priorizacao:** `0.4*valor + 0.2*prontidao + 0.2*simplicidade + 0.2*seguranca`.
- **Simulation-first:** tools (`kpi_tool`, `process_tool`, `data_tool`,
  `automation_tool`) rodam simuladas; execucao real exige tool MCP com
  identidade, permissao, idempotencia, auditoria, compensacao e aprovacao.
- O analisador reconhece pedidos de transformacao (processo, retrabalho, tempo
  de ciclo, backoffice, KPIs) e adiciona os papeis empresariais
  (business-value-analyst, metrics-instrumentation, policy-guardrails-engineer).

```powershell
python .\scripts\run_business_transformation.py --brief templates\business\transformation_brief.json
python .\scripts\run_business_transformation.py --cases evals\business_transformation_cases.jsonl
```

Todos os universos herdam essa camada, com o teste
`tests/test_business_transformation_contract.py`. Detalhes em
`docs/AGENTIC_AI_TRANSFORMATION.md`.

## 8. Tratamento estatistico de dados

Coloque arquivos brutos em `data/raw/` e peca no chat:

```text
trate data/raw/clientes.csv
```

Ou use `Tasks: Run Task -> Codex: Tratar dados` (valida o
stack e registra contexto) ou `Dados: Tratar dataset estatistico` (so o script):

```powershell
python .\scripts\treat_dataset.py --input .\data\raw\clientes.csv
```

Gera dataset tratado em `data/processed/` e relatorio em
`output/data_treatment/`. Por padrao corrige nomes/tipos, remove duplicatas
exatas, trata ausentes com justificativa estatistica, agrupa categorias raras e
marca outliers por z-score sem remove-los. Limites em
`config/data_treatment_policy.json`.

## 9. Camada local de modelos ML

`scripts/synapse_lib/model_service.py` treina baselines locais:

- regressao (`linear_regression`, `ridge_regression`,
  `neural_network_regression`), classificacao (`logistic_regression`,
  `neural_network_classifier`) e series temporais (`moving_average_forecast`,
  `seasonal_naive_forecast`), a partir de JSON inline ou JSONL;
- artefatos versionados em `artifacts/models/` e registry local em
  `artifacts/models/registry.json` (fonte de verdade de experimentos);
- predicao via `ModelService.predict(model_id, request)`.

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

## 10. Evals e quality gates

Todas as suites rodam por `scripts/run_evals.py` (servidas por
`scripts/synapse_lib/eval_service.py`) e usam os gates de
`evals/quality_gates.yaml`:

| Suite | Casos | O que verifica |
|-------|-------|----------------|
| `ml` | `evals/ml_cases.jsonl` | Gates de ML; metricas de predicao com `--model-id` |
| `ai` | `evals/prompt_cases.jsonl` | Prompt existe, termos esperados, guarda de prompt injection |
| `rag` | `evals/rag_cases.jsonl` | Fidelidade: cada termo da resposta esperada esta na fonte citada |
| `retrieval` | `evals/retrieval_cases.jsonl` | Busca hibrida real: recall@k, MRR e nDCG |

Outros conjuntos: `evals/tool_workflow_cases.jsonl` (ferramentas, aprovacao,
injecao, loops), `evals/voice_agent_cases.jsonl` e
`evals/agentic_coding_cases.jsonl`. Secoes de gates: `prompt`, `rag`, `ml`,
`llm_ops`, `retrieval`, `fine_tuning`, `agent_harness`.

```powershell
python .\scripts\run_evals.py ml
python .\scripts\run_evals.py ai
python .\scripts\run_evals.py rag
python .\scripts\run_evals.py retrieval
```

No VS Code: `Evals: Rodar testes ML`, `Evals: Rodar testes IA`,
`Evals: Rodar testes RAG`. Projetos gerados com RAG tambem recebem
`Evals: Rodar retrieval hibrido (recall@k, MRR, nDCG)`, e todos recebem
`Synapse: Auditar harness engineering`.

## 11. Testes e validacao

```powershell
.\.venv\Scripts\python -m pytest tests -q
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1
```

- `tests/test_project_factory_contracts.py`: gera projetos dos 4 universos e
  roda os testes de cada um.
- `tests/test_project_factory_rollback.py` e
  `tests/test_project_factory_universe.py`: rollback e resolucao de universo.
- `tests/test_ai_engineering_extensions.py`: vector store, busca hibrida,
  planner de escala, fine-tuning, harness, ausencia de swarm/fleets e um guarda
  que falha se qualquer config ou documento citar caminho inexistente.
- `validate_enterprise_stack.ps1`: caminhos obrigatorios, contratos do runtime,
  papeis dos workflows, coerencia de politicas e gates de retrieval.

O CI (`.github/workflows/ci.yml`) executa a validacao e os testes a cada push.
O analisador de solucao roda apenas com a biblioteca padrao do Python, pois a
fabrica o chama com o `python` do PATH.

## 12. Base de livros

O Synapse traduz licoes de livros em contratos executaveis, sem copiar texto.
Mapa completo em `docs/books/implementation_map.md`.

| Tema | Referencias | Onde vira codigo/contrato |
|------|-------------|---------------------------|
| AI engineering, evals, feedback | AI Engineering (Chip Huyen) | `evals/`, analisador |
| RAG escalavel e vector DB | LLM Engineer's Handbook, AI Engineering, CLRS | `config/rag_scalability_policy.json` |
| Fine-tuning | AI Engineering, LLM Engineer's Handbook, Build a LLM From Scratch | `config/fine_tuning_policy.json` |
| Harness engineering | Production LLMs, Building Applications with AI Agents, Cybernetics | `config/harness_engineering_policy.json` |
| ML foundations | Foundations of ML (lecture notes), Designing ML Systems | `config/ml_foundations_policy.json` |
| Agentes e orquestracao | AI Agents in Action, Society of Mind, Agentic Architectural Patterns | `config/agentic_architectural_patterns.json` |
| Transformacao empresarial | Agentic AI, Competing in the Age of AI, All-In on AI | `config/business_transformation.json` |

Principios aplicados: evals antes de otimizar; prompts, ferramentas, retrieval e
memoria versionados; contratos tipados nas bordas; retrieval mensuravel;
agentes especializados coordenados por um orquestrador; estado deterministico ao
redor do raciocinio probabilistico.

## 13. Estrutura do repositorio

```text
config/                 politicas e contratos (fonte de verdade)
  workflows/synapse/    workflows por papel (new-ai-project, agent-build, rag-build, ...)
scripts/
  create_ai_project.ps1 motor da fabrica (+ project_factory/)
  synapse_lib/          analisador, seletor, evals, modelos, RAG, fine-tuning, harness
templates/              templates de RAG, fine-tuning e harness
docs/
  specifications/       especificacoes (RAG, fine-tuning, harness, ML foundations, ...)
  architecture/         arquitetura do Synapse
  books/                mapa de implementacao dos livros
evals/                  casos e quality gates
agents/definitions/     perfis da transformacao empresarial
playbooks/ prompts/ guardrails/ llm_ops/ ml_systems/ rag/ rag_pipelines/ vector_db/
notebooks/foundations/  laboratorio de fundamentos
memory/                 memoria compartilhada entre canais
tests/                  testes do Synapse
```

## 14. Referencia rapida de comandos

| Objetivo | Comando |
|----------|---------|
| Criar projeto | `.\scripts\create_ai_project.ps1 -NomeProjeto ... -TipoProjeto ...` |
| Diagnosticar projeto | `.\scripts\diagnose_project.ps1 -ProjectName ...` |
| Analisar solucao (sem gravar) | `python .\scripts\analyze_business_solution.py --project-name x --universe IA --business-problem "..." --print-recommendation` |
| Testes | `.\.venv\Scripts\python -m pytest tests -q` |
| Validar stack | `.\scripts\validate_enterprise_stack.ps1` |
| Evals | `python .\scripts\run_evals.py ml\|ai\|rag\|retrieval` |
| Pipeline RAG local | `python .\templates\rag\rag_pipeline.py --query "..."` |
| Dataset de fine-tuning | `python .\scripts\prepare_fine_tuning_dataset.py --input ...` |
| Auditar harness | `python .\scripts\audit_harness.py` |
| Agentes da solucao | `python .\scripts\scaffold_solution_agents.py --validate-only` |
| Transformacao empresarial | `python .\scripts\run_business_transformation.py --brief ...` |
| Tratar dados | `python .\scripts\treat_dataset.py --input .\data\raw\arquivo.csv` |
| Filtrar contexto para LLM | `python .\scripts\context_filter.py --input ... --output ... --max-chars 12000` |
| Market radar | `python .\scripts\market_radar.py` |

Mais detalhes: `docs/vscode-workflow.md`, `docs/architecture/project-factory.md`
e `docs/architecture/no-code-ai-factory.md`.

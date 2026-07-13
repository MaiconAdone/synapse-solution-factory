# VS Code Workflow

Este e o fluxo oficial do SYNAPSE: tudo pelo VS Code, sem abrir `localhost` no
navegador.

## Stack Oficial

- Codex dentro do VS Code para orientar, revisar e evoluir o projeto.
- Ruflo com 15 core agents configurados, ativacao economica e pool escalavel ate 60 agentes.
- Project Factory em PowerShell para criar projetos completos.
- FastAPI apenas como runtime interno quando alguma automacao precisar de API.
- MLflow apenas como tracking interno quando houver treino, avaliacao ou release.
- Memoria local, Vector DB, playbooks, evals, guardrails e workflows versionados.

## Criar Projeto Pelo Chat

O caminho principal agora e a caixa de dialogo no VS Code, sem navegador:

```text
@adonex /projeto crie uma solucao de IA/RAG para atendimento ao cliente
```

Tambem funciona pela conversa do Codex ou Claude Code no VS Code. Antes de
implementar, o assistente deve confirmar no proprio chat:

- objetivo do projeto;
- problema de negocio;
- universo: ML/DL/series temporais, IA/RAG/MCP/agentes, Chatbolt ou hibrido;
- metrica de sucesso ou criterio de aceite;
- dados, documentos ou fontes disponiveis;
- nivel de risco.

Com o briefing completo, o fluxo consulta o BusinessSolutionAnalyzer, gera ou
atualiza `config/business_solution_analysis.json` e segue testes, evals,
governanca e custo local-first. Tasks continuam existindo apenas como atalhos.

## Memoria Compartilhada Entre Chats

VS Code Chat, Codex, Claude Code e AdoneX compartilham contexto local por:

- `.adonex/memory/SHARED_DIALOG_MEMORY.md`;
- `.adonex/memory/CHAT_TASKS.md`;
- `.adonex/memory/CURRENT_STATE.md`;
- MCP local `synapse-peers`, com SQLite em `artifacts/peers/synapse-peers.db`.

O `@adonex` registra automaticamente pedidos recebidos pelo chat. Codex e
Claude Code devem ler esses arquivos antes de pedir contexto novamente ao
usuario e registrar um resumo curto quando uma tarefa for concluida, bloqueada
ou ficar aguardando resposta.

## Criar Projeto Por Task

Abra o command palette:

```text
Ctrl+Shift+P
```

Escolha:

```text
Tasks: Run Task
```

Use uma destas tarefas:

- `AI Factory: Menu interativo`
- `AI Factory: Criar projeto com Codex + Ruflo 60 agents + tratamento dados`
- `Codex: Tratar dados com Ruflo economico`
- `Dados: Tratar dataset estatistico`
- `Enterprise: Validar stack`
- `SYNAPSE: Preparar runtime VS Code sem navegador`

O fluxo recomendado e:

1. Rodar `Enterprise: Validar stack`.
2. Rodar `SYNAPSE: Preparar runtime VS Code sem navegador`.
3. Rodar `AI Factory: Menu interativo`.
4. Escolher criar projeto; o padrao ativa um subconjunto economico dos core agents e mantem o pool de 60 disponivel.
5. Abrir a pasta gerada com `code C:\Users\malves\Documents\Projetos\nome_do_projeto`.

## Criar Via Terminal Integrado

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create_ai_project.ps1 -NomeProjeto "meu_projeto_ai"
```

Para preparar apenas memoria local sem chamar Ruflo CLI real, somente quando offline:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create_ai_project.ps1 -NomeProjeto "meu_projeto_ai" -LocalMemoryOnly
```

## Garantias Do Projeto Criado

Cada projeto novo nasce com:

- 15 core agents obrigatorios configurados.
- 45 specialist agents sob demanda configurados.
- Ruflo `new-ai-project` com ativacao paralela dos core agents e limite maximo de 60 agentes.
- prompt `prompts/codex_data_treatment_dialog.md`.
- task `Codex: Tratar dados com Ruflo economico`.
- `data/` para CSV, Excel, JSON, JSONL e Parquet.
- `scripts/treat_dataset.py` para tratamento estatistico rastreavel.
- `experiments/`, `artifacts/`, `memory/` e `output/`.
- `ml_systems/data_contract.yaml`.
- `ml_systems/model_card.md`.
- `prompts/`, `evals/`, `llm_ops/`, `rag_pipelines/`, `guardrails/`.
- `docs/runbooks/` e checklist inicial.
- validacao automatica do contrato enterprise.

## Validar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1
```

Essa validacao falha se o projeto nao tiver 15 core agents, 45 specialists,
`max_agents=60` e workflow Ruflo paralelo.

## Tratar Dados

Coloque a base bruta em `data/raw/` e, quando estiver conversando com Codex,
peca algo como:

```text
trate data/raw/clientes.csv com Ruflo economico e especialistas sob demanda
```

O caminho integrado e a task:

```text
Codex: Tratar dados com Ruflo economico
```

Essa task valida o stack, ativa um subconjunto economico dos 15 core agents, registra o contexto
da conversa em `output/codex_dialog/` e executa o tratamento estatistico.

Se quiser apenas rodar o tratamento isolado, use:

```text
Dados: Tratar dataset estatistico
```

Ou pelo terminal integrado:

```powershell
python .\scripts\treat_dataset.py --input .\data\raw\clientes.csv
```

O script gera:

- dataset tratado em `data/processed/<nome>_treated.csv`;
- relatorio em `output/data_treatment/<nome>_report.md`;
- contexto da conversa em `output/codex_dialog/data_treatment_request.json`;
- flags de ausentes e outliers quando aplicavel.

Por padrao, outliers sao sinalizados, nao removidos. Para winsorizar explicitamente:

```powershell
python .\scripts\treat_dataset.py --input .\data\raw\clientes.csv --winsorize-outliers
```

## Trabalhar Com Codex

Depois de abrir o projeto gerado no VS Code, use Codex como caixa de dialogo:

- descreva o objetivo do projeto;
- informe o problema de negocio;
- indique os dados disponiveis;
- peca modelos de ML, agentes de IA, RAG, avaliacoes e documentacao;
- peca para rodar Ruflo quando quiser paralelizar com os 15 core agents e acionar especialistas sob demanda.

Nenhuma etapa exige abrir navegador.

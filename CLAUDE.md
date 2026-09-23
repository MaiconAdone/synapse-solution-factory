# Synapse - Claude Code Configuration

Este arquivo orienta o uso do Synapse quando a execucao passa por Claude Code,
Anthropic API ou Claude Agent SDK.

## Regras Gerais

- Faca exatamente o que foi pedido, com escopo controlado.
- Leia arquivos antes de editar.
- Nunca salve segredos, credenciais ou arquivos `.env` reais.
- Use `/src`, `/tests`, `/docs`, `/config`, `/scripts` e pastas existentes.
- Mantenha arquivos com tamanho razoavel e responsabilidades claras.
- Valide entradas nas bordas do sistema.
- Rode testes depois de alterar codigo.
- Antes de implementar, respeite o gate SDD: problema, arquitetura, agentes, RAG, memoria, ferramentas, plano, testes e revisao.
- Para criar ou implementar projetos pelo dialogo, siga `config/llm_solution_factory_policy.json` e `docs/specifications/llm_solution_factory_governance.md`.
- Antes da decisao arquitetural, consulte o analisador em `scripts/synapse_lib/business_solution_analyzer.py` ou `scripts/analyze_business_solution.py`.
- Use `config/business_solution_analysis.json` como ADR operacional do projeto criado.
- A conversa e o caminho principal; tasks VS Code sao apenas atalhos opcionais.
- Claude Code deve conduzir o briefing no proprio chat do VS Code/terminal,
  sem exigir navegador. Se precisar de mais informacao, pergunte direto ao
  usuario e aguarde a resposta antes de criar ou implementar a solucao.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat,
  Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes,
  aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses
  chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os canais devem acessar a mesma Solution Factory do Synapse:
  memoria compartilhada, `config/llm_solution_factory_policy.json`,
  `config/ai_framework_selection.json`, analisador de solucoes, governanca,
  testes e evals.
- Ao concluir, bloquear ou deixar pergunta pendente, registre resumo curto na
  memoria compartilhada sem copiar secrets, datasets completos ou diffs longos.
- Se faltar objetivo, problema de negocio, universo, metrica de sucesso, dados/fontes disponiveis ou nivel de risco, pergunte ao usuario no chat antes de implementar. Nao invente essas informacoes.

## Padrao Anthropic / Claude

Ao usar Anthropic, priorize:

- Claude Haiku para classificacao, roteamento, resumos, checks de schema e tarefas simples.
- Claude Sonnet para implementacao, RAG, geracao de testes e raciocinio tecnico comum.
- Claude Opus somente para arquitetura critica, seguranca, conflito entre agentes, decisao final ou alto risco.
- Prompt caching para contexto estavel: system prompt, ferramentas, especificacoes, contratos, exemplos e documentos longos reutilizados.
- Contexto estavel sempre antes do contexto dinamico para maximizar cache hit.
- Contexto dinamico pequeno, especifico e filtrado.
- Logs de uso com cache creation, cache read, input tokens e output tokens quando a API expuser esses campos.

Evite:

- Reenviar repositorios inteiros.
- Repetir logs, diffs, build artifacts ou `node_modules`.
- Usar tier de modelo acima do necessario para tarefas simples.
- Usar Opus sem justificativa explicita.
- Misturar contexto estavel e dinamico de forma que quebre cache.

## MCP

O `.mcp.json` do projeto nao declara servidores; o Claude Code abre sem
dependencias externas. Coordenacao entre sessoes locais (opcional) usa
`scripts/synapse_peers_mcp.py`, que requer `pip install -r requirements.txt`.

Referencias oficiais:

- https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- https://code.claude.com/docs/en/prompt-caching
- https://platform.claude.com/docs/en/about-claude/pricing

## Governanca de Agentes e Custo

Trabalhe com **um unico assistente por tarefa**. Nao ha swarm, fleets nem
perfis de ativacao de agentes. Divida o trabalho em mais sessoes ou subagentes
somente quando o usuario pedir.

Arquivos oficiais:

- `config/roles.json`: papeis responsaveis pelas etapas dos workflows (quem
  responde por cada etapa, nao agentes em execucao).
- `config/harness_engineering_policy.json` (secao `governance`): identidade,
  autorizacao com menor privilegio, explicabilidade, lifecycle e matriz de
  autonomia (permitido, exige aprovacao, proibido).
- `config/agent_blueprint_contract.json`: campos obrigatorios de todo agente
  da solucao, incluindo `owner_role`.
- `config/agent_improvement_loop.json`: falhas, revisoes GPT/Claude, exemplos
  aprovados e novos evals.
- `config/cost_optimization_policy.json`: tier de modelo, orcamento de tokens
  e modo de RAG por complexidade (`request_profiles`).

| Perfil | Tier de modelo | Orcamento de tokens | Uso |
|--------|----------------|---------------------|-----|
| simple | economy | 1200 | pergunta curta, pequena correcao, classificacao |
| standard | balanced | 3000 | implementacao comum, ML simples, testes locais |
| advanced | balanced | 5000 | RAG, MCP, fluxo hibrido |
| enterprise | strong | 8000 | producao, seguranca, LGPD, arquitetura critica |
| extreme | strong | 16000 | auditoria |

Gerados por projeto (dentro do projeto criado, nao no Synapse):
`docs/specifications/agent_governance.md`,
`docs/checklists/agent_certification.md` e `docs/runbooks/agent_sre.md`.

Antes de criar agents, RAG, MCP ou workflows IA:

- aplique o Agent Blueprint Contract
- aplique menor privilegio para ferramentas
- siga a matriz de autonomia do harness
- registre criterio de sucesso, observabilidade e certificacao
- use o improvement loop para salvar falhas, exemplos aprovados e novos evals

Claude Code usa Anthropic diretamente para analisar, editar e revisar o Synapse.
Edicoes e comandos continuam sujeitos aos gates de aprovacao humana e seguranca.

## Context Filter antes de LLM

Antes de enviar arquivos grandes, logs, diffs ou saidas de comandos para Claude:

```powershell
python .\scripts\context_filter.py --input caminho\arquivo.txt --output .\output\context_filter\filtered_context.txt --max-chars 12000
```

Use a task:

```text
Synapse: Filtrar contexto para LLM
```

O filtro remove ruido e preserva:

- erros, warnings e traceback
- TODO/FIXME
- funcoes, classes, imports e contratos
- referencias a custo, token, agent, RAG e MCP

## Market Radar

Use o radar para buscar sinais uteis em Hacker News Show e Product Hunt:

```powershell
python .\scripts\market_radar.py
```

Ou pela task:

```text
Synapse: Market Radar + Context Filter
```

Saidas:

- `docs/radar/YYYY-MM-DD.md`
- `output/market_radar/YYYY-MM-DD.json`

Categorias:

- cost_optimization
- agents
- rag_mcp
- observability
- web_automation
- ux_product
- ml_data

## Universos de Projeto

Ao criar projeto novo, confirme ou infira o universo:

- ML: dados, features, treino, baseline, metricas, drift.
- IA: LLMs, agents, RAG, MCP, tool calling, memoria, guardrails.
- Chatbolt: chatbot, RAG quando houver conhecimento confiavel, handoff, memoria de sessao e guardrails.
- ML + IA (Hibrido): modelos preditivos mais LLM/RAG/agents.

Em todos os universos:

- Aplicar o analisador de solucao de negocio antes de definir arquitetura.
- Tratamento de dados ativo.
- Roteamento de modelos por custo ativo.
- Governanca de agentes pelo harness ativa.
- Context filter disponivel.
- Camada `tests/` obrigatoria.
- Evals e observabilidade obrigatorios.
- Docs de governanca de agentes, certificacao de agents e Agent SRE.

## Framework Selection

Para IA ou Hibrido, selecione frameworks por cenario, nao instale tudo cegamente.

Catalogo:

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

Use:

- LangGraph, OpenAI Agents SDK, Pydantic AI para agents stateful e handoff.
- LlamaIndex, Haystack, RAGFlow, R2R para RAG.
- MCP SDKs para ferramentas, recursos e contexto padronizado.
- CrewAI/Swarms para times de agentes por papeis.
- AutoGen para conversas multiagentes, pesquisa colaborativa e times researcher/coder/reviewer.
- Dify/Flowise para no-code ou visual builders.

## RAG Escalavel, Vector DB, Fine-Tuning e Harness Engineering

- RAG escalavel e vector DB: `config/rag_scalability_policy.json` e
  `docs/specifications/scalable_rag_vector_db.md`. Pergunte ao usuario volume
  do corpus, QPS, latencia, multi-tenant, sensibilidade e hospedagem antes de
  escolher o vector database; o analisador devolve essas lacunas em
  `rag_scalability.plan.pending_user_decisions`.
- Fine-tuning: `config/fine_tuning_policy.json`. Ordem prompt -> RAG ->
  fine-tuning; exige baseline medido, dataset curado
  (`scripts/prepare_fine_tuning_dataset.py`) e aprovacao humana. Pesos nunca
  mudam automaticamente.
- Harness engineering: `config/harness_engineering_policy.json`. Todo agente
  tem mapa de contexto, fronteira de ferramentas, limites do loop, verificacao,
  observabilidade e feedback; audite com `python scripts/audit_harness.py`.
- Gate de retrieval: `python scripts/run_evals.py retrieval` (recall@k, MRR, nDCG).
- Agentes da solucao (runtime) ficam em `config/solution_agents.json`, gerados
  do ADR e validados contra `config/agent_blueprint_contract.json`
  (`python scripts/scaffold_solution_agents.py --validate-only`); siga o
  workflow `agent-build`. Nao invente ferramentas: confirme inventario,
  permissoes e matriz de aprovacao com o usuario.
- O universo escolhido pelo usuario e o gerado (`effective_universe`); se o ADR
  trouxer `universe_confirmation`, confirme o universo no chat.
- Transformacao empresarial: `config/business_transformation.json` e fonte
  unica; rode `python scripts/run_business_transformation.py --brief <brief>`.
  Pergunte ao usuario owner, processo, KPIs (baseline/meta), notas 1-5 e fatores
  de risco listados em `pending_user_decisions`. HIGH exige aprovacao; CRITICAL
  nunca executa acao externa. Execucao real so via tool MCP autorizada.

## Livros Base e Implementacao Propria

- `config/book_registry.json` e a fonte unica dos livros (titulo, autores,
  dominios, universos e onde sao aplicados) e das decisoes proprias fora dos
  livros. Ao mudar algo baseado em livro ou uma decisao propria, atualize o
  registro e rode `python scripts/sync_book_registry.py`.

## Memoria e RAG

Antes de chamar LLM:

- busque memoria relevante
- filtre contexto
- deduplique documentos
- comprima contexto
- recupere apenas trechos necessarios
- use reranking somente quando confianca estiver baixa
- use GraphRAG apenas quando relacoes forem essenciais

## Build e Validacao

Depois de alterar codigo:

```powershell
pytest -q
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1
```

Para diagnosticar projeto criado:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose_project.ps1 -ProjectName nome_do_projeto
```

## Dialogo Antes De Tasks

O fluxo preferido e pela caixa de dialogo do assistente. Quando o usuario pedir
criacao ou implementacao de projeto, colete as lacunas minimas, aplique o
analisador de solucao, gere/atualize a analise e implemente. Tasks do VS Code
podem ajudar em validacoes ou atalhos, mas nao sao requisito operacional.
Se alguma lacuna essencial permanecer, responda com perguntas curtas e objetivas
em vez de seguir com a implementacao.

## Checklist Claude Antes de Responder

- O universo ML/IA/Hibrido esta claro?
- A analise de solucao de negocio foi criada ou atualizada?
- Alguma informacao essencial esta faltando e precisa ser perguntada ao usuario?
- A solicitacao passou pelo SDD gate?
- O contexto foi filtrado se for grande?
- O cache Anthropic pode ser aproveitado?
- O tier de modelo esta justificado pelo custo/complexidade?
- A matriz de autonomia do harness foi respeitada?
- O agent blueprint contract foi respeitado?
- O improvement loop deve salvar exemplo aprovado ou caso de falha?
- RAG/MCP/frameworks foram escolhidos por fit?
- Testes e validacao enterprise foram considerados?

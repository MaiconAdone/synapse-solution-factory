# Synapse - Claude Code Configuration

Este arquivo orienta o uso do Synapse quando a execucao passa por Claude Code,
Anthropic API, Claude Agent SDK ou fluxos assistidos por Ruflo.

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
- Antes da decisao arquitetural, consulte o analisador em `backend/app/services/business_solution_analyzer.py` ou `scripts/analyze_business_solution.py`.
- Use `config/business_solution_analysis.json` como ADR operacional do projeto criado.
- A conversa e o caminho principal; tasks VS Code sao apenas atalhos opcionais.
- Claude Code deve conduzir o briefing no proprio chat do VS Code/terminal,
  sem exigir navegador. Se precisar de mais informacao, pergunte direto ao
  usuario e aguarde a resposta antes de criar ou implementar a solucao.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat,
  AdoneX, Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes,
  aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses
  chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os quatro canais devem acessar a mesma Solution Factory do Synapse:
  memoria compartilhada, `config/llm_solution_factory_policy.json`,
  `config/ai_framework_selection.json`, analisador de solucoes, governanca,
  testes e evals.
- Para continuidade entre chats, leia `.adonex/memory/SHARED_DIALOG_MEMORY.md`,
  `.adonex/memory/CHAT_TASKS.md` e use `synapse-peers` para mensagens curtas
  locais quando outro peer estiver ativo.
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
- Ativar muitos agentes para tarefas simples.
- Usar Opus sem justificativa explicita.
- Misturar contexto estavel e dinamico de forma que quebre cache.

## Claude Peers MCP

O projeto tambem registra `claude-peers` em `.mcp.json`, instalado em
`C:\Users\malves\.claude\mcp\claude-peers-mcp`.

Use `claude-peers` somente para comunicacao entre sessoes Claude Code. Para
coordenacao neutra entre Codex, AdoneX, Ruflo, Ollama e Claude, use
`synapse-peers`.

Para receber mensagens instantaneas via `claude/channel`, inicie o Claude Code
com development channels:

```powershell
claude --dangerously-load-development-channels server:claude-peers
```

Se quiser operar sem channel experimental, use `check_messages` manualmente.
O `OPENAI_API_KEY` do `claude-peers` esta vazio no `.mcp.json` para evitar
auto-summary via provedor externo.

Referencias oficiais:

- https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- https://code.claude.com/docs/en/prompt-caching
- https://platform.claude.com/docs/en/about-claude/pricing

## Ruflo 60 Agents com Baixo Custo

O Synapse mantem 60 agentes disponiveis, mas nao deve ativar todos por padrao.

Contrato atual:

- Max agents disponiveis: 60
- Core agents: 15
- Specialist pool: 45
- Default economic active agents: 1
- Standard active agents: 3
- Enterprise active agents: 8
- All 60 agents: somente com justificativa explicita de alta complexidade

Use `config/cost_optimization_policy.json` e `CostAwareRouter` antes de ativar agentes.

## Agentic Mesh Governance

O Synapse opera como um mesh governado de agentes e fleets, nao apenas como uma
lista plana de agentes.

Arquivos oficiais:

- `config/agent_trust_framework.json`
- `config/agent_fleets.json`
- `AgenticMeshGovernanceService`
- `docs/specifications/agentic_mesh_governance.md`
- `docs/checklists/agent_fleet_certification.md`
- `docs/runbooks/agent_sre.md`
- `config/agent_blueprint_contract.json`
- `config/agent_improvement_loop.json`

Trust framework obrigatorio:

1. Identity and Authentication
2. Authorization and Tool Permissions
3. Purpose and Policy
4. Planning and Explainability
5. Observability and Agent SRE
6. Certification and Compliance
7. Lifecycle Governance

Fleets atuais:

- `project_factory_fleet`
- `ml_fleet`
- `rag_fleet`
- `mcp_fleet`
- `security_fleet`
- `cost_optimization_fleet`

Antes de criar agents, RAG, MCP ou workflows IA:

- aplique o Agent Blueprint Contract
- decida single-agent versus multiagent/fleet antes de escalar custo
- selecione uma fleet pelo cenario do usuario
- valide que todos os agentes da fleet existem no catalogo
- aplique menor privilegio para ferramentas
- defina matriz de autonomia: permitido, exige aprovacao, proibido
- registre criterio de sucesso, observabilidade e certificacao
- exija aprovacao humana para ativar todos os 60 agentes
- em projetos corporativos novos, gere especificacao agentic mesh, checklist de certificacao e runbook Agent SRE
- use o improvement loop para salvar falhas, revisoes GPT/Claude, exemplos aprovados e novos evals

Perfis:

| Perfil | Agents | Uso |
|--------|--------|-----|
| simple | 1 | pergunta curta, pequena correcao, classificacao |
| standard | ate 3 | implementacao comum, ML simples, testes locais |
| advanced | ate 5 | RAG, MCP, multiagente, fluxo hibrido |
| enterprise | ate 8 | producao, seguranca, LGPD, arquitetura critica |
| extreme | ate 15 | auditoria; 60 somente com aprovacao explicita |

Claude Code usa Anthropic diretamente para analisar, editar e revisar o Synapse e
nunca delega geracao ao Ollama. Ollama e exclusivo do AdoneX. Edicoes e comandos
continuam sujeitos aos gates de aprovacao humana e seguranca.

Regra de arquitetura:

- Comece com single-agent quando a tarefa for simples, de baixo risco e de um unico dominio.
- Use multiagent quando houver RAG, MCP, seguranca, compliance, producao, dominios multiplos ou conflito.
- Use fleet governada quando a solucao exigir release corporativo, auditoria ou coordenacao de varios papeis.

## Context Filter antes de LLM/Ruflo

Antes de enviar arquivos grandes, logs, diffs ou saidas de comandos para Claude:

```powershell
python .\scripts\context_filter.py --input caminho\arquivo.txt --output .\output\context_filter\filtered_context.txt --max-chars 12000
```

Use a task:

```text
Synapse: Filtrar contexto para LLM/Ruflo
```

O filtro remove ruido e preserva:

- erros, warnings e traceback
- TODO/FIXME
- funcoes, classes, imports e contratos
- referencias a custo, token, agent, RAG, MCP e MLflow

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

## Agent Comms

Agentes coordenados devem usar mensagens direcionadas, nao polling nem estado global.

Fluxo preferido:

```text
Lead -> researcher -> architect -> coder -> tester -> reviewer
```

Regras:

- Nomeie agentes por papel.
- Inclua no prompt quem deve receber o resultado.
- Envie apenas contexto necessario ao papel do agente.
- Consolide respostas no `orchestration-manager`.
- Use especialistas somente quando o roteador economico justificar.
- Use fleets governadas quando o pedido envolver IA, RAG, MCP, seguranca, custo ou criacao de novo projeto.

## Spawning Economico

Nao use "spawn all agents" como padrao. Use roteamento por complexidade.

Exemplo conceitual:

```javascript
Agent({
  prompt: "Classifique o pedido, filtre contexto, estime custo e envie decisao ao architect.",
  subagent_type: "researcher",
  name: "researcher",
  run_in_background: true
})
Agent({
  prompt: "Projete a solucao com SDD e envie plano ao coder.",
  subagent_type: "system-architect",
  name: "architect",
  run_in_background: true
})
Agent({
  prompt: "Implemente somente apos plano claro e envie diff/testes ao tester.",
  subagent_type: "coder",
  name: "coder",
  run_in_background: true
})
Agent({
  prompt: "Rode testes e envie resultado ao reviewer.",
  subagent_type: "tester",
  name: "tester",
  run_in_background: true
})
```

Para custo baixo, prefira 3 a 5 agentes. Para producao critica, use ate 15. Use 60 apenas em auditoria extrema.

## Universos de Projeto

Ao criar projeto novo, confirme ou infira o universo:

- ML: dados, features, treino, baseline, MLflow, metricas, drift.
- IA: LLMs, agents, RAG, MCP, tool calling, memoria, guardrails.
- Chatbolt: chatbot, RAG quando houver conhecimento confiavel, handoff, memoria de sessao e guardrails.
- ML + IA (Hibrido): modelos preditivos mais LLM/RAG/agents.

Em todos os universos:

- Aplicar o analisador de solucao de negocio antes de definir arquitetura.
- Ruflo ativo.
- Tratamento de dados ativo.
- Cost-aware orchestration ativa.
- Agentic mesh governance ativa.
- Context filter disponivel.
- Camada `tests/` obrigatoria.
- Evals e observabilidade obrigatorios.
- Docs corporativos de agentic mesh, certificacao de fleets e Agent SRE.

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
- O numero de agentes esta justificado pelo custo/complexidade?
- A fleet correta foi selecionada e validada?
- O trust framework foi respeitado?
- O agent blueprint contract foi respeitado?
- O improvement loop deve salvar exemplo aprovado ou caso de falha?
- RAG/MCP/frameworks foram escolhidos por fit?
- Testes e validacao enterprise foram considerados?

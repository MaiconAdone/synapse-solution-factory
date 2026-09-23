# Contexto Compartilhado Codex + VS Code Chat

Este arquivo e a memoria operacional curta compartilhada entre Codex e o chat do
VS Code neste workspace.

## Como usar

- Antes de iniciar uma tarefa, leia `AGENTS.md` e este arquivo.
- Atualize este arquivo quando houver mudanca relevante de objetivo, decisao,
  restricao operacional ou estado atual do trabalho.
- Mantenha entradas curtas. Para logs longos, relatorios e artefatos, registre
  apenas o caminho e o resumo.
- Nao cole catalogos grandes de agentes, manifests longos, `.claude-flow`,
  `output/`, artifacts ou memoria completa sem necessidade direta.
- Use Codex/OpenAI e Claude/Anthropic conforme `AGENTS.md`; aprovacao
  humana explicita e exigida somente para ativar os 60 agentes.

## Estado Atual

- Projeto: `synapse-ai`.
- Fluxo oficial: trabalhar pelo VS Code, sem depender de navegador.
- Memoria runtime: `memory/project_memory.runtime.json`.
- Memoria persistente/eventos: `memory/synapse_learning_memory.jsonl`.
- Documentacao de fluxo VS Code: `docs/vscode-workflow.md`.

## Protocolo De Atualizacao

Ao encerrar uma tarefa relevante, registre aqui:

```text
Data:
Objetivo:
Arquivos tocados:
Decisoes:
Proximo passo:
```

## Ultimas Notas

Data: 2026-06-17
Objetivo: compartilhar contexto de trabalho entre Codex e o chat do VS Code.
Arquivos tocados: `memory/codex-vscode-context.md`, `.github/copilot-instructions.md`, `memory/README.md`.
Decisoes: usar arquivo versionado no workspace como fonte de verdade curta; evitar depender de memoria interna/efemera de extensoes.
Proximo passo: ao usar o chat do VS Code, pedir explicitamente para considerar `.github/copilot-instructions.md`, `AGENTS.md` e este arquivo quando a extensao nao carregar instrucoes automaticamente.

Data: 2026-09-23
Objetivo: adicionar RAG escalavel/vector DB, governanca de fine-tuning e harness engineering; auditar os 4 universos.
Arquivos tocados: `config/rag_scalability_policy.json`, `config/fine_tuning_policy.json`, `config/harness_engineering_policy.json`, `docs/specifications/{scalable_rag_vector_db,fine_tuning,harness_engineering}.md`, `scripts/synapse_lib/{vector_store,rag_retrieval,rag_scalability,fine_tuning_service,harness_service,text_utils}.py`, `templates/`, analisador, fabrica, diagnose, validate, testes.
Decisoes: politicas JSON como fonte de verdade; analisador devolve decisoes de escala pendentes em vez de adivinhar; fine-tuning so com baseline medido e aprovacao humana; analisador permanece stdlib-only; fleets recomendadas lidas do runtime_manifest (removidas data_fleet/quality_fleet inexistentes); templates fantasmas viraram `scaffold_targets`.
Proximo passo: ao criar projeto IA/Chatbolt/Hibrido, perguntar ao usuario volume do corpus, QPS, latencia, multi-tenant, sensibilidade e hospedagem antes de escolher o vector DB.

Data: 2026-09-23
Objetivo: auditar agentes agenticos do universo IA.
Arquivos tocados: analisador (effective_universe, arquetipo composto), `config/business_solution_catalog.json`, `config/agent_blueprint_contract.json`, `config/workflows/synapse/agent-build.json`, `scripts/synapse_lib/solution_agents.py`, `scripts/scaffold_solution_agents.py`, fabrica, diagnose, validate, README/CLAUDE/AGENTS.
Decisoes: universo escolhido pelo usuario e o gerado (recomendacao diferente vira universe_confirmation); agentes runtime da solucao em config/solution_agents.json separados dos 60 construtores; contrato de blueprint alinhado a OpenAI/Anthropic (sem modelos locais).
Proximo passo: em projeto IA, confirmar com o usuario inventario de ferramentas, permissoes e matriz de aprovacao do action-executor.

Data: 2026-09-23
Objetivo: tornar real a camada de agentes empresariais (transformacao empresarial).
Arquivos tocados: `config/business_transformation.json` (v2), workflow e YAML de perfis alinhados, `scripts/synapse_lib/business_transformation.py`, `scripts/run_business_transformation.py`, `templates/business/transformation_brief.json`, `evals/business_transformation_cases.jsonl`, analisador, fabrica, diagnose, validate, docs.
Decisoes: motor deterministico stdlib com 14 estagios; risco por regras explicitas (fator ausente = HIGH); CRITICAL nunca executa acao externa; tools sempre simuladas ate MCP autorizado; analisador adiciona business_transformation_fleet em pedidos de processo/KPI.
Proximo passo: para um caso real, coletar do usuario owner, processo, KPIs baseline/meta, notas 1-5 e fatores de risco por oportunidade.

Data: 2026-09-23
Objetivo: remover swarm de 60 agentes, perfis de ativacao de agentes, 7 fleets e trust framework de 7 camadas.
Arquivos tocados: removidos `config/agent_fleets.json`, `config/agent_trust_framework.json`, `agents/definitions/enterprise_agents.yaml`, `docs/architecture/agentic-mesh-governance.md`, `docs/architecture/generated-project-swarm-strategy.md`; criado `config/roles.json`; governanca movida para `config/harness_engineering_policy.json#governance`; fabrica, diagnose, validate, analisador, workflows, testes e docs atualizados.
Decisoes: um unico assistente por tarefa; workflows usam papeis (`role`) de config/roles.json; cost policy manteve roteamento de modelos e virou `request_profiles` (tier + tokens, sem limite de agentes); agentes da solucao usam `owner_role` em vez de fleet; framework Swarms de terceiros continua no catalogo.
Proximo passo: .claude/ ainda contem comandos claude-flow de swarm (ferramenta do Claude Code, fora do runtime do Synapse) - decidir com o usuario se remove.

Data: 2026-09-23
Objetivo: remover claude-flow de .claude/ e completar o briefing na task e no menu da fabrica.
Arquivos tocados: .claude/ (comandos claude-flow, sparc e analysis e agentes com hooks npx claude-flow removidos; permissao /swarm removida do settings.json), `.vscode/tasks.json`, `scripts/ai_factory_menu.ps1`, README, AGENTS.md, copilot-instructions, teste de contrato.
Decisoes: ficaram so as definicoes de agentes sem claude-flow; task e menu pedem objetivo, problema, metrica, fontes e risco (risco sem valor padrao) e o menu nao cria projeto com campo vazio.
Proximo passo: nenhum pendente desta frente.

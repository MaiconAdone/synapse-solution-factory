# LLM Solution Factory Governance

Este documento e o contrato operacional para Codex, Claude Code, AdoneX, VS Code
chat, Ruflo e modelos Ollama ao criar ou implementar solucoes no Synapse.

## Regra Principal

Toda criacao ou implementacao de projeto deve partir da caixa de dialogo e passar
pelo analisador de solucao de negocio antes da arquitetura final.

Tasks do VS Code podem existir como atalho, mas nao sao o caminho obrigatorio.
Quando o usuario pedir pela conversa, o assistente deve coletar o minimo de
contexto, consultar o analisador e executar a implementacao.

Canais autorizados para conteudo solicitado pelo usuario:

- VS Code Chat
- AdoneX
- Claude Code
- Codex

Objetivos, restricoes, arquivos, decisoes, aprovacoes e lacunas de briefing
devem ser coletados ou confirmados por esses canais de chat antes de usar tasks,
scripts, navegador ou ferramentas. Tasks, scripts, MCP tools e browser UI podem
executar atalhos, validacoes, scaffolding ou integracoes, mas nao substituem a
coleta de conteudo pelo dialogo.

Todos os quatro canais devem acessar a mesma Solution Factory: memoria
compartilhada, policy, analisador de solucao, catalogo de tecnologia,
governanca, testes e evals.

Se faltar qualquer informacao essencial, o assistente deve perguntar ao usuario
pela propria conversa antes de criar ou implementar. Nao deve inventar problema
de negocio, metrica de sucesso, dados/fontes disponiveis, nivel de risco,
aprovacao de cloud ou aprovacao para ativar todos os 60 agentes.

## Protocolo De Perguntas

Quando houver lacunas, responda com perguntas curtas e objetivas. Use no maximo
cinco perguntas por turno:

1. O que voce quer criar ou implementar?
2. Qual problema de negocio a solucao precisa resolver?
3. Qual metrica de sucesso ou criterio de aceite define que funcionou?
4. Quais dados, documentos, sistemas ou fontes estao disponiveis?
5. Qual e o nivel de risco: baixo, medio, alto ou critico?

Se o universo estiver ambiguo, pergunte: "Qual universo voce quer usar: ML,
IA/RAG/agentes, Chatbolt ou hibrido?"

## Fontes de Verdade

- `config/llm_solution_factory_policy.json`
- `config/business_solution_catalog.json`
- `config/ai_framework_selection.json`
- `backend/app/services/business_solution_analyzer.py`
- `scripts/analyze_business_solution.py`
- `docs/specifications/technology_layer.md`
- `config/ai_ml_enterprise_spec.json`
- `config/cost_optimization_policy.json`
- `config/agent_trust_framework.json`
- `config/agent_fleets.json`
- `config/agent_blueprint_contract.json`
- `config/agentic_architectural_patterns.json`
- `config/agent_improvement_loop.json`

## Fluxo Obrigatorio

1. Entender se o pedido e criacao de projeto, implementacao em projeto existente,
   tratamento de dados, ML/DL/series temporais, RAG, Chatbolt, agente ou hibrido.
2. Coletar objetivo, problema de negocio, universo desejado, dados/fontes
   disponiveis, metrica de sucesso e risco. Se faltar qualquer item, perguntar
   ao usuario antes de implementar.
3. Consultar o analisador:

```powershell
python .\scripts\analyze_business_solution.py `
  --project-root caminho\do\projeto `
  --project-name nome_do_projeto `
  --universe ML `
  --project-goal "objetivo" `
  --business-problem "problema de negocio" `
  --solution-focus ml
```

4. Usar `config/business_solution_analysis.json` como decisao arquitetural.
5. Aplicar SDD: problema, arquitetura, dados, agentes/RAG, ferramentas, testes,
   evals, custos, governanca e plano.
6. Implementar somente o escopo que respeita a analise.
7. Atualizar testes/evals e validar.
8. Registrar riscos, proximas acoes e resultados.

## Arquitetura Por Universo

### ML, DL, Redes Neurais e Series Temporais

Use MLOps:

- contrato de dados
- baseline
- features
- treino e avaliacao
- MLflow/artifacts
- model card
- monitoramento e drift
- testes determinisiticos em `tests/`
- evals em `evals/`

### IA, RAG, MCP e Agentes

Use AI Engineering:

- RAG para conhecimento confiavel
- MCP/tool calling para ferramentas
- agentes somente quando houver execucao de tarefas
- guardrails
- memoria governada
- custo por token
- roteamento local-first
- testes de contrato
- evals de prompts, RAG e workflows

### Chatbolt

Use arquitetura conversacional:

- persona e prompt versionado
- RAG quando resposta exigir fonte confiavel
- handoff humano
- memoria de sessao
- seguranca e privacidade
- evals de conversa
- testes especificos de chatbot

### Hibrido

Use hibrido quando o problema exigir previsao/classificacao e tambem conhecimento
ou execucao. O projeto deve compartilhar contrato de dados, governanca, testes,
evals, observabilidade e custo.

## Governanca De LLMs

- Preferir Ollama local para triagem, classificacao, resumo, planejamento e
  revisao inicial.
- Cloud e opt-in: exige pedido explicito e aprovacao humana.
- Comecar com um agente.
- Escalar Ruflo por dominio somente quando necessario.
- Nunca ativar 60 agentes por padrao.
- Usar `config/cost_optimization_policy.json` antes de ampliar agentes.
- Usar `synapse-peers` para handoff curto entre Codex, Claude, AdoneX, Ruflo e
  operadores humanos.

## Contrato Para Assistentes

### Codex

Leia `AGENTS.md`, esta especificacao e `config/llm_solution_factory_policy.json`.
Antes de criar projeto ou implementar solucao empresarial, consulte o analisador e
use a analise como plano de arquitetura.

### Claude Code

Leia `CLAUDE.md`, esta especificacao e a policy. Use a analise como ADR
operacional. Preserve prompt caching e contexto pequeno.

### AdoneX E VS Code Chat

Receba o pedido pela conversa, colete lacunas minimas, prefira Ollama local e
consulte o analisador antes de sugerir arquitetura ou gerar handoff para Codex.

### Ruflo

Use a analise para escolher fleets e especialistas. O padrao e um orquestrador;
especialistas entram por dominio e 60 agentes exigem aprovacao explicita.

## Validacao

Para o Synapse:

```powershell
python -m pytest tests/test_backend_contracts.py
python -m pytest tests/test_business_transformation.py
```

Para projeto criado:

```powershell
python -m pytest tests
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose_project.ps1 -ProjectName nome_do_projeto
```

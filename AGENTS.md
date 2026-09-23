# Synapse - Limites de Provedores

- Codex usa o modelo OpenAI configurado diretamente para analisar, editar e revisar codigo.
- Claude Code usa Anthropic diretamente.
- Aprovacao humana explicita e exigida somente para ativar os 60 agentes.
- Comece com um agente; escale somente quando o problema exigir outros dominios.
- Nunca ative os 60 agentes por padrao.
- Envie apenas arquivos e trechos relevantes. Comprima contexto grande antes do modelo.
- Limite respostas locais normalmente a 512 tokens e contexto a 4096 tokens.
- Para economizar limite do Codex, nao carregue catalogos de agentes, manifests longos,
  output, artifacts, .claude-flow ou memoria completa sem necessidade direta.
- Use o swarm como roteador local; nao replique o raciocinio de 60 agentes dentro
  do prompt do Codex.
- Compartilhe memoria entre VS Code Chat, Codex e Claude Code pelo MCP local
  `synapse-peers`.
- Antes de pedir contexto novamente ao usuario, consulte a memoria compartilhada
  e mensagens pendentes dos peers locais.
- Para tarefas simples, use no maximo 1 arquivo principal + testes relacionados.
- Para tarefas medias, use ate 5 arquivos relevantes. Acima disso, justifique antes.
- O dialogo do Codex ainda usa o modelo configurado pela extensao; ferramentas locais reduzem
  delegacao e geracao cloud, mas nao tornam a conversa do Codex gratuita.

## Synapse Solution Factory

- Para criar ou implementar qualquer projeto empresarial pelo dialogo, consulte
  `config/llm_solution_factory_policy.json` e
  `docs/specifications/llm_solution_factory_governance.md`.
- O analisador de solucoes e obrigatorio antes da decisao arquitetural:
  `scripts/synapse_lib/business_solution_analyzer.py` ou
  `scripts/analyze_business_solution.py`.
- O resultado oficial da decisao deve ficar em
  `config/business_solution_analysis.json` e
  `docs/briefings/business_solution_analysis.md` no projeto criado.
- Classifique o pedido em ML/DL/series temporais, IA/RAG/MCP/agentes, Chatbolt
  ou hibrido; depois siga os testes, evals, governanca e custo definidos pela
  analise.
- A caixa de dialogo e o caminho principal. Tasks do VS Code sao atalhos
  opcionais, nao requisito para criar ou implementar projeto.
- No VS Code, use a conversa do Codex ou Claude Code para iniciar projetos.
  O assistente deve perguntar no proprio chat qualquer informacao faltante;
  nao exigir navegador ou task para completar briefing.
- Canais autorizados para conteudo solicitado pelo usuario: VS Code Chat,
  Claude Code e Codex. Objetivos, restricoes, arquivos, decisoes,
  aprovacoes e lacunas de briefing devem ser coletados ou confirmados por esses
  chats antes de usar tasks, scripts, navegador ou ferramentas.
- Todos os canais devem acessar a mesma Solution Factory do Synapse:
  memoria compartilhada, `config/llm_solution_factory_policy.json`,
  `config/ai_framework_selection.json`, analisador de solucoes, governanca,
  testes e evals.
- Toda tarefa iniciada pela caixa de dialogo deve registrar um resumo curto na
  memoria compartilhada para continuidade entre chats.
- Se faltar objetivo, problema de negocio, universo, metrica de sucesso,
  dados/fontes disponiveis ou nivel de risco, pergunte ao usuario pela conversa
  antes de implementar. Nao invente essas informacoes.
- RAG escalavel e vector DB seguem `config/rag_scalability_policy.json`;
  fine-tuning segue `config/fine_tuning_policy.json` (prompt -> RAG ->
  fine-tuning, baseline medido e aprovacao humana); todo agente segue
  `config/harness_engineering_policy.json` (`python scripts/audit_harness.py`).
- Agentes da solucao (runtime) ficam em `config/solution_agents.json`,
  validados contra `config/agent_blueprint_contract.json` e construidos pelo
  workflow `agent-build`; ferramentas sao confirmadas com o usuario.
- Transformacao empresarial roda pelo motor
  `scripts/synapse_lib/business_transformation.py` a partir de
  `config/business_transformation.json`; decisoes pendentes sao perguntadas no
  chat e acoes HIGH/CRITICAL exigem aprovacao humana.
- Respeitar os provedores fixos: Codex/OpenAI e Claude Code/Anthropic.
- Edicoes e comandos continuam sujeitos a aprovacao humana conforme o risco.

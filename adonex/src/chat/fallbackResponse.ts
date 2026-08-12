import type { TaskPlan, WorkspaceSnapshot } from "../llm/types";

export function createLocalFallbackResponse(
  prompt: string,
  snapshot: WorkspaceSnapshot,
  plan: TaskPlan,
  errorMessage: string
): string {
  const analysis = analyzePromptForFallback(prompt, plan);
  if (!snapshot.synapseDetected) {
    return [
      "## Ollama local nao concluiu a resposta",
      "",
      "O analisador local do AdoneX avaliou a pergunta, mas a geracao do modelo nao terminou a tempo.",
      "",
      "### Analise da pergunta",
      "",
      `- Intencao: ${analysis.intent}`,
      `- Tipo de solicitacao: ${analysis.requestType}`,
      `- Acao roteada: ${plan.action}`,
      `- Comandos citados: ${analysis.commands.length ? analysis.commands.join(", ") : "nenhum"}`,
      `- Arquivos citados: ${analysis.files.length ? analysis.files.join(", ") : "nenhum"}`,
      "",
      "### Diagnostico",
      "",
      `- Falha: ${errorMessage}`,
      "- Nenhuma resposta de modelo foi usada.",
      "- Nao vou inventar conteudo como se o Ollama tivesse respondido.",
      "",
      "### Proximo passo",
      "",
      "- Tente novamente com uma pergunta menor ou rode `AdoneX: Test Ollama Connection` para validar latencia/modelo."
    ].join("\n");
  }

  return createAnalyzedSynapseFallback(prompt, snapshot, plan, errorMessage, analysis);
}

export function createLocalChatFailureResponse(
  prompt: string,
  model: string,
  errorMessage: string
): string {
  const analysis = analyzePromptForFallback(prompt, {
    action: "chat",
    mode: "local",
    objective: prompt,
    commands: [],
    filesToChange: [],
    filesToRead: [],
    id: "local-chat-fallback",
    recommendedExecution: "adonex-local",
    risks: [],
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    requiresApproval: false
  });
  return [
    "## Ollama local nao concluiu a resposta",
    "",
    `Tentei responder com o modelo local \`${model}\`, mas a chamada nao terminou corretamente.`,
    "",
    "### Analise da pergunta",
    "",
    `- Pergunta recebida: ${prompt.trim() || "(vazia)"}`,
    `- Intencao: ${analysis.intent}`,
    `- Tipo de solicitacao: ${analysis.requestType}`,
    "",
    "### Diagnostico",
    "",
    `- Falha: ${errorMessage}`,
    "- O AdoneX nao tratou isso como cancelamento do usuario.",
    "- Nenhuma resposta de cloud foi usada.",
    "",
    "### Proximo passo",
    "",
    "- Tente novamente com uma pergunta menor, ou aumente `adonex.ollama.timeoutSeconds` se o modelo estiver carregando em CPU/RAM."
  ].join("\n");
}

export function createSynapseExplanationResponse(
  snapshot: WorkspaceSnapshot,
  plan: TaskPlan
): string {
  return createSynapseExplanation(snapshot, plan, undefined);
}

function createSynapseExplanation(
  snapshot: WorkspaceSnapshot,
  plan: TaskPlan,
  errorMessage: string | undefined
): string {
  const files = plan.filesToRead.slice(0, 8);
  const signals = snapshot.synapseSignals.length
    ? snapshot.synapseSignals.join(", ")
    : "sinais nao informados";
  const stack = snapshot.stack.length ? snapshot.stack.join(", ") : "stack nao inferida";
  return [
    "## Explicacao Executiva do Projeto Synapse",
    "",
    "O Synapse e uma plataforma corporativa de engenharia de IA e ML orientada a produto. O objetivo e acelerar a criacao de solucoes com agentes, RAG, MCP, automacao de desenvolvimento, validacao e governanca, mantendo o custo baixo por padrao com Ollama local e usando OpenAI ou outros provedores pagos somente quando houver justificativa tecnica e aprovacao.",
    "",
    "### Visao de negocio",
    "",
    "- Proposta de valor: transformar requisitos de negocio em projetos IA/ML executaveis, testaveis e prontos para evolucao.",
    "- Publico-alvo: equipes que precisam criar agentes, pipelines RAG, APIs, automacoes, modelos ML, avaliacao e operacao com menor dependencia de consultoria manual.",
    "- Diferencial: combina fluxo local-first, governanca, memoria de projeto, Ruflo multiagente, MCP e validacao automatica em um unico workspace.",
    "- Resultado esperado: reduzir tempo de arquitetura, reduzir custo de tokens, padronizar qualidade e aumentar rastreabilidade das decisoes.",
    "",
    "### Arquitetura executiva",
    "",
    "- AdoneX: camada de agente no VS Code para dialogo, selecao de contexto, memoria compartilhada, planejamento, diffs, execucao e validacao.",
    "- Ollama: motor local para triagem, explicacoes, revisoes curtas, planejamento inicial e tarefas de baixo custo.",
    "- Ruflo: camada de coordenacao multiagente com 15 agentes core e 45 especialistas, usada como conselho tecnico e mecanismo de orquestracao.",
    "- MCP: fronteira de ferramentas controladas para expor capacidades com contrato, permissao, logs e fallback.",
    "- Backend FastAPI: API de projetos, agentes, LLM local, memoria, workflows, modelos, avaliacoes e runtime.",
    "- Frontend React/Next.js: interface web independente do VS Code para operar projetos, agentes, memoria e workflows.",
    "- Postgres e storage: base para estado, projetos, usuarios, registros e integracoes futuras.",
    "- Jupyter: suporte a experimentos, avaliacao, notebooks e ciclo ML.",
    "",
    "### Como o Synapse trabalha",
    "",
    "- Classifica a solicitacao do usuario por universo: ML, IA ou hibrido.",
    "- Define especificacao, arquitetura, fluxo de dados, criterios de aceite e estrategia de testes antes de implementar.",
    "- Seleciona poucos arquivos relevantes para evitar contexto caro e ruido.",
    "- Usa Ollama local para responder, planejar e revisar quando a tarefa couber no modelo local.",
    "- Usa Ruflo 60-agent council como revisao especializada compactada, sem disparar 60 chamadas simultaneas ao LLM.",
    "- Gera handoff para Codex quando a tarefa for multi-arquivo, arriscada, complexa ou exigir qualidade acima do modelo local; o AdoneX nao chama OpenAI.",
    "- Registra memoria, decisoes, tarefas e handoffs para manter continuidade entre AdoneX, Codex e o restante do projeto.",
    "",
    "### Governanca e seguranca",
    "",
    "- Segredos, `.env`, chaves e arquivos sensiveis nao devem ser enviados ao modelo.",
    "- Tarefas no Synapse podem ser automaticas, mas comandos perigosos, paths sensiveis e exposicao de secrets continuam bloqueados.",
    "- Cada implementacao deve produzir diff, backup, validacao e resumo tecnico.",
    "- O uso de cloud deve ser explicito, controlado por budget e justificado por complexidade.",
    "- A memoria do projeto preserva contexto, mas deve ser redigida e versionavel.",
    "",
    "### Operacao de baixo custo",
    "",
    "- Respostas simples: Ollama local com contexto curto.",
    "- Revisao e planejamento: Ollama + contexto selecionado + memoria resumida.",
    "- Tarefas complexas: handoff para Codex ou Claude Code somente quando necessario, sem chamada cloud pelo AdoneX.",
    "- Ruflo: usado para especializacao e decisao, mas com consolidacao para evitar custo e lentidao.",
    "- Validacao padrao: `npm run check` como gate principal do workspace.",
    "",
    "### Riscos principais",
    "",
    "- Modelos locais pequenos podem gerar respostas superficiais se o prompt exigir profundidade executiva sem rota apropriada.",
    "- Ativar 60 agentes como 60 chamadas LLM reais em CPU/RAM limitada tende a piorar latencia.",
    "- O projeto ainda precisa manter disciplina de testes, memoria e contratos para nao virar apenas um conjunto de scripts.",
    "- Para virar produto SaaS, ainda sao necessarios controles de usuario, billing, observabilidade, isolamento multi-tenant e suporte operacional.",
    "",
    "### O que foi detectado",
    "",
    `- Stack: ${stack}`,
    `- Confianca da deteccao Synapse: ${Math.round(snapshot.synapseConfidence * 100)}%`,
    `- Sinais: ${signals}`,
    `- Rota recomendada: ${plan.recommendedExecution ?? "adonex-local"}`,
    `- Comando de validacao principal: ${plan.commands[0] ?? "npm run check"}`,
    "",
    "### Leitura executiva",
    "",
    "O Synapse deve ser visto como um produto de engenharia de IA local-first: ele combina automacao, agentes e governanca para criar projetos melhores com menos custo de tokens. O caminho mais forte e manter o Ollama para baixo custo e velocidade, Ruflo para coordenacao especializada, MCP para ferramentas seguras, e Codex/OpenAI como canal separado para tarefas que exigem raciocinio ou edicao complexa, acionado fora do AdoneX.",
    "",
    "### Arquivos usados como contexto",
    "",
    files.length ? files.map((file) => `- \`${file}\``).join("\n") : "- Nenhum arquivo selecionado.",
    ...(errorMessage
      ? [
          "",
          "### Observacao",
          "",
          `Resposta local de emergencia sem nova geracao do Ollama. Detalhe tecnico: ${errorMessage}. Use "AdoneX: Test Ollama Connection" se isso persistir.`
        ]
      : [])
  ].join("\n");
}

function createAnalyzedSynapseFallback(
  prompt: string,
  snapshot: WorkspaceSnapshot,
  plan: TaskPlan,
  errorMessage: string,
  analysis: ReturnType<typeof analyzePromptForFallback>
): string {
  const files = plan.filesToRead.slice(0, 8);
  const signals = snapshot.synapseSignals.length
    ? snapshot.synapseSignals.join(", ")
    : "sinais nao informados";
  const stack = snapshot.stack.length ? snapshot.stack.join(", ") : "stack nao inferida";
  const missing = analysis.missingBriefingFields.length
    ? analysis.missingBriefingFields.map((field) => `- \`${field}\``).join("\n")
    : "- Nenhuma lacuna obrigatoria detectada para responder a pergunta.";
  return [
    "## Ollama local nao concluiu a resposta",
    "",
    "Sim, temos analisador de perguntas. Ele foi executado antes do fallback, mas a chamada do modelo local nao terminou dentro do timeout configurado.",
    "",
    "### Analise da pergunta",
    "",
    `- Pergunta recebida: ${prompt.trim() || "(vazia)"}`,
    `- Intencao: ${analysis.intent}`,
    `- Tipo de solicitacao: ${analysis.requestType}`,
    `- Acao roteada: ${plan.action}`,
    `- Rota recomendada: ${plan.recommendedExecution ?? "adonex-local"}`,
    `- Comandos citados: ${analysis.commands.length ? analysis.commands.join(", ") : "nenhum"}`,
    `- Arquivos citados: ${analysis.files.length ? analysis.files.join(", ") : "nenhum"}`,
    "",
    "### Contexto selecionado",
    "",
    `- Stack: ${stack}`,
    `- Confianca Synapse: ${Math.round(snapshot.synapseConfidence * 100)}%`,
    `- Sinais: ${signals}`,
    `- Arquivos para leitura: ${files.length ? files.map((file) => `\`${file}\``).join(", ") : "nenhum"}`,
    "",
    "### Lacunas de briefing",
    "",
    missing,
    "",
    "### Diagnostico do modelo local",
    "",
    `- Falha: ${errorMessage}`,
    "- Nenhuma resposta gerada pelo Ollama foi usada.",
    "- Nao houve fallback para cloud.",
    "- Nao vou apresentar resposta pronta como se fosse analise do modelo.",
    "",
    "### Proximo passo recomendado",
    "",
    analysis.nextStep,
    "",
    "_Isto e um diagnostico analisado pelo AdoneX local apos timeout do Ollama, nao uma resposta deterministica do modelo._"
  ].join("\n");
}

function analyzePromptForFallback(prompt: string, plan: TaskPlan): {
  intent: string;
  requestType: string;
  commands: string[];
  files: string[];
  missingBriefingFields: string[];
  nextStep: string;
} {
  const normalized = stripAccents(prompt.toLowerCase());
  const commands = extractCommands(prompt);
  const files = extractFiles(prompt);
  const isImplementation = /\b(implemente|crie|adicione|altere|corrija|ajuste|edite|programe|refatore)\b/.test(normalized);
  const isQuestion = /\b(o que|como|porque|por que|qual|quais|explique|explica|verifique)\b/.test(normalized);
  const isModelQuestion = /\b(modelo|modelos|ollama|llm|qwen|deepseek|embedding)\b/.test(normalized);
  const isSolutionFactory = /\b(projeto|solucao|solution factory|ml|ia|rag|mcp|chatbot|chatbolt|agente|hibrido)\b/.test(normalized);
  const missingBriefingFields = isSolutionFactory && isImplementation
    ? missingBriefing(normalized)
    : [];
  const intent = isModelQuestion
    ? "inventario-ou-roteamento-de-modelos"
    : isImplementation
      ? "implementacao-ou-correcao"
      : isQuestion
        ? "pergunta-tecnica"
        : "solicitacao-geral";
  const requestType = plan.action === "synapse_explain"
    ? "explicacao-synapse"
    : plan.action === "chat"
      ? "pergunta-aberta"
      : plan.action;
  return {
    intent,
    requestType,
    commands,
    files,
    missingBriefingFields,
    nextStep: nextStepFor(intent, missingBriefingFields)
  };
}

function missingBriefing(normalized: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["business_problem", /\b(problema de negocio|resolver|dor|objetivo)\b/],
    ["requested_universe", /\b(ml|ia|rag|mcp|chatbot|chatbolt|hibrido|hybrid)\b/],
    ["success_metric_or_acceptance_criteria", /\b(metrica|kpi|criterio|aceite|sucesso)\b/],
    ["available_data_or_knowledge_sources", /\b(dados|documentos|fontes|base|dataset|sistema)\b/],
    ["risk_level", /\b(baixo|medio|alto|critico|risco)\b/]
  ];
  return checks
    .filter(([, pattern]) => !pattern.test(normalized))
    .map(([field]) => field);
}

function nextStepFor(intent: string, missingFields: string[]): string {
  if (missingFields.length) {
    return "Complete os campos faltantes no chat; depois o AdoneX deve consultar o BusinessSolutionAnalyzer antes de implementar.";
  }
  if (intent === "inventario-ou-roteamento-de-modelos") {
    return "Repetir a pergunta com o perfil rapido `qwen3-coder-14b-team`, contexto menor e saida curta.";
  }
  if (intent === "implementacao-ou-correcao") {
    return "Transformar a solicitacao em tarefa governada para patch/testes, ou repetir com escopo menor para o Ollama local.";
  }
  return "Repetir a pergunta com escopo menor ou aumentar o timeout local se o modelo estiver carregando em CPU/RAM.";
}

function extractCommands(prompt: string): string[] {
  const matches = prompt.match(/`[^`]+`|(?:npm|pnpm|yarn|python|pytest|powershell|git)\s+[^\n.;]+/gi) ?? [];
  return matches.map((match) => match.replace(/^`|`$/g, "").trim()).slice(0, 6);
}

function extractFiles(prompt: string): string[] {
  const matches = prompt.match(/\b[\w./\\-]+\.(?:py|ts|tsx|js|json|md|yaml|yml|toml|ps1)\b/gi) ?? [];
  return Array.from(new Set(matches)).slice(0, 8);
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

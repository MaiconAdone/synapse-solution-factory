import type { AgentAction, AgentMode } from "../llm/types";

export const ADONEX_CHAT_PARTICIPANT_ID = "synapse-ai.adonex";

export interface ChatRoute {
  action: AgentAction;
  mode: AgentMode;
  title: string;
  governed: boolean;
  defaultPrompt?: string;
}

export interface ParsedChatInput {
  command?: string;
  prompt: string;
}

export interface SolutionFactoryDialogCheck {
  applies: boolean;
  missingFields: string[];
  questions: string[];
}

const ROUTES: Record<string, ChatRoute> = {
  plan: {
    action: "plan",
    mode: "local",
    title: "Technical plan",
    governed: false
  },
  planejar: {
    action: "plan",
    mode: "local",
    title: "Technical plan",
    governed: false
  },
  implement: {
    action: "implement",
    mode: "local",
    title: "Governed implementation",
    governed: true
  },
  review: {
    action: "review",
    mode: "local",
    title: "Code review",
    governed: false
  },
  test: {
    action: "test",
    mode: "local",
    title: "Governed test execution",
    governed: true
  },
  agent: {
    action: "synapse_agent",
    mode: "synapse",
    title: "Synapse agent",
    governed: true
  },
  mcp: {
    action: "synapse_mcp",
    mode: "synapse",
    title: "Synapse MCP tool",
    governed: true
  },
  projeto: {
    action: "synapse_agent",
    mode: "synapse",
    title: "Synapse solution project",
    governed: true
  },
  project: {
    action: "synapse_agent",
    mode: "synapse",
    title: "Synapse solution project",
    governed: true
  },
  roadmap: {
    action: "synapse_roadmap",
    mode: "synapse",
    title: "Synapse roadmap",
    governed: false,
    defaultPrompt:
      "Generate a pragmatic Synapse engineering roadmap focused on quality, governance, and low-cost local-first AI."
  }
};

const DEFAULT_ROUTE: ChatRoute = {
  action: "chat",
  mode: "local",
  title: "Engineering guidance",
  governed: false
};

export function routeChatCommand(command?: string, prompt = ""): ChatRoute {
  if (command) return ROUTES[command] ?? DEFAULT_ROUTE;
  return inferNaturalLanguageRoute(prompt);
}

export function resolveChatPrompt(
  prompt: string,
  route: ChatRoute
): string | undefined {
  const normalized = prompt.trim();
  if (normalized) return normalized;
  return route.defaultPrompt;
}

export function isCreationRoute(route: ChatRoute): boolean {
  return route.action === "synapse_agent" || route.action === "synapse_mcp";
}

export function checkSolutionFactoryDialog(
  prompt: string,
  route: ChatRoute
): SolutionFactoryDialogCheck {
  const normalized = stripAccents(prompt.toLowerCase());
  const applies = isSolutionFactoryPrompt(normalized, route);
  if (!applies) {
    return { applies: false, missingFields: [], questions: [] };
  }

  const checks: Array<[string, boolean, string]> = [
    [
      "project_goal",
      hasProjectGoal(normalized),
      "Qual e o objetivo do projeto ou da funcionalidade?"
    ],
    [
      "business_problem",
      hasBusinessProblem(normalized),
      "Qual problema de negocio essa solucao precisa resolver?"
    ],
    [
      "requested_universe",
      hasRequestedUniverse(normalized),
      "Qual universo devemos usar: ML/DL/series temporais, IA/RAG/MCP/agentes, Chatbolt ou hibrido?"
    ],
    [
      "success_metric_or_acceptance_criteria",
      hasSuccessMetric(normalized),
      "Qual metrica de sucesso, KPI ou criterio de aceite define que funcionou?"
    ],
    [
      "available_data_or_knowledge_sources",
      hasAvailableSources(normalized),
      "Quais dados, documentos, bases ou fontes de conhecimento estao disponiveis?"
    ],
    [
      "risk_level",
      hasRiskLevel(normalized),
      "Qual o nivel de risco esperado: baixo, medio, alto ou critico?"
    ]
  ];
  const missing = checks.filter(([, present]) => !present);
  return {
    applies: true,
    missingFields: missing.map(([field]) => field),
    questions: missing.map(([, , question]) => question).slice(0, 5)
  };
}

export function renderSolutionFactoryMissingInfo(
  check: SolutionFactoryDialogCheck
): string {
  if (!check.applies || !check.missingFields.length) return "";
  return [
    "Antes de criar ou implementar a solucao pelo chat, preciso completar o briefing minimo do Synapse.",
    "",
    `Campos faltantes: ${check.missingFields.map((field) => `\`${field}\``).join(", ")}.`,
    "",
    ...check.questions.map((question) => `- ${question}`),
    "",
    "Depois disso eu consulto o BusinessSolutionAnalyzer, gero/atualizo `config/business_solution_analysis.json` e sigo com testes, evals, governanca e custo local-first. Nao vou abrir navegador nem depender de task do VS Code."
  ].join("\n");
}

export function parseChatInput(
  command: string | undefined,
  prompt: string
): ParsedChatInput {
  let normalized = prompt.trim();
  while (/^@adonex\b/i.test(normalized)) {
    normalized = normalized.replace(/^@adonex\b/i, "").trim();
  }
  if (command) {
    return {
      command,
      prompt: normalized.replace(new RegExp(`^/${escapeRegExp(command)}\\b`, "i"), "").trim()
    };
  }
  const inline = /^\/([a-z0-9-]+)\b\s*/i.exec(normalized);
  if (!inline) return { prompt: normalized };
  return {
    command: inline[1].toLowerCase(),
    prompt: normalized.slice(inline[0].length).trim()
  };
}

export function extractPrimaryTask(task: string): string {
  return task
    .split(/\n\n(?:Recent user context|Attached workspace references):/i, 1)[0]
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferNaturalLanguageRoute(prompt: string): ChatRoute {
  const normalized = prompt.toLowerCase();
  const asksForImplementation =
    /\b(corrij[ae]|corrigir|consert[ae]|consertar|repar[ae]|reparar|implemente|implementar|adicione|adicionar|remova|remover|altere|alterar|alteracoes|altera[cç][aã]o|ajuste|ajustar|evolua|evoluir|melhore|melhorar|edite|editar|programe|programar|codifique|codificar|modifique|modificar|refatore|refatorar)\b/.test(
      normalized
    );
  const asksSynapseExplanation =
    /\b(explique|explica|explicacao|explicacao|descreva|o que e|resuma|apresente|visao geral)\b/.test(
      stripAccents(normalized)
    ) && /\b(projeto\s+)?synapse\b/.test(stripAccents(normalized));
  const asksSynapseModelInventory =
    /\bsynapse\b/.test(stripAccents(normalized)) &&
    /\b(modelo|modelos|model|models|ollama|llm|qwen|deepseek|embedding|3b|8b)\b/.test(
      stripAccents(normalized)
    );
  if (asksForImplementation) {
    return {
      ...ROUTES.implement,
      mode: explicitExternalModelRequested(normalized) ? "strong" : ROUTES.implement.mode,
      title: "Governed correction"
    };
  }
  if (asksSynapseModelInventory) {
    return {
      action: "synapse_explain",
      mode: "local",
      title: "Inventario de Modelos Synapse",
      governed: false
    };
  }
  if (asksSynapseExplanation) {
    return {
      action: "synapse_explain",
      mode: "local",
      title: "Explicacao Executiva do Projeto Synapse",
      governed: false
    };
  }
  if (
    /\b(execute|rode|rodar|executar)\b.*\b(testes?|pytest|npm test|compile|build)\b/.test(
      normalized
    )
  ) {
    return ROUTES.test;
  }
  if (
    /\b(verifique|revise|analise|investigue|encontre)\b.*\b(erros?|bugs?|falhas?|projeto|codigo|cÃ³digo)\b/.test(
      normalized
    )
  ) {
    return {
      ...ROUTES.test,
      title: "Governed project verification"
    };
  }
  return DEFAULT_ROUTE;
}

function isSolutionFactoryPrompt(normalized: string, route: ChatRoute): boolean {
  if (["synapse_agent", "synapse_mcp"].includes(route.action)) return true;
  const asksToBuild =
    /\b(crie|criar|novo|nova|gerar|monte|montar|implemente|construa|desenhe|planeje|planejar)\b/.test(
      normalized
    );
  const solutionSignal =
    /\b(projeto|solucao|factory|fabrica|synapse|ml|machine learning|deep learning|rede neural|redes neurais|serie temporal|series temporais|ia|ai|rag|mcp|chatbot|chatbolt|agente|agentes|multiagente)\b/.test(
      normalized
    );
  const businessSignal =
    /\b(negocio|empresa|corporativo|cliente|venda|receita|churn|demanda|estoque|risco|fraude|atendimento|suporte|documento|contrato|processo)\b/.test(
      normalized
    );
  return asksToBuild && solutionSignal && (businessSignal || /\bsynapse\b/.test(normalized));
}

function explicitExternalModelRequested(normalized: string): boolean {
  return (
    /\b(modelo externo|llm externo|openai|gpt|cloud|nuvem|externo)\b/.test(
      normalized
    ) &&
    !/\b(sem cloud|sem nuvem|ollama|local-only|somente local)\b/.test(normalized)
  );
}

function hasProjectGoal(normalized: string): boolean {
  return /\b(objetivo|quero|preciso|para|finalidade|meta|criar|implementar|prever|classificar|automatizar|responder|atender|recomendar)\b/.test(
    normalized
  );
}

function hasBusinessProblem(normalized: string): boolean {
  return /\b(problema de negocio|problema|dor|resolver|reduzir|aumentar|melhorar|otimizar|prever|detectar|classificar|automatizar|vendas|receita|churn|fraude|demanda|estoque|atendimento|suporte|lead|cliente)\b/.test(
    normalized
  );
}

function hasRequestedUniverse(normalized: string): boolean {
  return /\b(ml|machine learning|deep learning|dl|rede neural|redes neurais|serie temporal|series temporais|ia|ai|rag|mcp|chatbot|chatbolt|agente|agentes|multiagente|hibrido|hybrid)\b/.test(
    normalized
  );
}

function hasSuccessMetric(normalized: string): boolean {
  return /\b(metrica|metricas|kpi|criterio de aceite|criterios de aceite|sucesso|acuracia|accuracy|precisao|recall|f1|mae|rmse|mape|latencia|custo|roi|conversao|sla|tempo de resposta|satisfacao)\b/.test(
    normalized
  );
}

function hasAvailableSources(normalized: string): boolean {
  return /\b(dados|dataset|base|csv|excel|json|parquet|documento|documentos|fonte|fontes|knowledge|pdf|planilha|crm|erp|banco de dados|api|logs|historico|data\/raw)\b/.test(
    normalized
  );
}

function hasRiskLevel(normalized: string): boolean {
  return /\b(risco baixo|risco medio|risco alto|risco critico|baixo risco|medio risco|alto risco|critico|lgpd|pii|sensivel|financeiro|juridico|compliance|saude|seguranca)\b/.test(
    normalized
  );
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

import * as fs from "node:fs";
import * as path from "node:path";

export interface RufloCouncilAgent {
  id: string;
  tier: "core" | "specialist" | "unknown";
  domain: string;
  cognitivePattern: string;
  memory: string;
  mission: string;
}

export interface RufloCouncilContext {
  enabled: boolean;
  totalAgents: number;
  activeAgents: number;
  llmCalls: number;
  domains: string[];
  strategy: string;
  selectedAgents: RufloCouncilAgent[];
  leadAgent?: RufloCouncilAgent;
  executionProfile: string;
  text: string;
}

const FALLBACK_AGENTS: RufloCouncilAgent[] = [
  agent("orchestration-manager", "core", "orchestration", "systems", "semantic", "Consolida o conselho Ruflo, define plano e resolve conflitos."),
  agent("product-strategy", "core", "product", "strategic", "semantic", "Conecta a tarefa a objetivo de negocio e criterios de aceite."),
  agent("data-engineering", "core", "data", "systems", "semantic", "Garante contratos, qualidade, linhagem e tratamento de dados."),
  agent("data-science", "core", "analytics", "critical", "semantic", "Valida estatistica, amostragem, vieses e metricas."),
  agent("machine-learning", "core", "ml", "critical", "semantic", "Define baseline, treino, avaliacao, drift e model card."),
  agent("llm-engineering", "core", "llm", "adaptive", "semantic", "Projeta prompts, ferramentas, guardrails e agentes."),
  agent("rag-engineering", "core", "rag", "systems", "semantic", "Projeta ingestao, retrieval, rerank, citacao e avaliacao RAG."),
  agent("backend-engineering", "core", "backend", "convergent", "episodic", "Garante APIs, schemas, erros, auth e contratos FastAPI."),
  agent("frontend-engineering", "core", "frontend", "convergent", "episodic", "Garante experiencia React/Next.js consistente e funcional."),
  agent("integration-automation", "core", "integration", "adaptive", "episodic", "Integra Codex, Ruflo, MCP, automacoes e ferramentas."),
  agent("security-compliance", "core", "security", "critical", "semantic", "Revisa privacidade, permissoes, secrets e limites de autonomia."),
  agent("observability-ops", "core", "operations", "systems", "episodic", "Define logs, metricas, traces, custo e saude operacional."),
  agent("devops", "core", "platform", "critical", "episodic", "Valida Docker, CI, release, runtime e portabilidade."),
  agent("testing-qa", "core", "quality", "critical", "episodic", "Define testes unitarios, integracao, regressao e adversariais."),
  agent("documentation", "core", "docs", "convergent", "episodic", "Gera resumo tecnico, runbook e proximos passos.")
];

export function buildRufloCouncilContext(
  workspaceRoot: string,
  task: string,
  options: {
    enabled: boolean;
    maxAgents: number;
    llmConcurrency: number;
    maxChars: number;
    action?: string;
    localModelProfile?: string;
  }
): RufloCouncilContext {
  if (!options.enabled) {
    return {
      enabled: false,
      totalAgents: 0,
      activeAgents: 0,
      llmCalls: 0,
      domains: [],
      strategy: "disabled",
      selectedAgents: [],
      executionProfile: "disabled",
      text: "Ruflo council disabled."
    };
  }

  const agents = readEnterpriseAgents(workspaceRoot);
  const maxAgents = Math.max(1, Math.min(options.maxAgents, agents.length || 60));
  const selectedAgents = rankAgentsForTask(agents, task).slice(0, maxAgents);
  const leadAgent = selectedAgents[0];
  const llmConcurrency = Math.max(1, Math.min(options.llmConcurrency, 4));
  const domains = [...new Set(selectedAgents.map((item) => item.domain))];
  const strategy = councilStrategy(task, options.action, options.localModelProfile, selectedAgents.length);
  const executionProfile = profileForAgent(leadAgent, options.localModelProfile);
  const lines = [
    selectedAgents.length >= 60
      ? "RUFLO 60-AGENT COUNCIL ACTIVE."
      : "RUFLO SELECTIVE COUNCIL ACTIVE.",
    `Activation strategy: ${strategy}.`,
    `Execution policy: ${selectedAgents.length}/${agents.length} Ruflo roles are available for this task; ${leadAgent?.id ?? "orchestration-manager"} is the directly executed lead and the remaining roles are compressed reviewers.`,
    `Direct local agent: adopt the mission, domain and cognitive pattern of ${leadAgent?.id ?? "orchestration-manager"} for this Ollama generation.`,
    `Ollama policy: use profile ${executionProfile}, consolidate into at most ${llmConcurrency} local model call(s), and do not create ${selectedAgents.length} separate generations. Prefer one final answer in concise Portuguese Brazil.`,
    "Consensus policy: orchestration-manager resolves conflicts; security-compliance, cost-optimizer, token-budget-analyst and testing-qa can veto unsafe or expensive actions.",
    "Context policy: use role-specific reasoning, avoid secrets, compress evidence, cite only relevant files, and keep cloud cost at zero unless the user explicitly asks for cloud.",
    `Active domains: ${domains.join(", ") || "none"}.`,
    "Quality gates for AdoneX code edits: smallest safe patch, existing patterns first, validation command, rollback note for risky changes, memory summary after completion.",
    "Active Ruflo roles:",
    ...selectedAgents.map(
      (item, index) =>
        `${index + 1}. ${item.id} [${item.tier}/${item.domain}; ${item.cognitivePattern}; memory=${item.memory}] - ${compressMission(item.mission)}`
    ),
    "Council answer contract: return the consolidated decision, selected architecture or patch strategy, risks, tests, and next action. Mention when local Ollama is insufficient."
  ];
  const text = lines.join("\n").slice(0, Math.max(1_000, options.maxChars));
  return {
    enabled: true,
    totalAgents: agents.length,
    activeAgents: selectedAgents.length,
    llmCalls: llmConcurrency,
    domains,
    strategy,
    selectedAgents,
    leadAgent,
    executionProfile,
    text
  };
}

export function profileForAgent(
  agentItem: RufloCouncilAgent | undefined,
  requestedProfile?: string
): string {
  if (requestedProfile && requestedProfile !== "auto") return requestedProfile;
  const domain = agentItem?.domain ?? "orchestration";
  if (["backend", "frontend", "integration", "platform"].includes(domain)) return "code_strong";
  if (["quality", "security"].includes(domain)) return "code_review";
  if (["orchestration", "product", "operations", "docs"].includes(domain)) return "fast";
  if (["ml", "data", "analytics", "llm", "rag"].includes(domain)) return "reasoning_strong";
  return "fast";
}

export function readEnterpriseAgents(workspaceRoot: string): RufloCouncilAgent[] {
  const agentsPath = path.join(
    workspaceRoot,
    "agents",
    "definitions",
    "enterprise_agents.yaml"
  );
  if (!fs.existsSync(agentsPath)) {
    return expandFallbackAgents();
  }
  const content = fs.readFileSync(agentsPath, "utf8");
  const agents: RufloCouncilAgent[] = [];
  let current: Partial<RufloCouncilAgent> | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const id = line.match(/^-\s+id:\s*(.+)$/);
    if (id) {
      if (current?.id) agents.push(normalizeAgent(current));
      current = { id: id[1].trim() };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    if (key === "tier") current.tier = normalizeTier(value);
    if (key === "domain") current.domain = value.trim();
    if (key === "cognitive_pattern") current.cognitivePattern = value.trim();
    if (key === "memory") current.memory = value.trim();
    if (key === "mission") current.mission = value.trim();
  }
  if (current?.id) agents.push(normalizeAgent(current));
  return agents.length ? agents : expandFallbackAgents();
}

function rankAgentsForTask(
  agents: RufloCouncilAgent[],
  task: string
): RufloCouncilAgent[] {
  const lower = task.toLowerCase();
  const scored = agents.map((agentItem, index) => {
    const haystack = [
      agentItem.id,
      agentItem.tier,
      agentItem.domain,
      agentItem.cognitivePattern,
      agentItem.memory,
      agentItem.mission
    ].join(" ").toLowerCase();
    let score = agentItem.tier === "core" ? 20 : 10;
    for (const term of lower.split(/\W+/)) {
      if (term.length > 3 && haystack.includes(term)) score += 8;
    }
    if (/\b(rag|retrieval|vetor|vector|embedding|chunk)\b/i.test(lower) && agentItem.domain === "rag") score += 18;
    if (/\b(ml|machine|modelo|treino|drift|dataset|dados)\b/i.test(lower) && ["ml", "data", "analytics"].includes(agentItem.domain)) score += 18;
    if (/\b(agent|agente|multiagente|ruflo|mcp|tool|function)\b/i.test(lower) && ["llm", "orchestration", "integration"].includes(agentItem.domain)) score += 18;
    if (/\b(seguranca|auth|login|secret|lgpd|permiss)\b/i.test(lower) && agentItem.domain === "security") score += 18;
    if (/\b(custo|token|latencia|rapido|ollama|local)\b/i.test(lower) && agentItem.domain === "operations") score += 18;
    if (/\b(api|fastapi|postgres|backend)\b/i.test(lower) && agentItem.domain === "backend") score += 18;
    if (/\b(react|next|frontend|ui|tela)\b/i.test(lower) && agentItem.domain === "frontend") score += 18;
    if (/\b(teste|valid|erro|bug|regress)\b/i.test(lower) && agentItem.domain === "quality") score += 18;
    return { agentItem, score, index };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.agentItem);
}

function councilStrategy(
  task: string,
  action: string | undefined,
  localModelProfile: string | undefined,
  activeAgents: number
): string {
  const text = task
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const explicitFull = /\b(60 agentes|todos os agentes|full council|conselho completo)\b/.test(text);
  if (explicitFull && activeAgents >= 60) return "full-60-explicit";
  if (["implement", "fix"].includes(action ?? "")) {
    return `code-edit-${localModelProfile ?? "auto"}-${activeAgents}-roles`;
  }
  if (/\b(arquitetura|governanca|roadmap|agentic|multiagente|mcp|rag)\b/.test(text)) {
    return `architecture-${localModelProfile ?? "auto"}-${activeAgents}-roles`;
  }
  if (/\b(teste|validacao|bug|erro|falha|security|seguranca)\b/.test(text)) {
    return `quality-${localModelProfile ?? "auto"}-${activeAgents}-roles`;
  }
  return `focused-${localModelProfile ?? "auto"}-${activeAgents}-roles`;
}

function compressMission(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function normalizeAgent(value: Partial<RufloCouncilAgent>): RufloCouncilAgent {
  return {
    id: value.id ?? "unknown-agent",
    tier: value.tier ?? "unknown",
    domain: value.domain ?? "general",
    cognitivePattern: value.cognitivePattern ?? "systems",
    memory: value.memory ?? "semantic",
    mission: value.mission ?? "Review the task and report constraints, risks, tests, and next steps."
  };
}

function normalizeTier(value: string): RufloCouncilAgent["tier"] {
  const tier = value.trim();
  return tier === "core" || tier === "specialist" ? tier : "unknown";
}

function agent(
  id: string,
  tier: RufloCouncilAgent["tier"],
  domain: string,
  cognitivePattern: string,
  memory: string,
  mission: string
): RufloCouncilAgent {
  return { id, tier, domain, cognitivePattern, memory, mission };
}

function expandFallbackAgents(): RufloCouncilAgent[] {
  const agents = [...FALLBACK_AGENTS];
  for (let index = agents.length + 1; index <= 60; index += 1) {
    agents.push(
      agent(
        `Synapse-specialist-${index}`,
        "specialist",
        "general",
        "critical",
        "semantic",
        "Aplica revisao especializada de arquitetura, custo, seguranca e qualidade."
      )
    );
  }
  return agents;
}

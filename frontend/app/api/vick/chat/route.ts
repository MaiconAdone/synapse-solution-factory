import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type VickMessage = {
  role: "vick" | "user";
  text: string;
};

type VickRequest = {
  prompt?: string;
  history?: VickMessage[];
};

type ProbeResult<T> = {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
};

type UserSentiment =
  | "frustrado"
  | "ansioso"
  | "confuso"
  | "com_pressa"
  | "satisfeito"
  | "neutro";

function inferSentiment(text: string): { sentiment: UserSentiment; confidence: "low" | "medium" | "high" } {
  const t = normalizeText(text);

  const has = (re: RegExp) => re.test(t);

  if (has(/\b(nao funciona|n[oã]o deu|quebrou|erro|bug|odeio|ridiculo|droga|inferno|raiva|irritad|frustrad|cansei)\b/)) {
    return { sentiment: "frustrado", confidence: "high" };
  }
  if (has(/\b(ansios|preocupad|com medo|tenso|nervos|urgente|socorro)\b/)) {
    return { sentiment: "ansioso", confidence: "medium" };
  }
  if (has(/\b(n[oã]o entendi|confus|perdid|como assim|na pratica|me explica|explica melhor|qual a diferenca)\b/)) {
    return { sentiment: "confuso", confidence: "medium" };
  }
  if (has(/\b(rapido|logo|agora|pra ontem|sem enrolacao|direto ao ponto|to com pressa)\b/)) {
    return { sentiment: "com_pressa", confidence: "medium" };
  }
  if (has(/\b(obrigad|valeu|perfeito|boa|show|top|excelente|funcionou|resolveu)\b/)) {
    return { sentiment: "satisfeito", confidence: "medium" };
  }

  return { sentiment: "neutro", confidence: "low" };
}

function sentimentPrefix(sentiment: UserSentiment): string {
  switch (sentiment) {
    case "frustrado":
      return "Entendi — isso é chato mesmo. Vamos resolver juntos: ";
    case "ansioso":
      return "Entendi a urgência. Vou ser bem objetiva: ";
    case "confuso":
      return "Sem problema — eu explico passo a passo: ";
    case "com_pressa":
      return "Fechado — indo direto ao ponto: ";
    case "satisfeito":
      return "Boa! ";
    default:
      return "";
  }
}

function truncateForLog(text: string, max = 220): string {
  const cleaned = cleanText(text);
  const redacted = cleaned
    .replace(/\bsk-[a-z0-9]{16,}\b/gi, "[redacted]")
    .replace(/\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/\bbearer\s+[a-z0-9\-._~+/]+=*/gi, "bearer [redacted]")
    .replace(/\b(authorization)\s*[:=]\s*[^\s]+/gi, "$1=[redacted]");
  return redacted.slice(0, max);
}

// Registra cada chamada LLM no mesmo ledger real usado pelo backend
// (artifacts/llm-routing/events.jsonl), para que o "Custo hoje" do cockpit
// reflita o uso real da Vick web, não dados de demonstração.
async function recordLlmUsage(input: {
  workspaceRoot: string;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  fallbackUsed: boolean;
}) {
  const file = path.join(input.workspaceRoot, "artifacts", "llm-routing", "events.jsonl");
  const event = {
    timestamp: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    latency_ms: Math.round(input.latencyMs),
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.promptTokens + input.completionTokens,
    fallback_used: input.fallbackUsed,
    quality_passed: true,
    complex: false,
    sensitive: false,
    source: "vick-web",
  };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Telemetria é best-effort; nunca bloqueia a resposta ao usuário.
  }
}

async function appendSentimentToSharedMemory(input: {
  workspaceRoot: string;
  sentiment: UserSentiment;
  confidence: "low" | "medium" | "high";
  prompt: string;
}) {
  const memoryPath = path.join(input.workspaceRoot, ".adonex", "memory", "SHARED_DIALOG_MEMORY.md");
  const line = `- [vick] ${new Date().toISOString()} sentimento=${input.sentiment} confianca=${input.confidence} prompt="${truncateForLog(input.prompt)}"\n`;
  try {
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.appendFile(memoryPath, line, "utf8");
  } catch {
    // Se a memória ainda não existe, não bloqueia a conversa.
  }
}

// Cliente do backend governado do Synapse. Toda ação real da Vick passa por
// aqui — nada de caminho paralelo sem auditoria.
async function backend<T>(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<ProbeResult<T>> {
  const baseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const apiKey = process.env.SYNAPSE_API_KEY ?? process.env.APP_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 20_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    if (apiKey) headers["X-API-Key"] = apiKey;
    const response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.name === "AbortError"
            ? "timeout"
            : error.message
          : "erro desconhecido",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Ponte HTTP local do AdoneX (extensão do VS Code). É o único caminho que
// realmente edita arquivos — o /swarm/governed só raciocina e audita.
// Requer adonex.bridge.enabled + adonex.bridge.token no VS Code, e o mesmo
// token em ADONEX_BRIDGE_TOKEN aqui.
async function adonexBridge<T>(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<ProbeResult<T>> {
  const baseUrl = process.env.ADONEX_BRIDGE_URL ?? "http://127.0.0.1:8766";
  const token = process.env.ADONEX_BRIDGE_TOKEN ?? "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 10_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["X-Adonex-Token"] = token;
    const response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.name === "AbortError"
            ? "timeout"
            : error.message
          : "erro desconhecido",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function backendDownMessage(error?: string) {
  return `Não consegui falar com o backend do Synapse (${error ?? "indisponível"}). Inicie a task "Dev: Backend FastAPI no VS Code" e tente de novo.`;
}

// Executa de fato uma edição/melhoria: AdoneX (que escreve os arquivos) primeiro,
// com fallback para o fluxo governado (raciocina/audita, não escreve). Usado
// tanto pelo auto-apply quanto por um "confirma" explícito. `human_approved` é
// sempre true aqui: quem chama já decidiu executar (autonomia configurada pelo
// dono do ambiente — ver adonex.security.* e adonex.voice.requireConfirmationForPatch).
async function runGovernedEdit(input: {
  requestText: string;
  sentiment: UserSentiment;
  model: string;
  projects: string[];
  auto: boolean;
}) {
  const prefix = sentimentPrefix(input.sentiment);
  const opening = input.auto ? "Aplicando" : "Aprovado. Mandei para o AdoneX";

  const bridged = await adonexBridge<{ accepted?: boolean; routed?: string }>("/command", {
    method: "POST",
    body: { transcript: input.requestText },
    timeoutMs: 15_000,
  });
  if (bridged.ok) {
    const health = await adonexBridge<{ applyMode?: string; requiresConfirmation?: boolean }>(
      "/health",
      { timeoutMs: 5000 },
    );
    const applying =
      health.ok && health.data?.applyMode === "apply" && health.data?.requiresConfirmation === false;
    return NextResponse.json({
      response:
        prefix +
        `${opening}: "${input.requestText}". ${
          applying
            ? "O AdoneX está aplicando o patch automaticamente no VS Code (há undo/rollback por git se precisar)."
            : "O AdoneX vai preparar o patch e aguardar sua confirmação no VS Code."
        }`,
      provider: "adonex-bridge",
      model: input.model,
      context: { executed: true, via: "adonex", applying, auto: input.auto },
    });
  }

  // Sem a ponte: fluxo governado do backend (não escreve arquivos). Honesto.
  const executed = await backend<{ response?: string; summary?: string }>(
    "/swarm/governed/execute",
    {
      method: "POST",
      body: {
        prompt: input.requestText,
        universe: "hybrid",
        allow_cloud: false,
        activate_all_60: false,
        human_approved: true,
      },
      timeoutMs: 180_000,
    },
  );
  if (!executed.ok) {
    return NextResponse.json({
      response: prefix + backendDownMessage(executed.error),
      provider: "synapse-governed-swarm",
      model: input.model,
      context: { projects: input.projects, error: executed.error },
    });
  }
  const detail = cleanText(
    String(executed.data?.response ?? executed.data?.summary ?? "Execução concluída."),
  );
  return NextResponse.json({
    response:
      prefix +
      `Rodei o fluxo governado (análise e auditoria), mas a ponte do AdoneX está desligada, então nenhum arquivo foi alterado. Habilite adonex.bridge.enabled com o token no VS Code para eu editar de fato. ${detail.slice(0, 600)}`,
    provider: "synapse-governed-swarm",
    model: input.model,
    context: { projects: input.projects, executed: true, via: "governed-swarm", filesChanged: false },
  });
}

// O fallback antigo dizia "Estou online no Synapse" mesmo quando o modelo não
// respondia — parecia sucesso e escondia a falha. Seja explícita.
function ollamaDownMessage(model: string, reason: string) {
  return `Não consegui gerar a resposta com o modelo local agora (${reason}). Confira se o Ollama está ativo com o modelo ${model} e tente de novo.`;
}

// Chave normalizada (sem acento/travessão) do marcador de plano pendente. Ainda
// usada pelo caminho "confirma" (vestigial com a autonomia ligada, mas mantido
// para históricos antigos): comparar string exata quebra na menor diferença de
// encoding, e aí a aprovação nunca é reconhecida.
const PLAN_PENDING_KEY = "aguardando sua aprovacao";

// A rota é stateless: descobrimos pelo histórico se existe um plano pendente e
// qual foi o pedido original que o gerou.
function pendingPlanRequest(history: VickMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== "vick") continue;
    if (!normalizeText(message.text).includes(PLAN_PENDING_KEY)) return "";
    for (let back = index - 1; back >= 0; back -= 1) {
      if (history[back].role === "user") return cleanText(history[back].text);
    }
    return "";
  }
  return "";
}

async function probeJson<T>(url: string, timeoutMs: number): Promise<ProbeResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.name === "AbortError"
            ? "timeout"
            : error.message
          : "erro desconhecido",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function readSynapseContext() {
  const workspaceRoot = path.resolve(process.cwd(), "..");
  const projectsRoot = path.resolve(workspaceRoot, "..");
  const memoryPath = path.join(workspaceRoot, ".adonex", "memory", "SHARED_DIALOG_MEMORY.md");

  const projects = (await fs.readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "pt-BR"));

  let recentMemory = "";
  try {
    const memory = await fs.readFile(memoryPath, "utf8");
    recentMemory = memory
      .split(/\r?\n/)
      // Esta rota grava uma linha "[vick]" a cada request (sentimento, gate do
      // analisador). Realimentá-las no prompt mudava o contexto a cada turno e
      // derrubava o prefix cache do Ollama: a Vick envenenava o próprio cache.
      // Além disso é log dela mesma, não contexto útil para responder.
      .filter((line) => !/^- \[vick\] /.test(line))
      .join("\n")
      .trim()
      // Cada token aqui é reavaliado a cada turno. Nesta máquina (CPU, sem GPU)
      // isso custa caro — 3000 chars sozinhos valiam ~900 tokens de prompt eval.
      .slice(-600);
  } catch {
    // Inventory is still enough for local status answers.
  }

  return { projects, projectsRoot, recentMemory, workspaceRoot };
}

// Análise real do projeto: o backend devolve os metadados quase todos null,
// então a Vick olha o disco para dizer algo útil sobre o que existe ali.
// Read-only, leve (só o topo do diretório + arquivos-âncora), sem varrer a
// árvore inteira — é resposta de voz, tem que ser rápida e curta.
async function analyzeProjectOnDisk(projectPath: string) {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return null;
  }
  const names = new Set(entries.map((entry) => entry.name));
  const lower = entries.map((entry) => entry.name.toLowerCase());
  const has = (name: string) => names.has(name);
  // Casa variações como requirements-voice.txt / requirements-dev.txt.
  const hasLike = (re: RegExp) => lower.some((name) => re.test(name));

  const stack: string[] = [];
  if (has("package.json")) stack.push("Node/TypeScript");
  if (hasLike(/^requirements.*\.txt$/) || has("pyproject.toml") || has("setup.py"))
    stack.push("Python");
  if (has("Dockerfile") || hasLike(/^docker-compose\.ya?ml$/) || has("compose.yaml"))
    stack.push("Docker");
  if (has("go.mod")) stack.push("Go");
  if (has("Cargo.toml")) stack.push("Rust");

  const signals: string[] = [];
  if (has("tests") || has("test")) signals.push("tem camada de testes");
  else signals.push("SEM pasta de testes");
  if (has("docs")) signals.push("tem docs");
  if (has(".git")) signals.push("versionado em git");
  if (has(".adonex")) signals.push("registrado no AdoneX");
  if (has("README.md") || has("readme.md")) signals.push("tem README");

  let readmeLine = "";
  for (const candidate of ["README.md", "readme.md", "Readme.md"]) {
    if (!has(candidate)) continue;
    try {
      const text = await fs.readFile(path.join(projectPath, candidate), "utf8");
      readmeLine = cleanText(
        text
          .split(/\r?\n/)
          .map((line) => line.replace(/^#+\s*/, "").trim())
          .find((line) => line.length > 0) ?? "",
      ).slice(0, 160);
    } catch {
      // README ilegível não impede o resto da análise.
    }
    break;
  }

  const topDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .slice(0, 8);

  return {
    stack: stack.length > 0 ? stack.join(", ") : "stack não identificada pelos arquivos-âncora",
    signals,
    readmeLine,
    topDirs,
  };
}

function slugifyProjectName(text: string) {
  const slug = normalizeText(text)
    .replace(/\b(vick|vamos|criar|crie|um|uma|projeto|solucao|aplicacao|de|do|da|teste)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "projeto-vick";
}

async function uniqueProjectName(projectsRoot: string, baseName: string) {
  let candidate = baseName;
  let suffix = 2;
  while (true) {
    try {
      await fs.access(path.join(projectsRoot, candidate));
      candidate = `${baseName}-${suffix}`;
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

function answerAfterQuestion(messages: VickMessage[], questionPattern: RegExp) {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (
      question?.role === "vick" &&
      answer?.role === "user" &&
      questionPattern.test(normalizeText(question.text))
    ) {
      return cleanText(answer.text);
    }
  }
  return "";
}

function briefingFromConversation(history: VickMessage[], prompt: string) {
  const lastClosedBriefingIndex = history.reduce((lastIndex, message, index) => {
    if (
      message.role === "vick" &&
      /projeto criado com sucesso|solicitacao cancelada|briefing cancelado/.test(
        normalizeText(message.text),
      )
    ) {
      return index;
    }
    return lastIndex;
  }, -1);
  const activeHistory = history.slice(lastClosedBriefingIndex + 1);
  const conversation: VickMessage[] = [...activeHistory, { role: "user", text: prompt }];
  const users = conversation.filter((message) => message.role === "user");
  const projectGoal =
    users.find((message) =>
      /\b(criar|crie|montar|iniciar|comecar|novo|nova)\b.*\b(projeto|solucao|aplicacao)\b/.test(
        normalizeText(message.text),
      ),
    )?.text.trim() ?? "";

  const businessProblem = answerAfterQuestion(conversation, /problema de negocio/);
  const universe = answerAfterQuestion(conversation, /quem vai usar|universo atendido/);
  const successMetric = answerAfterQuestion(conversation, /resultado mensuravel|teve sucesso/);
  const availableSources = answerAfterQuestion(conversation, /dados ou fontes|fontes de informacao/);
  const riskLevel = answerAfterQuestion(conversation, /nivel de risco/);
  const active =
    Boolean(projectGoal) ||
    conversation.some(
      (message) =>
        message.role === "vick" &&
        /problema de negocio|universo atendido|resultado mensuravel|nivel de risco/.test(
          normalizeText(message.text),
        ),
    );

  return {
    active,
    projectGoal,
    businessProblem,
    universe,
    successMetric,
    availableSources,
    riskLevel,
  };
}

type AnalyzerGate = {
  status: string;
  requestedUniverse: string;
  recommendedUniverse: string;
  architectureDecision: string;
  solutionStack: string[];
};

function universeToTipoProjeto(universe: string): string {
  switch (universe) {
    case "ml":
      return "ML";
    case "ia":
      return "IA";
    case "chatbolt":
      return "Chatbolt";
    default:
      return "ML + IA (Hibrido)";
  }
}

function explicitBriefingUniverse(universe: string): "ml" | "ia" | "chatbolt" | "hybrid" | null {
  const normalized = normalizeText(universe).trim();
  if (/^(?:ml|machine learning|aprendizado de maquina)$/.test(normalized)) return "ml";
  if (/^(?:ia|ai|inteligencia artificial)$/.test(normalized)) return "ia";
  if (/^(?:chatbolt|chatbot)$/.test(normalized)) return "chatbolt";
  if (/^(?:hybrid|hibrido|ml\s*\+\s*ia|ia\s*\+\s*ml)$/.test(normalized)) return "hybrid";
  return null;
}

// Gate do analisador de solução: consulta a arquitetura recomendada antes de
// decidir o universo do projeto. Roda automaticamente, sem aprovação humana.
async function consultBusinessAnalyzer(input: {
  workspaceRoot: string;
  projectName: string;
  projectGoal: string;
  businessProblem: string;
  successMetric: string;
  availableSources: string;
  riskLevel: string;
}): Promise<AnalyzerGate | null> {
  const analyzerScript = path.join(input.workspaceRoot, "scripts", "analyze_business_solution.py");
  try {
    const { stdout } = await execFileAsync(
      "python",
      [
        analyzerScript,
        "--print-recommendation",
        "--project-name",
        input.projectName,
        "--universe",
        "ia",
        "--project-goal",
        input.projectGoal,
        "--business-problem",
        input.businessProblem,
        "--solution-focus",
        "ai-ml-agents",
        "--success-metric",
        input.successMetric,
        "--available-sources",
        input.availableSources,
        "--risk-level",
        input.riskLevel,
      ],
      { cwd: input.workspaceRoot, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    const parsed = JSON.parse(line) as {
      status?: string;
      requested_universe?: string;
      recommended_universe?: string;
      architecture_decision?: string;
      solution_stack?: string[];
    };
    return {
      status: parsed.status ?? "unknown",
      requestedUniverse: parsed.requested_universe ?? "ia",
      recommendedUniverse: parsed.recommended_universe ?? "hybrid",
      architectureDecision: parsed.architecture_decision ?? "",
      solutionStack: parsed.solution_stack ?? [],
    };
  } catch {
    return null;
  }
}

async function appendGateToSharedMemory(input: {
  workspaceRoot: string;
  projectName: string;
  gate: AnalyzerGate | null;
}) {
  const memoryPath = path.join(input.workspaceRoot, ".adonex", "memory", "SHARED_DIALOG_MEMORY.md");
  const line = input.gate
    ? `- [vick] ${new Date().toISOString()} analyzer-gate projeto=${input.projectName} status=${input.gate.status} requisitado=${input.gate.requestedUniverse} recomendado=${input.gate.recommendedUniverse}\n`
    : `- [vick] ${new Date().toISOString()} analyzer-gate projeto=${input.projectName} status=indisponivel fallback=hybrid\n`;
  try {
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.appendFile(memoryPath, line, "utf8");
  } catch {
    // Memória é best-effort; nunca bloqueia a criação.
  }
}

async function createLocalProject(input: {
  projectGoal: string;
  businessProblem: string;
  universe: string;
  successMetric: string;
  availableSources: string;
  riskLevel: string;
  projectsRoot: string;
  workspaceRoot: string;
}) {
  const scriptPath = path.join(input.workspaceRoot, "scripts", "create_ai_project.ps1");
  const baseName = slugifyProjectName(input.projectGoal);
  const projectName = await uniqueProjectName(input.projectsRoot, baseName);
  const projectGoal = `${input.projectGoal}\n\nUniverso atendido: ${input.universe}`;
  const userUniverse = explicitBriefingUniverse(input.universe);

  // O universo declarado pelo usuário é vinculante. O analisador externo só
  // infere essa decisão quando o briefing não traz um universo reconhecível.
  const gate = userUniverse
    ? null
    : await consultBusinessAnalyzer({
        workspaceRoot: input.workspaceRoot,
        projectName,
        projectGoal,
        businessProblem: input.businessProblem,
        successMetric: input.successMetric,
        availableSources: input.availableSources,
        riskLevel: input.riskLevel,
      });
  if (!userUniverse) {
    void appendGateToSharedMemory({ workspaceRoot: input.workspaceRoot, projectName, gate });
  }
  const selectedUniverse = userUniverse ?? gate?.recommendedUniverse ?? "hybrid";
  const tipoProjeto = universeToTipoProjeto(selectedUniverse);

  const destination = path.join(input.projectsRoot, projectName);
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-NomeProjeto",
        projectName,
        "-TipoProjeto",
        tipoProjeto,
        "-ProjectGoal",
        projectGoal,
        "-BusinessProblem",
        input.businessProblem,
        "-SolutionFocus",
        "ai-ml-agents",
        "-SuccessMetric",
        input.successMetric,
        "-AvailableSources",
        input.availableSources,
        "-RiskLevel",
        input.riskLevel,
        "-ActivateRuflo",
        "-LocalMemoryOnly",
      ],
      {
        cwd: input.workspaceRoot,
        timeout: 600_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );

    return {
      destination,
      projectName,
      selectedUniverse,
      universeSource: userUniverse ? "user" : "analyzer",
      tipoProjeto,
      gate,
      stderr,
      stdout,
    };
  } catch (error) {
    // Compensação/rollback de fronteira: uniqueProjectName garantiu que este
    // caminho não existia antes, então uma criação que falhou deixa apenas um
    // diretório parcial que pertence a esta execução — remova-o.
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as VickRequest;
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ detail: "Pergunta vazia." }, { status: 400 });
  }

  const { projects, projectsRoot, recentMemory, workspaceRoot } = await readSynapseContext();
  const history = (body.history ?? [])
    .filter((message) => message?.text && (message.role === "vick" || message.role === "user"))
    .slice(-40);
  const apiBaseUrl =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:3b";
  const normalizedPrompt = normalizeText(prompt);

  const sentiment = inferSentiment(prompt);
  void appendSentimentToSharedMemory({
    workspaceRoot,
    sentiment: sentiment.sentiment,
    confidence: sentiment.confidence,
    prompt,
  });

  const asksConnection = /\b(conectad|conexao|online|status)\w*/.test(normalizedPrompt);
  const wantsCreateProject =
    /\b(criar|crie|montar|iniciar|comecar|novo|nova)\b.*\b(projeto|solucao|aplicacao)\b/.test(
      normalizedPrompt,
    );
  const asksProjects =
    /\b(quais|liste|listar|mostre|mostrar|ver)\b.*\b(projeto|projetos)\b/.test(normalizedPrompt) ||
    /\b(projeto|projetos)\b.*\b(existem|criados|disponiveis|cadastrados)\b/.test(normalizedPrompt);
  const asksTemplates = /\b(template|templates|modelo|modelos)\b/.test(normalizedPrompt);
  const asksCapabilities =
    /\b(o que|como)\b.*\b(synapse|vick)\b/.test(normalizedPrompt) ||
    /\b(capacidade|capacidades|recurso|recursos|pode fazer)\b/.test(normalizedPrompt);
  // "abra a PASTA/DIRETÓRIO do projeto X" → Windows Explorer. Exige a palavra
  // pasta/diretório: "abra o projeto X" (sem pasta) quer ANÁLISE, não o
  // Explorer, e cai em asksOpenProject mais abaixo.
  const wantsOpenProjectFolder =
    /\b(abra|abrir|abre|abrir?)\b.*\b(pasta|diretorio|explorer|windows)\b/.test(normalizedPrompt);

  if (wantsOpenProjectFolder) {
    const requestedProject = projects.find((project) =>
      normalizedPrompt.includes(normalizeText(project)),
    );
    if (!requestedProject) {
      return NextResponse.json({
        response: "Não encontrei uma pasta de projeto com esse nome. Diga o nome exato do projeto.",
        provider: "synapse-local-context",
        model,
        context: { projects },
      });
    }
    const projectPath = path.join(projectsRoot, requestedProject);
    // Confirma a pasta ANTES de abrir: é o sinal de sucesso confiável. O
    // explorer.exe retorna exit code 1 mesmo quando abre com sucesso, então
    // execFileAsync/await sempre "falhava" e a Vick mentia dizendo que não
    // conseguiu. Disparamos destacado e não dependemos do exit code.
    try {
      await fs.access(projectPath);
    } catch {
      return NextResponse.json({
        response: `O projeto ${requestedProject} está registrado, mas a pasta ${projectPath} não existe mais no disco.`,
        provider: "synapse-local-action",
        model,
        context: { projects, project: requestedProject },
      });
    }
    const opener = spawn("explorer.exe", [projectPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    opener.on("error", () => {});
    opener.unref();
    return NextResponse.json({
      response: `Pasta do projeto ${requestedProject} aberta no Windows Explorer.`,
      provider: "synapse-local-action",
      model,
      context: { projects, project: requestedProject },
    });
  }

  const briefing = briefingFromConversation(history, prompt);
  const projectBriefingActive =
    briefing.active &&
    !/\b(cancelar|cancele|desistir|parar)\b/.test(normalizedPrompt);

  if (wantsCreateProject || projectBriefingActive) {
    const answeredFields = [
      briefing.businessProblem,
      briefing.universe,
      briefing.successMetric,
      briefing.availableSources,
      briefing.riskLevel,
    ].filter(Boolean).length;
    const briefingSteps = [
      "Claro, vamos criar esse projeto juntos. Para começar: qual problema de negócio ele deve resolver?",
      `Entendi: ${prompt}. Quem vai usar essa solução ou qual é o universo atendido?`,
      "Perfeito. Qual resultado mensurável dirá que o projeto teve sucesso?",
      "Ótimo. Quais dados ou fontes de informação estão disponíveis para o projeto?",
      "Certo. Qual é o nível de risco esperado: baixo, médio ou alto?",
    ];

    if (answeredFields >= 5) {
      try {
        const created = await createLocalProject({
          projectGoal: briefing.projectGoal || "Projeto criado pela Vick",
          businessProblem: briefing.businessProblem,
          universe: briefing.universe,
          successMetric: briefing.successMetric,
          availableSources: briefing.availableSources,
          riskLevel: briefing.riskLevel,
          projectsRoot,
          workspaceRoot,
        });
        const universeNote = created.universeSource === "user"
          ? ` Universo informado pelo usuário mantido: "${created.selectedUniverse}" (${created.tipoProjeto}).`
          : created.gate
            ? ` O analisador inferiu o universo "${created.gate.recommendedUniverse}" (${created.tipoProjeto}) porque ele não foi informado no briefing.`
            : ` Universo padrão aplicado (${created.tipoProjeto}) porque o briefing não informou o universo e o analisador não respondeu.`;
        return NextResponse.json({
          response:
            sentimentPrefix(sentiment.sentiment) +
            `Projeto criado com sucesso: ${created.projectName}. Ele foi salvo em ${created.destination}.` +
            universeNote +
            ` O briefing, a análise de solução e os artefatos base do Synapse foram gerados.`,
          provider: "synapse-local-project-factory",
          model,
          context: {
            projects,
            briefingStep: answeredFields,
            project: created.projectName,
            analyzerGate: created.gate,
          },
        });
      } catch (error) {
        return NextResponse.json({
          response:
            sentimentPrefix(sentiment.sentiment) +
            `Briefing concluído, mas não consegui criar o projeto local agora. Erro: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
          provider: "synapse-local-project-factory",
          model,
          context: { projects, briefingStep: answeredFields },
        });
      }
    }

    return NextResponse.json({
      response: sentimentPrefix(sentiment.sentiment) + briefingSteps[Math.min(answeredFields, briefingSteps.length - 1)],
      provider: "synapse-solution-factory",
      model,
      context: { projects, briefingStep: answeredFields },
    });
  }

  // ---------------------------------------------------------------------
  // Ações reais da Vick sobre os projetos (matriz de autonomia do CLAUDE.md):
  // leitura = autônoma; escrita de código = exige aprovação humana explícita.
  // ---------------------------------------------------------------------
  const asksOpenProject =
    /\b(abre|abrir|abra|carrega|carregar|mostra|mostrar|detalha|detalhar)\b.*\b(projeto)\b/.test(
      normalizedPrompt,
    );
  const asksMlPerformance =
    /\b(desempenho|performance|metrica|metricas|acuracia|avalia|avaliar|mede|medir)\b.*\b(ml|modelo|modelos|machine learning)\b/.test(
      normalizedPrompt,
    ) || /\bmlflow\b/.test(normalizedPrompt);
  const asksAiPerformance =
    /\b(desempenho|performance|metrica|metricas|avalia|avaliar|mede|medir)\b.*\b(ia|ai|llm|prompt|agente|agentes)\b/.test(
      normalizedPrompt,
    ) || /\b(eval|evals)\b/.test(normalizedPrompt);
  const asksRunTests =
    /\b(roda|rodar|executa|executar|aplica|aplicar|passa|passar)\b.*\b(teste|testes|pytest)\b/.test(
      normalizedPrompt,
    );
  // Inclui as formas IMPERATIVAS ("melhore", "corrija", "adicione", "refatore")
  // — é assim que se fala com um assistente de voz — além de verbos comuns de
  // edição (adicionar, escrever, documentar, remover...). Cuidado: verbos de
  // criação (criar/crie/montar) ficam de fora de propósito; eles são o gatilho
  // de criação de PROJETO, checado antes deste bloco.
  const wantsImprove =
    /\b(?:melhor(?:a|ar|e|em|ia|ias)|evolu(?:i|ir|a)|evolucao|refator(?:a|ar|e|em)|corrig(?:e|ir)|corrija|implement(?:a|ar|e|em)|edit(?:a|ar|e|em)|ajust(?:a|ar|e|em)|adicion(?:a|ar|e|em)|acrescent(?:a|ar|e)|escrev(?:e|er)|escreva|document(?:a|ar|e)|renome(?:ia|ar|ie)|remov(?:e|er|a)|remova|apag(?:a|ar|ue)|delet(?:a|ar|e)|otimiz(?:a|ar|e)|atualiz(?:a|ar|e))\b/.test(
      normalizedPrompt,
    );
  const confirmsExecution =
    /\b(confirma|confirmo|confirmar|aprova|aprovo|aprovar|pode aplicar|aplica|pode executar|executa|manda ver|autorizo)\b/.test(
      normalizedPrompt,
    );

  // "confirma" sobre um plano pendente ainda funciona (para quem falar), mas com
  // a autonomia ligada as edições normalmente já aplicam direto em wantsImprove.
  const pendingRequest = pendingPlanRequest(history);
  if (pendingRequest && confirmsExecution) {
    return runGovernedEdit({
      requestText: pendingRequest,
      sentiment: sentiment.sentiment,
      model,
      projects,
      auto: false,
    });
  }

  if (asksOpenProject) {
    const listed = await backend<Array<{ name?: string }>>("/projects", { timeoutMs: 8000 });
    const known = listed.ok
      ? (listed.data ?? []).map((item) => String(item?.name ?? "")).filter(Boolean)
      : projects;
    const target = known.find((name) => normalizedPrompt.includes(normalizeText(name)));
    if (!target) {
      return NextResponse.json({
        response:
          sentimentPrefix(sentiment.sentiment) +
          `Qual projeto você quer abrir? Tenho estes: ${known.slice(0, 12).join(", ") || "nenhum"}.`,
        provider: "synapse-projects",
        model,
        context: { projects: known },
      });
    }
    const detail = await backend<Record<string, unknown>>(
      `/projects/${encodeURIComponent(target)}`,
      { timeoutMs: 10_000 },
    );
    if (!detail.ok) {
      return NextResponse.json({
        response: sentimentPrefix(sentiment.sentiment) + backendDownMessage(detail.error),
        provider: "synapse-projects",
        model,
        context: { projects: known, error: detail.error },
      });
    }
    const data = detail.data ?? {};
    const destination =
      typeof data.destination === "string"
        ? data.destination
        : path.join(projectsRoot, target);
    const analysis = await analyzeProjectOnDisk(destination);

    if (!analysis) {
      const summary = ["universe", "tipo_projeto", "status", "path", "created_at"]
        .map((key) => (data[key] ? `${key}=${String(data[key])}` : ""))
        .filter(Boolean)
        .join(" · ");
      return NextResponse.json({
        response:
          sentimentPrefix(sentiment.sentiment) +
          `Abri o registro do projeto ${target}, mas não consegui ler a pasta no disco. ${summary || ""}`.trim(),
        provider: "synapse-projects",
        model,
        context: { projects: known, project: target, detail: data },
      });
    }

    const parts = [
      `Abri o projeto ${target}.`,
      `Stack: ${analysis.stack}.`,
      analysis.readmeLine ? `README: "${analysis.readmeLine}".` : "",
      analysis.topDirs.length > 0 ? `Pastas: ${analysis.topDirs.join(", ")}.` : "",
      `Sinais: ${analysis.signals.join(", ")}.`,
      `Posso analisar mais a fundo, propor melhorias, rodar os testes ou editar a pedido — é só dizer.`,
    ].filter(Boolean);

    return NextResponse.json({
      response: sentimentPrefix(sentiment.sentiment) + parts.join(" "),
      provider: "synapse-projects",
      model,
      context: { projects: known, project: target, detail: data, analysis },
    });
  }

  if (asksMlPerformance) {
    const evalRun = await backend<{
      pass_rate?: number;
      cases_total?: number;
      cases_passed?: number;
      metrics?: Record<string, number>;
      passed?: boolean;
    }>("/evals/ml", { method: "POST", body: {}, timeoutMs: 120_000 });
    if (!evalRun.ok) {
      return NextResponse.json({
        response: sentimentPrefix(sentiment.sentiment) + backendDownMessage(evalRun.error),
        provider: "synapse-evals",
        model,
        context: { error: evalRun.error },
      });
    }
    const d = evalRun.data ?? {};
    const metrics = Object.entries(d.metrics ?? {})
      .map(([key, value]) => `${key}=${Number(value).toFixed(3)}`)
      .join(", ");
    return NextResponse.json({
      response:
        sentimentPrefix(sentiment.sentiment) +
        `Desempenho de ML medido: ${d.cases_passed ?? 0}/${d.cases_total ?? 0} casos (${Math.round((d.pass_rate ?? 0) * 100)}%), gate ${d.passed ? "aprovado" : "reprovado"}. ${metrics ? `Métricas: ${metrics}.` : ""}`,
      provider: "synapse-evals",
      model,
      context: { eval: d },
    });
  }

  if (asksAiPerformance) {
    const evalRun = await backend<{
      pass_rate?: number;
      cases_total?: number;
      cases_passed?: number;
      metrics?: Record<string, number>;
      passed?: boolean;
    }>("/evals/ai", { method: "POST", body: {}, timeoutMs: 120_000 });
    if (!evalRun.ok) {
      return NextResponse.json({
        response: sentimentPrefix(sentiment.sentiment) + backendDownMessage(evalRun.error),
        provider: "synapse-evals",
        model,
        context: { error: evalRun.error },
      });
    }
    const d = evalRun.data ?? {};
    const metrics = Object.entries(d.metrics ?? {})
      .map(([key, value]) => `${key}=${Number(value).toFixed(3)}`)
      .join(", ");
    return NextResponse.json({
      response:
        sentimentPrefix(sentiment.sentiment) +
        `Desempenho de IA medido: ${d.cases_passed ?? 0}/${d.cases_total ?? 0} casos (${Math.round((d.pass_rate ?? 0) * 100)}%), gate ${d.passed ? "aprovado" : "reprovado"}. ${metrics ? `Métricas: ${metrics}.` : ""}`,
      provider: "synapse-evals",
      model,
      context: { eval: d },
    });
  }

  if (asksRunTests) {
    try {
      const { stdout, stderr } = await execFileAsync("python", ["-m", "pytest", "-q"], {
        cwd: workspaceRoot,
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      const tail = cleanText(`${stdout} ${stderr}`).slice(-320);
      return NextResponse.json({
        response: sentimentPrefix(sentiment.sentiment) + `Testes executados. Resultado: ${tail}`,
        provider: "synapse-tests",
        model,
        context: { tests: "passed" },
      });
    } catch (error) {
      const output = cleanText(
        String((error as { stdout?: string })?.stdout ?? "") +
          " " +
          String((error as { stderr?: string })?.stderr ?? ""),
      ).slice(-320);
      return NextResponse.json({
        response:
          sentimentPrefix(sentiment.sentiment) +
          `Os testes falharam. Saída: ${output || (error instanceof Error ? error.message : "erro desconhecido")}`,
        provider: "synapse-tests",
        model,
        context: { tests: "failed" },
      });
    }
  }

  // Edição de código / melhorias. Autonomia configurada pelo dono do ambiente
  // (adonex.security.* e requireConfirmationForPatch = false): aplica direto via
  // AdoneX, sem o passo "confirma". O AdoneX aplica o patch e há undo/rollback
  // por git como rede de segurança. Para voltar a exigir aprovação, reative
  // esses settings do AdoneX (o helper respeita o requiresConfirmation do bridge).
  if (wantsImprove && !projectBriefingActive) {
    return runGovernedEdit({
      requestText: prompt,
      sentiment: sentiment.sentiment,
      model,
      projects,
      auto: true,
    });
  }

  if (asksConnection || asksProjects || asksTemplates || asksCapabilities) {
    const answer: string[] = [];
    if (asksConnection) {
      const backendHealth = await probeJson<{
        status?: string;
        environment?: string;
      }>(`${apiBaseUrl}/health`, 900);
      const backendReady = await probeJson<{ status?: string }>(`${apiBaseUrl}/health/ready`, 1400);
      const ollamaTags = await probeJson<{ models?: unknown[] }>(`${ollamaBaseUrl}/api/tags`, 1400);

      const frontendStatus = "ok";
      const backendStatus = backendHealth.ok
        ? `ok${backendReady.ok && backendReady.data?.status ? ` (${backendReady.data.status})` : ""}`
        : `indisponível (${backendHealth.error ?? "erro"})`;
      const ollamaStatus = ollamaTags.ok
        ? "ok"
        : `indisponível (${ollamaTags.error ?? "erro"})`;

      answer.push(
        `Status agora: web=${frontendStatus}; backend=${backendStatus}; ollama=${ollamaStatus}; modelo=${model}.`,
      );
    }
    if (asksProjects) {
      answer.push(
        projects.length > 0
          ? `Encontrei ${projects.length} projetos em Documents/Projetos: ${projects.join(", ")}.`
          : "Não encontrei projetos cadastrados em Documents/Projetos.",
      );
    }
    if (asksTemplates) {
      const templateProjects = projects.filter((project) => /template/i.test(project));
      answer.push(
        templateProjects.length > 0
          ? `O inventário local contém: ${templateProjects.join(", ")}.`
          : "Não encontrei um projeto de templates no inventário local.",
      );
    }
    if (asksCapabilities) {
      answer.push(
        "O Synapse oferece Solution Factory, Ollama local, AdoneX, Ruflo seletivo, memória compartilhada e criação governada de soluções de IA.",
      );
    }
    return NextResponse.json({
      response: sentimentPrefix(sentiment.sentiment) + answer.join(" "),
      provider: "synapse-local-context",
      model,
      context: { projects },
    });
  }

  const controller = new AbortController();
  // Timeout até o PRIMEIRO token, não até a resposta inteira. O abort anterior
  // de 2,5s era inalcançável nesta máquina, então 100% das respostas
  // conversacionais caíam no fallback e o LLM nunca era usado de fato.
  // Com o prefixo em cache o primeiro token sai em ~4s; a folga aqui cobre a
  // primeira chamada após o modelo ser carregado, que ainda paga o prompt frio.
  // Depois que o streaming começa, deixamos o modelo terminar no ritmo dele.
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    45_000,
  );
  const clearFirstTokenTimer = () => {
    if (firstTokenTimer) {
      clearTimeout(firstTokenTimer);
      firstTokenTimer = null;
    }
  };
  const abortFromClient = () => controller.abort();
  if (request.signal.aborted) {
    controller.abort();
  } else {
    request.signal.addEventListener("abort", abortFromClient, { once: true });
  }
  const startedAt = Date.now();

  // Contexto ESTÁVEL. Nada de memória, histórico ou inventário aqui: qualquer
  // parte que mude entre turnos invalida o prefix cache do Ollama e força
  // reavaliar o prompt inteiro. Medido nesta máquina (CPU, sem GPU): prompt eval
  // a ~17 tok/s a frio contra ~87 tok/s com o prefixo em cache. Manter este
  // bloco byte-a-byte idêntico entre requests é o que torna a Vick usável por voz.
  const system = `Você é Vick, a interface digital oficial do Synapse.
Responda em português do Brasil, com precisão, clareza e tom acolhedor.
Use somente o contexto local fornecido. Não invente projetos, estados ou capacidades.
Quando perguntarem sobre conexão, informe que a interface web está conectada ao runtime local da Vick e diga o estado do modelo.
Quando perguntarem sobre projetos, use exatamente o inventário fornecido.
O Synapse é uma plataforma local-first com Ollama, Solution Factory, AdoneX, Ruflo seletivo e memória compartilhada entre assistentes.
Converse como uma pessoa atenta e competente. Responda diretamente ao que foi pedido.
Não diga "como inteligência artificial", não repita frases genéricas e não ofereça capacidades irrelevantes.
Considere que a entrada pode vir de reconhecimento de voz; interprete pequenos erros fonéticos pelo contexto.
Se faltar uma informação realmente necessária, faça uma única pergunta curta e específica.
O contexto local da conversa vem antes da pergunta, na própria mensagem do usuário.
Responda em no máximo 3 frases curtas e sempre termine a última frase. Você é uma assistente de voz: resposta longa é resposta ruim.`;

  // Contexto DINÂMICO, ordenado do mais estável para o mais volátil e mantido
  // curto — o que vier depois do prefixo comum é reavaliado a cada turno.
  const contextBlock = [
    `Modelo local: ${model}`,
    `Projetos em Documents/Projetos: ${projects.length > 0 ? projects.join(", ") : "nenhum"}`,
    recentMemory ? `Memória recente do Synapse:\n${recentMemory}` : "",
    history.length > 0
      ? `Conversa recente:\n${history
          .slice(-4)
          .map(
            (message) =>
              `${message.role === "vick" ? "Vick" : "Usuário"}: ${cleanText(message.text).slice(0, 240)}`,
          )
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = `${contextBlock}\n\nPergunta do usuário: ${prompt}`;

  const prefix = sentimentPrefix(sentiment.sentiment);

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: userPrompt,
        system,
        // Streaming: a geração roda a ~4-5 tok/s aqui, então esperar a resposta
        // fechar deixava a Vick muda ~20s. Falando a primeira frase assim que o
        // modelo a termina, ela começa a responder em ~4s.
        stream: true,
        // Mantém o modelo residente: sem isso a primeira fala depois de uma
        // pausa paga ~11s de carga fria.
        keep_alive: "30m",
        options: {
          temperature: 0.15,
          num_ctx: 2048,
          // 96 cortava toda resposta no meio da frase ("...Isso, ele pode").
          // A folga aqui não custa tempo: com a instrução de brevidade o modelo
          // fecha sozinho no EOS bem antes do teto — o teto é só a rede de
          // segurança para ele não divagar a 4 tok/s.
          num_predict: 180,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama respondeu com HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Ollama não devolveu corpo de streaming");
    }

    const ollamaBody = response.body;
    const encoder = new TextEncoder();
    // Contrato NDJSON: uma linha {"delta"} por pedaço e uma linha final
    // {"done":true,...} com a resposta completa e o provider real.
    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        const send = (payload: unknown) =>
          streamController.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        const reader = ollamaBody.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        let answer = "";
        let promptTokens = 0;
        let completionTokens = 0;

        if (prefix) {
          answer += prefix;
          send({ delta: prefix });
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            clearFirstTokenTimer();
            buffered += decoder.decode(value, { stream: true });
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let parsed: {
                response?: string;
                prompt_eval_count?: number;
                eval_count?: number;
              };
              try {
                parsed = JSON.parse(trimmed);
              } catch {
                continue;
              }
              if (parsed.response) {
                answer += parsed.response;
                send({ delta: parsed.response });
              }
              if (parsed.prompt_eval_count) promptTokens = Number(parsed.prompt_eval_count);
              if (parsed.eval_count) completionTokens = Number(parsed.eval_count);
            }
          }

          const finalAnswer = cleanText(answer);
          if (!finalAnswer || finalAnswer === cleanText(prefix)) {
            send({
              done: true,
              response: prefix + ollamaDownMessage(model, "resposta vazia"),
              provider: "synapse-local-fallback",
              model,
              context: { projects },
            });
            return;
          }

          void recordLlmUsage({
            workspaceRoot,
            provider: "ollama",
            model,
            latencyMs: Date.now() - startedAt,
            promptTokens,
            completionTokens,
            fallbackUsed: false,
          });
          send({
            done: true,
            response: finalAnswer,
            provider: "ollama",
            model,
            context: { projects },
          });
        } catch (error) {
          // Já emitimos deltas: a linha final avisa o cliente do corte em vez
          // de deixar a resposta pela metade sem explicação.
          send({
            done: true,
            response:
              cleanText(answer) ||
              prefix + ollamaDownMessage(model, error instanceof Error ? error.message : "stream interrompido"),
            provider: cleanText(answer) ? "ollama" : "synapse-local-fallback",
            model,
            context: {
              projects,
              error: error instanceof Error ? error.message : "erro desconhecido",
            },
          });
        } finally {
          clearFirstTokenTimer();
          request.signal.removeEventListener("abort", abortFromClient);
          streamController.close();
        }
      },
      cancel() {
        controller.abort();
        clearFirstTokenTimer();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        // Impede buffering de proxy: sem isso os deltas chegam todos de uma vez
        // e o ganho de latência da fala progressiva some.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    clearFirstTokenTimer();
    request.signal.removeEventListener("abort", abortFromClient);
    return NextResponse.json({
      response:
        prefix +
        ollamaDownMessage(model, error instanceof Error ? error.message : "erro desconhecido"),
      provider: "synapse-local-fallback",
      model,
      context: {
        projects,
        error: error instanceof Error ? error.message : "erro desconhecido",
      },
    });
  }
}

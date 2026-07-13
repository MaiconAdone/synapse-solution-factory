import { execFile } from "node:child_process";
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

  let recentMemory = "Memória compartilhada ainda sem registros disponíveis.";
  try {
    const memory = await fs.readFile(memoryPath, "utf8");
    recentMemory = memory.slice(-3000);
  } catch {
    // Inventory is still enough for local status answers.
  }

  return { projects, projectsRoot, recentMemory, workspaceRoot };
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
  const conversation: VickMessage[] = [...history, { role: "user", text: prompt }];
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
      "ML + IA (Hibrido)",
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
    destination: path.join(input.projectsRoot, projectName),
    projectName,
    stderr,
    stdout,
  };
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
        return NextResponse.json({
          response:
            sentimentPrefix(sentiment.sentiment) +
            `Projeto criado com sucesso: ${created.projectName}. Ele foi salvo em ${created.destination}. O briefing, a análise de solução e os artefatos base do Synapse foram gerados.`,
          provider: "synapse-local-project-factory",
          model,
          context: { projects, briefingStep: answeredFields, project: created.projectName },
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
  const timeout = setTimeout(() => controller.abort(), 2_500);

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

Estado local:
- Workspace Synapse: disponível
- Ollama local: a verificar; use o endpoint configurado se precisar reportar status
- Modelo: ${model}
- Projetos encontrados em Documents/Projetos: ${projects.length > 0 ? projects.join(", ") : "nenhum"}

Memória recente do Synapse:
${recentMemory}

Conversa recente:
${history.map((message) => `${message.role === "vick" ? "Vick" : "Usuário"}: ${message.text}`).join("\n")}`;

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: false,
        options: {
          temperature: 0.15,
          num_ctx: 2048,
          num_predict: 96,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama respondeu com HTTP ${response.status}`);
    }

    const data = (await response.json()) as { response?: string };
    const answer = data.response?.trim();
    if (!answer) throw new Error("Ollama retornou uma resposta vazia");

    return NextResponse.json({
      response: sentimentPrefix(sentiment.sentiment) + answer,
      provider: "ollama",
      model,
      context: { projects },
    });
  } catch (error) {
    return NextResponse.json({
      response:
        sentimentPrefix(sentiment.sentiment) +
        "Estou online no Synapse. Pode continuar digitando ou falando; se o modelo local demorar, eu respondo pelo contexto local e sigo o fluxo da conversa.",
      provider: "synapse-local-fallback",
      model,
      context: {
        projects,
        error: error instanceof Error ? error.message : "erro desconhecido",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}


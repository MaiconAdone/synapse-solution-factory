import * as vscode from "vscode";
import { BASE_SYSTEM_PROMPT, STATIC_POLICY_PROMPT } from "../agent/prompts";
import { extractJsonObject } from "../agent/proposalParser";
import { selectFocusPaths } from "../agent/routerAgent";
import { detectDatabaseProject, selectContextExcerpt } from "../context/workspaceContextCore";
import {
  ADONEX_FAST_LOCAL_MODEL,
  ADONEX_REASONING_LOCAL_MODEL,
  localFallbackModelForProfile,
  localProfileForName,
  type LocalModelCallProfile
} from "../llm/localModels";
import { normalizeOllamaBaseUrl } from "../llm/ollamaEndpoint";
import { OllamaClient } from "../llm/ollamaClient";
import type { LlmRequest } from "../llm/types";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { guardAgainstLocalHallucinations, type HallucinationGuardEvidence } from "./hallucinationGuard";
import { sanitizeAdoneXResponse } from "./responseSanitizer";

const DATABASE_QUESTION_PATTERN =
  /\b(tabelas?|colunas?|schemas?|cat[aá]logo|banco[s]?\s+de\s+dados|mapead[ao]s?|mapeamento|relacionamentos?|views?|faturamento|consulta\s+sql|query\s+sql)\b/i;

export function looksLikeDatabaseQuestion(prompt: string): boolean {
  return DATABASE_QUESTION_PATTERN.test(prompt);
}

interface DatabaseSignalFile {
  path: string;
  content: string;
}

export interface DatabaseSpecialistPlan {
  subQuestions: string[];
  targetFiles: string[];
  strategy: string;
}

export interface DatabaseSpecialistCritique {
  issues: string[];
  approved: boolean;
}

export interface DatabaseSpecialistProposal {
  question: string;
  plan: DatabaseSpecialistPlan;
  draftAnswer: string;
  critique: DatabaseSpecialistCritique;
  finalAnswer: string;
  provider: "ollama";
  model: string;
}

export interface AskDatabaseSpecialistOptions {
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}

const DATABASE_SIGNAL_GLOB =
  "**/{*.sql,schema.prisma,alembic.ini,docker-compose*.yml,docker-compose*.yaml,.env.example}";
const MIGRATIONS_GLOB = "**/migrations/**/*.{py,sql,ts,js}";
const CONTENT_SAMPLE_PATTERN = /docker-compose|\.env\.example$/i;

/**
 * Localiza arquivos que sinalizam presenca de banco de dados no workspace
 * (migrations, schema, docker-compose, .env.example). Best-effort: nunca
 * lanca, retorna lista vazia em qualquer falha de I/O do VS Code.
 */
async function collectDatabaseSignalFiles(root: string): Promise<vscode.Uri[]> {
  try {
    const configuration = vscode.workspace.getConfiguration("adonex");
    const ignores = configuration.get<string[]>("workspace.ignorePatterns", []);
    const exclude = ignores.length ? `{${ignores.map((item) => `**/${item}/**`).join(",")}}` : undefined;
    const [signals, migrations] = await Promise.all([
      vscode.workspace.findFiles(new vscode.RelativePattern(root, DATABASE_SIGNAL_GLOB), exclude, 40),
      vscode.workspace.findFiles(new vscode.RelativePattern(root, MIGRATIONS_GLOB), exclude, 20)
    ]);
    const seen = new Map<string, vscode.Uri>();
    for (const uri of [...signals, ...migrations]) seen.set(uri.fsPath, uri);
    return [...seen.values()];
  } catch {
    return [];
  }
}

async function readSignalFile(uri: vscode.Uri, maxChars: number): Promise<DatabaseSignalFile> {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const decoded = new TextDecoder().decode(bytes).slice(0, maxChars);
    return { path: relativePath, content: scanAndRedactSecrets(decoded).redacted };
  } catch {
    return { path: relativePath, content: "" };
  }
}

/**
 * Ha evidencia real de banco de dados neste workspace? Nunca chama o Ollama;
 * so varre arquivos e aplica detectDatabaseProject. Usado para decidir se
 * vale a pena acionar o pipeline planner->writer->critic.
 */
export async function hasDatabaseSpecialist(root: string): Promise<boolean> {
  try {
    const uris = await collectDatabaseSignalFiles(root);
    if (!uris.length) return false;
    const paths = uris.map((uri) => vscode.workspace.asRelativePath(uri, false));
    const sampleUris = uris.filter((uri) => CONTENT_SAMPLE_PATTERN.test(uri.fsPath)).slice(0, 5);
    const samples = await Promise.all(sampleUris.map((uri) => readSignalFile(uri, 2_000)));
    const contents = samples.map((item) => item.content).join("\n");
    return detectDatabaseProject(paths, contents).detected;
  } catch {
    return false;
  }
}

function buildEvidenceBlock(files: DatabaseSignalFile[]): string {
  return files
    .map((file) => `--- ${file.path}\n${file.content}`)
    .join("\n\n");
}

const PLANNER_JSON_SCHEMA = {
  type: "object",
  properties: {
    sub_questions: { type: "array", items: { type: "string" } },
    target_files: { type: "array", items: { type: "string" } },
    strategy: { type: "string" }
  },
  required: ["strategy"]
} as const;

function buildPlannerSystemPrompt(): string {
  return [
    "Voce e o planner do especialista de banco de dados do AdoneX: um sub-agent rapido.",
    "Divida a pergunta em no maximo 3 sub-perguntas objetivas e escolha no maximo 5 arquivos candidatos que realmente ajudam a responder.",
    "Resuma a estrategia de resposta em 1 frase.",
    "Responda SOMENTE com JSON valido, sem prosa nem cercas de codigo.",
    'Formato: {"sub_questions": string[], "target_files": string[], "strategy": string}.'
  ].join("\n");
}

function buildPlannerUserPrompt(question: string, candidateFiles: string[]): string {
  return [
    `Pergunta sobre o banco de dados: ${question}`,
    "",
    "Arquivos candidatos encontrados no workspace:",
    ...(candidateFiles.length
      ? candidateFiles.slice(0, 20).map((file) => `- ${file}`)
      : ["- (nenhum arquivo candidato)"]),
    "",
    "Retorne o JSON de planejamento."
  ].join("\n");
}

function parseDatabasePlan(text: string, question: string, candidateFiles: string[]): DatabaseSpecialistPlan {
  const fallback: DatabaseSpecialistPlan = {
    subQuestions: [question],
    targetFiles: candidateFiles.slice(0, 5),
    strategy: "Responder diretamente com base nos arquivos candidatos."
  };
  const raw = text?.trim();
  if (!raw) return fallback;
  const known = new Set(candidateFiles);
  for (const candidate of [raw, extractJsonObject(raw)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const targetFiles = toStringArray(parsed.target_files)
        .filter((file) => known.size === 0 || known.has(file))
        .slice(0, 5);
      const subQuestions = toStringArray(parsed.sub_questions).slice(0, 3);
      const strategy = typeof parsed.strategy === "string" ? parsed.strategy.trim() : "";
      if (!targetFiles.length && !subQuestions.length && !strategy) continue;
      return {
        subQuestions: subQuestions.length ? subQuestions : fallback.subQuestions,
        targetFiles: targetFiles.length ? targetFiles : fallback.targetFiles,
        strategy: strategy || fallback.strategy
      };
    } catch {
      continue;
    }
  }
  return fallback;
}

const CRITIC_JSON_SCHEMA = {
  type: "object",
  properties: {
    issues: { type: "array", items: { type: "string" } },
    approved: { type: "boolean" }
  },
  required: ["approved"]
} as const;

function buildCriticSystemPrompt(): string {
  return [
    "Voce e o critico do especialista de banco de dados do AdoneX: revisa a resposta rascunho contra a evidencia fornecida.",
    "Aponte, em no maximo 3 itens curtos, qualquer tabela, coluna, relacionamento ou afirmacao que NAO esteja sustentada pela evidencia.",
    "Se a resposta estiver bem sustentada, retorne issues vazio e approved=true.",
    "Responda SOMENTE com JSON valido, sem prosa nem cercas de codigo.",
    'Formato: {"issues": string[], "approved": boolean}.'
  ].join("\n");
}

function buildCriticUserPrompt(question: string, draftAnswer: string, evidence: string): string {
  return [
    `Pergunta original: ${question}`,
    "",
    "Resposta rascunho a revisar:",
    draftAnswer,
    "",
    "Evidencia disponivel (arquivos do workspace):",
    evidence || "(sem evidencia adicional)",
    "",
    "Retorne o JSON de revisao."
  ].join("\n");
}

function parseDatabaseCritique(text: string): DatabaseSpecialistCritique {
  const fallback: DatabaseSpecialistCritique = { issues: [], approved: true };
  const raw = text?.trim();
  if (!raw) return fallback;
  for (const candidate of [raw, extractJsonObject(raw)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const issues = toStringArray(parsed.issues).slice(0, 3);
      const approved = typeof parsed.approved === "boolean" ? parsed.approved : issues.length === 0;
      return { issues, approved };
    } catch {
      continue;
    }
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildWriterSystemPrompt(): string {
  return [
    BASE_SYSTEM_PROMPT,
    STATIC_POLICY_PROMPT,
    "",
    "Voce esta atuando como o especialista de banco de dados do AdoneX.",
    "Responda somente com base nos arquivos de evidencia fornecidos (migrations, schema, docker-compose, .env.example redigido).",
    "Nunca invente tabela, coluna, tipo, chave estrangeira ou relacionamento ausente da evidencia.",
    "Cite os arquivos usados. Se a evidencia nao cobrir a pergunta, diga isso explicitamente e recomende o menor passo de verificacao.",
    "Responda em pt-BR, em Markdown, comecando pela conclusao direta."
  ].join("\n");
}

async function callOllama(
  profile: LocalModelCallProfile,
  baseUrl: string,
  configuration: vscode.WorkspaceConfiguration,
  request: LlmRequest
) {
  return new OllamaClient({
    baseUrl,
    fallbackBaseUrl: normalizeOllamaBaseUrl(
      configuration.get<string>("ollama.fallbackBaseUrl", "http://127.0.0.1:11434")
    ),
    fallbackModel: localFallbackModelForProfile(profile.profile),
    model: profile.model,
    apiStyle: configuration.get<"chat" | "generate">("ollama.apiStyle", "chat"),
    timeoutMs: configuration.get<number>("ollama.timeoutSeconds", 120) * 1000,
    keepAlive: configuration.get<string>("ollama.keepAlive", "10m"),
    numCtx: profile.numCtx,
    temperature: profile.temperature,
    topP: profile.topP,
    repeatPenalty: profile.repeatPenalty,
    maxRetries: configuration.get<number>("ollama.maxRetries", 2),
    retryDelayMs: configuration.get<number>("ollama.retryDelayMs", 250)
  }).generate(request);
}

/**
 * Pipeline planner->writer->critic local (Ollama) para perguntas sobre banco
 * de dados. O chamador deve ja ter confirmado hasDatabaseSpecialist(root)
 * antes; aqui so lanca se, mesmo assim, nenhum arquivo de evidencia for
 * encontrado. Falhas de rede/timeout do Ollama propagam para o chamador.
 */
export async function askDatabaseSpecialist(
  root: string,
  question: string,
  options: AskDatabaseSpecialistOptions = {}
): Promise<DatabaseSpecialistProposal> {
  const uris = await collectDatabaseSignalFiles(root);
  if (!uris.length) {
    throw new Error("Nenhum sinal de banco de dados encontrado neste workspace.");
  }
  // O glob de coleta so busca .env.example (nunca .env real), e o conteudo
  // ja passa por scanAndRedactSecrets em readSignalFile; nao ha necessidade
  // de filtrar por isSensitivePath aqui (isso removeria o proprio
  // .env.example, que e um dos sinais que queremos como evidencia).
  const files = await Promise.all(uris.slice(0, 15).map((uri) => readSignalFile(uri, 3_000)));
  const paths = files.map((file) => file.path);
  const configuration = vscode.workspace.getConfiguration("adonex");
  const baseUrl = normalizeOllamaBaseUrl(
    configuration.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")
  );
  const fastModel = configuration.get<string>("ollama.fastModel", ADONEX_FAST_LOCAL_MODEL);
  const reasoningModel = configuration.get<string>("ollama.reasoningModel", ADONEX_REASONING_LOCAL_MODEL);
  const fastProfile = localProfileForName("fast", fastModel, reasoningModel) as LocalModelCallProfile;
  const writerProfile = localProfileForName("code_review", fastModel, reasoningModel) as LocalModelCallProfile;

  options.onProgress?.("Planejando a consulta ao banco de dados...");
  const plannerResponse = await callOllama(fastProfile, baseUrl, configuration, {
    systemPrompt: buildPlannerSystemPrompt(),
    userPrompt: buildPlannerUserPrompt(question, paths),
    jsonSchema: PLANNER_JSON_SCHEMA,
    maxOutputTokens: fastProfile.maxOutputTokens,
    signal: options.signal
  });
  const plan = parseDatabasePlan(plannerResponse.text, question, paths);

  const focusPaths = selectFocusPaths(paths, plan.targetFiles);
  const narrowedFiles = focusPaths.length
    ? files.filter((file) => focusPaths.includes(file.path))
    : files;
  const evidence = selectContextExcerpt(buildEvidenceBlock(narrowedFiles), 6_000);

  options.onProgress?.("Redigindo a resposta com base na evidencia coletada...");
  const writerResponse = await callOllama(writerProfile, baseUrl, configuration, {
    systemPrompt: buildWriterSystemPrompt(),
    userPrompt: question,
    workspaceContext: [
      `Estrategia do planner: ${plan.strategy}`,
      plan.subQuestions.length ? `Sub-perguntas: ${plan.subQuestions.join("; ")}` : "",
      "",
      "Evidencia (arquivos do workspace):",
      evidence || "(sem evidencia adicional)"
    ]
      .filter(Boolean)
      .join("\n"),
    maxOutputTokens: writerProfile.maxOutputTokens,
    signal: options.signal
  });
  const draftAnswer = sanitizeAdoneXResponse(writerResponse.text);

  options.onProgress?.("Revisando a resposta contra a evidencia...");
  const criticResponse = await callOllama(fastProfile, baseUrl, configuration, {
    systemPrompt: buildCriticSystemPrompt(),
    userPrompt: buildCriticUserPrompt(question, draftAnswer, evidence),
    jsonSchema: CRITIC_JSON_SCHEMA,
    maxOutputTokens: Math.min(fastProfile.maxOutputTokens, 256),
    signal: options.signal
  });
  const critique = parseDatabaseCritique(criticResponse.text);

  const withCritique = critique.issues.length
    ? [draftAnswer, "", "### Ressalvas do critico local", ...critique.issues.map((issue) => `- ${issue}`)].join("\n")
    : draftAnswer;
  const guardEvidence: HallucinationGuardEvidence = {
    files: paths,
    commands: [],
    stack: [],
    synapseDetected: false
  };
  const finalAnswer = guardAgainstLocalHallucinations(withCritique, guardEvidence);

  return {
    question,
    plan,
    draftAnswer,
    critique,
    finalAnswer,
    provider: "ollama",
    model: writerResponse.model
  };
}

export function renderSpecialistProposal(proposal: DatabaseSpecialistProposal): string {
  return [
    proposal.finalAnswer,
    "",
    `_Especialista de banco (planner→writer→critic) | Provider: ${proposal.provider} | Modelo: ${proposal.model} | Aprovado pelo critico: ${
      proposal.critique.approved ? "sim" : "com ressalvas"
    }_`
  ].join("\n");
}

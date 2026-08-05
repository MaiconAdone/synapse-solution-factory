import type {
  AgentAction,
  ImplementationProposal,
  LlmRequest,
  LlmResponse,
  ProposedPatchOperation
} from "../../llm/types";
import { extractJsonObject, repairJsonText } from "../proposalParser";
import { createToolLoopTools, type ToolLoopToolsOptions } from "./tools";
import { buildToolLoopSystemPrompt, buildToolLoopUserPrompt } from "./prompts";
import {
  TOOL_LOOP_JSON_SCHEMA,
  TOOL_LOOP_TOOL_NAMES,
  type ToolLoopDecision,
  type ToolLoopStep,
  type ToolLoopToolName
} from "./types";

const MAX_TRANSCRIPT_CHARS = 4_000;

export interface RunToolLoopOptions {
  task: string;
  action: AgentAction;
  /** System prompt ja montado (BASE_SYSTEM_PROMPT + policy + Synapse + actionPrompt). */
  systemPromptBase: string;
  maxSteps: number;
  maxOutputTokens: number;
  seed?: number;
  signal?: AbortSignal;
  /** Injetado pelo AgentOrchestrator: reaproveita gateway/Ollama, retry e selecao de perfil ja existentes. */
  generate: (request: LlmRequest) => Promise<LlmResponse>;
  onStep?: (step: ToolLoopStep) => void;
  tools: ToolLoopToolsOptions;
}

export interface ToolLoopResult {
  proposal: ImplementationProposal;
  steps: ToolLoopStep[];
  totalInputTokens: number;
  totalOutputTokens: number;
  lastModel?: string;
}

/**
 * Laco iterativo: a cada turno reenvia system prompt + transcript (o cliente
 * Ollama nao tem canal de historico nativo) e pede uma decisao restrita por
 * JSON Schema (uma ferramenta OU finish). Nunca escreve no disco: as edicoes
 * ficam em memoria (ver tools.ts) e viram `operations` da proposta final, que
 * segue o MESMO caminho de preview/aprovacao/apply de sempre.
 */
export async function runToolLoop(options: RunToolLoopOptions): Promise<ToolLoopResult> {
  const runtime = createToolLoopTools(options.tools);
  const steps: ToolLoopStep[] = [];
  let finishSummary = "";
  let finishCommands: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastModel: string | undefined;
  const maxSteps = Math.max(1, options.maxSteps);

  for (let index = 1; index <= maxSteps; index += 1) {
    if (options.signal?.aborted) break;
    const systemPrompt = buildToolLoopSystemPrompt(
      options.systemPromptBase,
      [...runtime.tools.values()]
    );
    const userPrompt = buildToolLoopUserPrompt(options.task, formatTranscript(steps));

    let response: LlmResponse;
    try {
      response = await options.generate({
        systemPrompt,
        userPrompt,
        jsonMode: true,
        jsonSchema: TOOL_LOOP_JSON_SCHEMA,
        maxOutputTokens: options.maxOutputTokens,
        seed: options.seed,
        signal: options.signal
      });
    } catch (error) {
      pushStep(steps, options, {
        index,
        tool: "finish",
        argsSummary: "",
        resultSummary: `Erro ao chamar o modelo: ${describeError(error)}`,
        ok: false,
        timestamp: new Date().toISOString()
      });
      break;
    }
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    lastModel = response.model;

    const decision = parseToolLoopDecision(response.text);
    if (!decision) {
      pushStep(steps, options, {
        index,
        tool: "finish",
        argsSummary: "",
        resultSummary: "A resposta do modelo nao pode ser interpretada como um passo valido; encerrando.",
        ok: false,
        timestamp: new Date().toISOString()
      });
      break;
    }

    if (decision.tool === "finish") {
      finishSummary = decision.summary ?? "";
      finishCommands = decision.commands ?? [];
      pushStep(steps, options, {
        index,
        tool: "finish",
        argsSummary: decision.thought ?? "",
        resultSummary: finishSummary || "Loop concluido.",
        ok: true,
        timestamp: new Date().toISOString()
      });
      break;
    }

    const tool = runtime.tools.get(decision.tool);
    if (!tool) {
      pushStep(steps, options, {
        index,
        tool: decision.tool,
        argsSummary: decision.thought ?? "",
        resultSummary: `Ferramenta desconhecida: ${decision.tool}`,
        ok: false,
        timestamp: new Date().toISOString()
      });
      continue;
    }

    let result: { ok: boolean; summary: string; detail?: string };
    try {
      result = (await tool.execute(decision)) as { ok: boolean; summary: string; detail?: string };
    } catch (error) {
      result = { ok: false, summary: describeError(error) };
    }
    // Cancelado pelo usuario durante a ferramenta (ex.: run_command morto pelo
    // AbortSignal): para o loop de imediato em vez de gravar um passo de erro
    // cosmetico. tools.ts (run_command) converte a rejeicao do runCommand num
    // resultado {ok:false} normal em vez de propagar — entao a checagem de
    // cancelamento precisa ficar aqui, depois da chamada, nao so no catch.
    if (options.signal?.aborted) break;
    pushStep(steps, options, {
      index,
      tool: decision.tool,
      argsSummary: describeArgs(decision),
      resultSummary: result.detail
        ? `${result.summary}\n${result.detail.slice(0, 800)}`
        : result.summary,
      ok: result.ok,
      timestamp: new Date().toISOString()
    });
  }

  if (!finishSummary) {
    finishSummary =
      steps.length >= maxSteps
        ? `Limite de ${maxSteps} passo(s) atingido; encerrando com o progresso acumulado.`
        : "Loop encerrado sem uma acao final explicita do modelo; progresso acumulado preservado.";
  }

  const proposal: ImplementationProposal = {
    summary: finishSummary,
    changes: [],
    operations: runtime.operations,
    commands: finishCommands
  };

  return {
    proposal,
    steps,
    totalInputTokens,
    totalOutputTokens,
    lastModel
  };
}

function pushStep(
  steps: ToolLoopStep[],
  options: RunToolLoopOptions,
  step: ToolLoopStep
): void {
  steps.push(step);
  options.onStep?.(step);
}

function formatTranscript(steps: ToolLoopStep[]): string {
  if (!steps.length) return "(nenhum passo executado ainda)";
  const lines = steps.map(
    (step) =>
      `Passo ${step.index}: ${step.tool}(${step.argsSummary || "-"}) -> ${
        step.ok ? "ok" : "erro"
      }: ${step.resultSummary}`
  );
  return capFromEnd(lines.join("\n\n"), MAX_TRANSCRIPT_CHARS);
}

function capFromEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[...passos antigos omitidos...]\n\n${text.slice(-maxChars)}`;
}

function describeArgs(decision: ToolLoopDecision): string {
  if (decision.path) return `path=${decision.path}`;
  if (decision.query) return `query=${decision.query}`;
  if (decision.command) return `command=${decision.command}`;
  if (decision.operation) {
    const operation = decision.operation as Partial<ProposedPatchOperation>;
    return `operation=${operation.type ?? "?"}:${operation.path ?? "?"}`;
  }
  return decision.thought ?? "";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Interpreta a decisao do modelo com a mesma tolerancia de parseProposalText
 * (agent/proposalParser.ts): tenta o texto cru, sem cercas, o objeto JSON
 * balanceado extraido, e um reparo conservador — nessa ordem.
 */
export function parseToolLoopDecision(text: string): ToolLoopDecision | undefined {
  const raw = text?.trim();
  if (!raw) return undefined;
  const stripped = stripFences(raw);
  const repaired = repairJsonText(raw);
  const candidates = dedupe([
    raw,
    stripped,
    extractJsonObject(raw),
    repaired,
    extractJsonObject(repaired)
  ]);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const tool = parsed.tool;
      if (typeof tool !== "string" || !TOOL_LOOP_TOOL_NAMES.has(tool as ToolLoopToolName)) {
        continue;
      }
      return {
        tool: tool as ToolLoopToolName,
        thought: asString(parsed.thought),
        path: asString(parsed.path),
        query: asString(parsed.query),
        operation: isRecord(parsed.operation)
          ? (parsed.operation as unknown as ProposedPatchOperation)
          : undefined,
        command: asString(parsed.command),
        summary: asString(parsed.summary),
        commands: asStringArray(parsed.commands)
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function dedupe(values: Array<string | undefined>): Array<string | undefined> {
  const seen = new Set<string>();
  const result: Array<string | undefined> = [];
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

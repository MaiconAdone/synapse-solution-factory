import http from "node:http";
import https from "node:https";
import type { LlmRequest, LlmResponse } from "./types";

export class OllamaClientError extends Error {}

/**
 * Erro especifico de truncamento por budget de saida: o Ollama encerrou a
 * resposta com done_reason=length (ou com JSON claramente incompleto quando o
 * done_reason nao veio). Lancado apenas em saidas estruturadas/JSON, onde um
 * texto cortado e garantidamente corrupto; texto livre segue com o conteudo
 * parcial e o flag `truncated` na resposta. Permite ao chamador distinguir
 * truncamento de outros erros e reagir (ex.: refazer com budget maior).
 */
export class OllamaTruncatedResponseError extends OllamaClientError {}

export interface OllamaClientEvent {
  type: "request" | "first_token" | "retry" | "success" | "error" | "failover";
  attempt: number;
  maxAttempts: number;
  endpoint: string;
  model: string;
  apiStyle: "chat" | "generate";
  detail?: string;
  delayMs?: number;
  durationMs?: number;
}

export interface OllamaClientOptions {
  baseUrl: string;
  /**
   * Host tentado quando `baseUrl` (ex.: o Mac mini do time) nao aceita
   * conexao. So dispara para falhas de conectividade (host fora do ar, porta
   * fechada, DNS) — nunca para timeout de geracao lenta ou erro HTTP de um
   * host que respondeu. Ignorado se vazio ou igual a `baseUrl`.
   */
  fallbackBaseUrl?: string;
  /**
   * Modelo usado na chamada de fallback em vez de `model`/`request.model`.
   * Necessario porque o host de fallback (maquina local) normalmente NAO tem
   * o mesmo modelo do host principal (ex.: qwen3-coder-14b-team so existe no
   * Mac mini) — sem isso o fallback so trocaria de host para falhar de novo
   * com "model not found". Ignorado se vazio.
   */
  fallbackModel?: string;
  model: string;
  apiStyle?: "chat" | "generate";
  fetcher?: typeof fetch;
  timeoutMs?: number;
  keepAlive?: string;
  numCtx?: number;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  seed?: number;
  stream?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  logger?: (event: OllamaClientEvent) => void;
  /**
   * Progresso de geracao ao vivo: chamado com o total aproximado de tokens ja
   * recebidos (1 linha de streaming ~= 1 token no /api/chat). Alimenta o modo
   * pensativo da UI sem custo extra de modelo.
   */
  onToken?: (tokens: number) => void;
  /**
   * Texto incremental conforme chega do Ollama (delta por linha NDJSON), para
   * UI que queira mostrar a resposta crescendo em vez de esperar o fim. Nao
   * substitui parseOllamaResponse: o corpo completo continua acumulado e
   * reparseado normalmente no final da chamada.
   */
  onChunk?: (text: string) => void;
}

export class OllamaClient {
  private readonly timeoutMs: number;

  public constructor(private readonly options: OllamaClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  public async generate(request: LlmRequest): Promise<LlmResponse> {
    const apiStyle = this.options.apiStyle ?? "chat";
    const payload =
      apiStyle === "chat"
        ? this.createChatPayload(request)
        : this.createGeneratePayload(request);
    const model = request.model ?? this.options.model;
    try {
      return await this.attemptHost(this.options.baseUrl, apiStyle, model, payload, request);
    } catch (error) {
      const fallbackBaseUrl = this.normalizedFallbackBaseUrl();
      if (!fallbackBaseUrl || !isConnectivityError(error)) {
        throw error;
      }
      const fallbackModel = this.options.fallbackModel?.trim() || model;
      const fallbackPayload =
        fallbackModel === model
          ? payload
          : { ...(payload as Record<string, unknown>), model: fallbackModel };
      this.emitLog({
        type: "failover",
        attempt: 1,
        maxAttempts: (this.options.maxRetries ?? 0) + 1,
        endpoint: `${fallbackBaseUrl}/api/${apiStyle}`,
        model: fallbackModel,
        apiStyle,
        detail: `${this.options.baseUrl} indisponivel (${errorDetail(error)}); usando fallback local ${fallbackBaseUrl} com ${fallbackModel}`
      });
      return await this.attemptHost(fallbackBaseUrl, apiStyle, fallbackModel, fallbackPayload, request);
    }
  }

  private normalizedFallbackBaseUrl(): string | undefined {
    const fallback = this.options.fallbackBaseUrl?.trim().replace(/\/$/, "");
    const primary = this.options.baseUrl.trim().replace(/\/$/, "");
    return fallback && fallback !== primary ? fallback : undefined;
  }

  private async attemptHost(
    baseUrl: string,
    apiStyle: "chat" | "generate",
    model: string,
    payload: object,
    request: LlmRequest
  ): Promise<LlmResponse> {
    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/${apiStyle}`;
    const maxAttempts = (this.options.maxRetries ?? 0) + 1;
    const startedAt = Date.now();
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.emitLog({
        type: "request",
        attempt,
        maxAttempts,
        endpoint,
        model,
        apiStyle
      });
      try {
        const response = this.options.fetcher
          ? await this.fetchWithConfiguredTransport(endpoint, payload, request.signal)
          : await this.postJson(endpoint, payload, request.signal, () => {
              this.emitLog({
                type: "first_token",
                attempt,
                maxAttempts,
                endpoint,
                model,
                apiStyle,
                durationMs: Date.now() - startedAt
              });
            });
        if (!response.ok) {
          throw new OllamaClientError(
            `Ollama rejected the request (${response.status}): ${response.body.slice(0, 500)}`
          );
        }
        const result = parseOllamaResponse(
          response.body,
          Boolean(request.jsonSchema ?? request.jsonMode)
        );
        this.emitLog({
          type: "success",
          attempt,
          maxAttempts,
          endpoint,
          model,
          apiStyle,
          durationMs: Date.now() - startedAt
        });
        return {
          provider: "ollama",
          model: result.model ?? model,
          text: result.text.trim(),
          inputTokens: result.prompt_eval_count ?? 0,
          outputTokens: result.eval_count ?? 0,
          truncated: result.truncated
        };
      } catch (error) {
        lastError = error;
        const message = errorDetail(error);
        const aborted =
          (error instanceof Error && error.name === "AbortError") ||
          /\babort(?:ed)?\b/i.test(message);
        const detail =
          aborted
            ? `request exceeded ${Math.round(this.timeoutMs / 1000)} seconds`
            : message;
        if (attempt < maxAttempts && this.shouldRetry(error)) {
          const delayMs = this.options.retryDelayMs ?? 250;
          this.emitLog({
            type: "retry",
            attempt,
            maxAttempts,
            endpoint,
            model,
            apiStyle,
            detail,
            delayMs
          });
          await delay(delayMs);
          continue;
        }
        this.emitLog({
          type: "error",
          attempt,
          maxAttempts,
          endpoint,
          model,
          apiStyle,
          detail,
          durationMs: Date.now() - startedAt
        });
        if (error instanceof OllamaClientError) {
          throw error;
        }
        throw new OllamaClientError(
          `Ollama request failed at ${baseUrl} using model ${model}: ${detail}`
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new OllamaClientError("Ollama request failed without details.");
  }

  private createChatPayload(request: LlmRequest): object {
    const messages = [
      { role: "system", content: request.systemPrompt },
      request.workspaceContext
        ? {
            role: "user",
            content: `Workspace context:\n${request.workspaceContext}`
          }
        : undefined,
      { role: "user", content: request.userPrompt }
    ].filter(Boolean);
    return {
      model: request.model ?? this.options.model,
      messages,
      think: false,
      stream: this.options.stream ?? true,
      format: request.jsonSchema ?? (request.jsonMode ? "json" : undefined),
      keep_alive: this.options.keepAlive ?? "10m",
      options: this.createOptions(request)
    };
  }

  private createGeneratePayload(request: LlmRequest): object {
    return {
      model: request.model ?? this.options.model,
      system: request.systemPrompt,
      prompt: [
        request.workspaceContext
          ? `Workspace context:\n${request.workspaceContext}`
          : "",
        `User task:\n${request.userPrompt}`
      ]
        .filter(Boolean)
        .join("\n\n"),
      think: false,
      stream: this.options.stream ?? true,
      format: request.jsonSchema ?? (request.jsonMode ? "json" : undefined),
      keep_alive: this.options.keepAlive ?? "10m",
      options: this.createOptions(request)
    };
  }

  private createOptions(request: LlmRequest): object {
    const options: Record<string, number> = {
      temperature: this.options.temperature ?? 0,
      num_ctx: this.options.numCtx ?? 8192,
      top_p: this.options.topP ?? 0.9,
      repeat_penalty: this.options.repeatPenalty ?? 1.08,
      num_predict: request.maxOutputTokens ?? 900
    };
    const seed = request.seed ?? this.options.seed;
    if (seed !== undefined) {
      options.seed = seed;
    }
    return options;
  }

  private shouldRetry(error: unknown): boolean {
    // Truncamento por budget nao se resolve repetindo a mesma chamada; quem
    // decide (budget maior ou erro) e o chamador.
    if (error instanceof OllamaTruncatedResponseError) return false;
    return isRetryableError(error);
  }

  private emitLog(event: OllamaClientEvent): void {
    this.options.logger?.(event);
  }

  private async fetchWithConfiguredTransport(
    endpoint: string,
    payload: object,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const forwardAbort = (): void => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await this.options.fetcher!(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = this.options.onChunk
        ? await this.readStreamedBody(response)
        : await response.text();
      if (this.options.onToken) {
        const lines = body.split("\n").filter((line) => line.trim()).length;
        this.options.onToken(lines);
      }
      return {
        ok: response.ok,
        status: response.status,
        body
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  /**
   * Le o corpo via ReadableStream em vez de response.text() para poder emitir
   * onChunk incrementalmente (usado quando um `fetcher` customizado e
   * injetado — hoje so em testes, ja que producao sempre usa postJson).
   * Devolve o corpo completo acumulado, igual a response.text() teria dado.
   */
  private async readStreamedBody(response: Response): Promise<string> {
    if (!response.body) return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      full += text;
      const split = splitCompleteLines(carry, text);
      carry = split.carry;
      for (const line of split.lines) {
        const delta = extractDelta(line);
        if (delta) this.options.onChunk?.(delta);
      }
    }
    full += decoder.decode();
    return full;
  }

  private async postJson(
    endpoint: string,
    payload: object,
    signal?: AbortSignal,
    onFirstChunk?: () => void
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const url = new URL(endpoint);
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = (value: { ok: boolean; status: number; body: string }): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finishReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const request = transport.request(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            connection: "keep-alive"
          },
          timeout: this.timeoutMs
        },
        (response) => {
          const chunks: Buffer[] = [];
          let receivedFirstChunk = false;
          let streamedLines = 0;
          let onChunkCarry = "";
          response.on("data", (chunk: Buffer) => {
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
              onFirstChunk?.();
            }
            const text = chunk.toString("utf8");
            if (this.options.onToken) {
              for (let index = 0; index < text.length; index += 1) {
                if (text[index] === "\n") streamedLines += 1;
              }
              this.options.onToken(streamedLines);
            }
            if (this.options.onChunk) {
              const { lines, carry } = splitCompleteLines(onChunkCarry, text);
              onChunkCarry = carry;
              for (const line of lines) {
                const delta = extractDelta(line);
                if (delta) this.options.onChunk(delta);
              }
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const status = response.statusCode ?? 0;
            finishResolve({
              ok: status >= 200 && status < 300,
              status,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
          // Se o cliente aborta durante o streaming, a resposta fecha sem "end";
          // garante que a promise rejeite em vez de travar.
          response.on("close", () => finishReject(abortError()));
          response.on("error", (error: Error) => finishReject(error));
        }
      );
      const abort = (): void => {
        request.destroy(abortError());
        // Rejeita imediatamente: destruir a request no meio do stream nem sempre
        // emite "error", o que antes deixava o AdoneX preso ao clicar em Parar.
        finishReject(abortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      request.on("timeout", () => {
        request.destroy(abortError());
        finishReject(abortError());
      });
      request.on("error", finishReject);
      request.on("close", () => signal?.removeEventListener("abort", abort));
      request.end(body);
    });
  }
}

/**
 * Acumula texto de streaming em linhas completas (NDJSON: 1 objeto por
 * linha). Um chunk de rede pode cortar uma linha ao meio; o restante fica em
 * `carry` para ser prefixado ao proximo chunk. So devolve linhas completas.
 */
function splitCompleteLines(carry: string, chunkText: string): { lines: string[]; carry: string } {
  const combined = carry + chunkText;
  const parts = combined.split("\n");
  const newCarry = parts.pop() ?? "";
  return { lines: parts, carry: newCarry };
}

/** Extrai o delta de texto de uma linha NDJSON, tolerante a linha vazia/invalida. */
function extractDelta(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  try {
    const item = JSON.parse(trimmed) as { message?: { content?: string }; response?: string };
    return item.message?.content ?? item.response ?? "";
  } catch {
    return "";
  }
}

function abortError(): Error {
  const error = new Error("request aborted");
  error.name = "AbortError";
  return error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOllamaResponse(
  body: string,
  expectJson = false
): {
  model?: string;
  text: string;
  prompt_eval_count?: number;
  eval_count?: number;
  truncated?: boolean;
} {
  const trimmed = body.trim();
  if (!trimmed) {
    return { text: "" };
  }
  if (!trimmed.includes("\n")) {
    const result = JSON.parse(trimmed) as {
      model?: string;
      message?: { content?: string };
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
      done?: boolean;
      done_reason?: string;
    };
    const text = result.message?.content ?? result.response ?? "";
    const truncated = detectTruncation(result.done_reason, result.done, text, expectJson);
    return {
      model: result.model,
      text,
      prompt_eval_count: result.prompt_eval_count,
      eval_count: result.eval_count,
      truncated
    };
  }

  let model: string | undefined;
  let promptEvalCount: number | undefined;
  let evalCount: number | undefined;
  let doneReason: string | undefined;
  let done = false;
  const parts: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as {
      model?: string;
      message?: { content?: string };
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
      done?: boolean;
      done_reason?: string;
    };
    model = item.model ?? model;
    if (item.message?.content) parts.push(item.message.content);
    if (item.response) parts.push(item.response);
    promptEvalCount = item.prompt_eval_count ?? promptEvalCount;
    evalCount = item.eval_count ?? evalCount;
    doneReason = item.done_reason ?? doneReason;
    done = item.done ?? done;
  }
  const text = parts.join("");
  const truncated = detectTruncation(doneReason, done, text, expectJson);
  return {
    model,
    text,
    prompt_eval_count: promptEvalCount,
    eval_count: evalCount,
    truncated
  };
}

/**
 * Inspeciona done_reason/done do Ollama. Em saidas JSON (propostas de patch),
 * truncamento e erro duro: JSON cortado nao tem recuperacao local. Em texto
 * livre, apenas sinaliza via retorno para manter o comportamento atual de
 * respostas parciais no chat/completion.
 */
function detectTruncation(
  doneReason: string | undefined,
  done: boolean | undefined,
  text: string,
  expectJson: boolean
): boolean | undefined {
  if (doneReason === "length") {
    if (expectJson) {
      throw new OllamaTruncatedResponseError(
        "Ollama response truncated by the output token budget (done_reason=length)."
      );
    }
    return true;
  }
  if (
    done === true &&
    doneReason === undefined &&
    expectJson &&
    looksLikeUnfinishedJson(text)
  ) {
    throw new OllamaTruncatedResponseError(
      "Ollama response ended with clearly incomplete JSON; treating it as truncated by the output token budget."
    );
  }
  return undefined;
}

/**
 * Heuristica deterministica para "JSON claramente incompleto": o texto comeca
 * como objeto/array JSON mas os delimitadores nao fecham (ou a string fica
 * aberta) ao fim da resposta.
 */
function looksLikeUnfinishedJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
  }
  return depth > 0 || inString;
}

/** Teto razoavel de num_predict para a re-geracao com budget dobrado. */
export const MAX_OUTPUT_TOKEN_BUDGET = 4_096;

/**
 * Re-gera UMA vez com num_predict dobrado (ate o teto) quando a primeira
 * tentativa morre por truncamento. Se truncar de novo (ou o budget ja estiver
 * no teto), propaga um erro claro de budget excedido. Qualquer outro erro
 * segue inalterado para o chamador.
 */
export async function generateWithTruncationBudget(
  generate: (maxOutputTokens: number) => Promise<LlmResponse>,
  initialBudget: number,
  options: { maxBudget?: number; onRetry?: (budget: number) => void } = {}
): Promise<LlmResponse> {
  const maxBudget = options.maxBudget ?? MAX_OUTPUT_TOKEN_BUDGET;
  try {
    return await generate(initialBudget);
  } catch (error) {
    if (!(error instanceof OllamaTruncatedResponseError)) throw error;
    const doubled = Math.min(initialBudget * 2, maxBudget);
    if (doubled <= initialBudget) {
      throw new Error(
        `Model output exceeded the output token budget (${initialBudget} tokens, already at the ${maxBudget} ceiling); split the task into smaller edits.`
      );
    }
    options.onRetry?.(doubled);
    try {
      return await generate(doubled);
    } catch (retryError) {
      if (retryError instanceof OllamaTruncatedResponseError) {
        throw new Error(
          `Model output exceeded the output token budget even after doubling to ${doubled} tokens; split the task into smaller edits.`
        );
      }
      throw retryError;
    }
  }
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeText =
    cause && typeof cause === "object"
      ? [
          "code" in cause ? String(cause.code) : "",
          "message" in cause ? String(cause.message) : ""
        ]
          .filter(Boolean)
          .join(": ")
      : cause
        ? String(cause)
        : "";
  return [error.message, causeText].filter(Boolean).join(" | ");
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? errorDetail(error) : String(error);
  return !/\b(abort(?:ed)?|not found|model not found|invalid|bad request)\b/i.test(message);
}

const CONNECTIVITY_ERROR_CODES =
  /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EAI_AGAIN)\b/;

/**
 * So dispara o fallback para host local quando o host configurado (ex.: o
 * Mac mini do time) nunca respondeu — recusou conexao, caiu no timeout de
 * conexao do SO, ou o DNS/rota falhou. Timeout de geracao lenta (abort do
 * nosso proprio controller) e erro HTTP de um host que respondeu (ex.: model
 * not found) significam que o host esta de pe, entao nao trocam de host.
 */
function isConnectivityError(error: unknown): boolean {
  if (error instanceof OllamaTruncatedResponseError) return false;
  if (!(error instanceof Error)) return false;
  if (/^Ollama rejected the request/.test(error.message)) return false;
  if (CONNECTIVITY_ERROR_CODES.test(error.message)) return true;
  if (/request exceeded \d+ seconds/i.test(error.message) || /\babort(?:ed)?\b/i.test(error.message)) {
    return false;
  }
  return /fetch failed/i.test(error.message);
}

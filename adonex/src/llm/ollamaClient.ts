import http from "node:http";
import https from "node:https";
import type { LlmRequest, LlmResponse } from "./types";

export class OllamaClientError extends Error {}

export interface OllamaClientEvent {
  type: "request" | "first_token" | "retry" | "success" | "error";
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
}

export class OllamaClient {
  private readonly timeoutMs: number;

  public constructor(private readonly options: OllamaClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  public async generate(request: LlmRequest): Promise<LlmResponse> {
    const apiStyle = this.options.apiStyle ?? "chat";
    const endpoint = `${this.options.baseUrl.replace(/\/$/, "")}/api/${apiStyle}`;
    const payload =
      apiStyle === "chat"
        ? this.createChatPayload(request)
        : this.createGeneratePayload(request);
    const maxAttempts = (this.options.maxRetries ?? 0) + 1;
    const model = request.model ?? this.options.model;
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
        const result = parseOllamaResponse(response.body);
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
          outputTokens: result.eval_count ?? 0
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
          `Ollama request failed at ${this.options.baseUrl} using model ${model}: ${detail}`
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
      format: request.jsonMode ? "json" : undefined,
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
      format: request.jsonMode ? "json" : undefined,
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
      return {
        ok: response.ok,
        status: response.status,
        body: await response.text()
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
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
          response.on("data", (chunk: Buffer) => {
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
              onFirstChunk?.();
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

function abortError(): Error {
  const error = new Error("request aborted");
  error.name = "AbortError";
  return error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOllamaResponse(body: string): {
  model?: string;
  text: string;
  prompt_eval_count?: number;
  eval_count?: number;
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
    };
    return {
      model: result.model,
      text: result.message?.content ?? result.response ?? "",
      prompt_eval_count: result.prompt_eval_count,
      eval_count: result.eval_count
    };
  }

  let model: string | undefined;
  let promptEvalCount: number | undefined;
  let evalCount: number | undefined;
  const parts: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as {
      model?: string;
      message?: { content?: string };
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    model = item.model ?? model;
    if (item.message?.content) parts.push(item.message.content);
    if (item.response) parts.push(item.response);
    promptEvalCount = item.prompt_eval_count ?? promptEvalCount;
    evalCount = item.eval_count ?? evalCount;
  }
  return {
    model,
    text: parts.join(""),
    prompt_eval_count: promptEvalCount,
    eval_count: evalCount
  };
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

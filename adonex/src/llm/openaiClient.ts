import OpenAI from "openai";
import type * as vscode from "vscode";
import type { LlmRequest, LlmResponse } from "./types";

export class OpenAiClientError extends Error {}

interface ResponsesApi {
  create(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<{
    output_text?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  }>;
}

export interface OpenAiClientOptions {
  secretStorage: Pick<vscode.SecretStorage, "get">;
  configuredApiKey?: string;
  clientFactory?: (apiKey: string) => { responses: ResponsesApi };
  timeoutMs?: number;
}

export class OpenAiClient {
  private readonly clientFactory: (apiKey: string) => { responses: ResponsesApi };
  private readonly timeoutMs: number;

  public constructor(private readonly options: OpenAiClientOptions) {
    this.clientFactory =
      options.clientFactory ??
      ((apiKey) => new OpenAI({ apiKey, timeout: this.options.timeoutMs }));
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  public async generate(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new OpenAiClientError(
        "OpenAI API key is not configured. Run 'AdoneX: Configure API Key'."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.clientFactory(apiKey).responses.create(
        {
          model: request.model,
          instructions: request.systemPrompt,
          input: [
            request.workspaceContext
              ? `Workspace context:\n${request.workspaceContext}`
              : "",
            `User task:\n${request.userPrompt}`
          ]
            .filter(Boolean)
            .join("\n\n"),
          max_output_tokens: request.maxOutputTokens ?? 1200
        },
        { signal: request.signal ?? controller.signal }
      );
      return {
        provider: "openai",
        model: request.model ?? "configured-model",
        text: response.output_text?.trim() ?? "",
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("429")) {
        throw new OpenAiClientError("OpenAI rate limit reached. Try again later.");
      }
      if (lower.includes("abort") || lower.includes("timeout")) {
        throw new OpenAiClientError("OpenAI request timed out.");
      }
      throw new OpenAiClientError(`OpenAI request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getApiKey(): Promise<string> {
    const secret = await this.options.secretStorage.get("adonex.openai.apiKey");
    return (
      secret?.trim() ||
      this.options.configuredApiKey?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      ""
    );
  }
}

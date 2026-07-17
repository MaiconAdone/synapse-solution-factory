import http from "node:http";
import https from "node:https";
import type { AdoneXLocalModelProfile } from "./localModels";
import type { LlmRequest, LlmResponse } from "./types";

export class SynapseGatewayClientError extends Error {}

export interface SynapseGatewayClientOptions {
  baseUrl: string;
  apiKey?: string;
  projectId?: string;
  agentId?: string;
  toolName?: string;
  humanApproved?: boolean;
  localModelProfile?: "auto" | "large" | AdoneXLocalModelProfile;
  temperature?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export class SynapseGatewayClient {
  private readonly timeoutMs: number;

  public constructor(private readonly options: SynapseGatewayClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  public async generate(request: LlmRequest): Promise<LlmResponse> {
    const endpoint = `${this.options.baseUrl.replace(/\/$/, "")}/hybrid-llm/generate`;
    const prompt = [
      request.workspaceContext
        ? `Workspace context:\n${request.workspaceContext}`
        : "",
      `User task:\n${request.userPrompt}`
    ].filter(Boolean).join("\n\n");
    const payload = {
      prompt,
      system: request.systemPrompt,
      allow_cloud: false,
      human_approved: this.options.humanApproved ?? false,
      local_model_profile: this.options.localModelProfile ?? "auto",
      json_mode: request.jsonMode ?? false,
      temperature: this.options.temperature ?? 0,
      project_id: this.options.projectId ?? "adonex",
      agent_id: this.options.agentId ?? "adonex",
      tool_name: this.options.toolName ?? "adonex.agent"
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    }

    const response = this.options.fetcher
      ? await this.fetchWithConfiguredTransport(endpoint, payload, headers, request.signal)
      : await this.postJson(endpoint, payload, headers, request.signal);
    if (!response.ok) {
      throw new SynapseGatewayClientError(
        `Synapse LLM Gateway rejected the request (${response.status}): ${response.body.slice(0, 500)}`
      );
    }
    const result = JSON.parse(response.body) as {
      provider?: "openai" | "ollama";
      model?: string;
      response?: string;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    if (result.provider && result.provider !== "ollama") {
      throw new SynapseGatewayClientError(
        `AdoneX rejected non-local gateway provider: ${result.provider}`
      );
    }
    return {
      provider: "ollama",
      model: result.model ?? "gateway",
      text: (result.response ?? "").trim(),
      inputTokens: result.prompt_tokens ?? 0,
      outputTokens: result.completion_tokens ?? 0
    };
  }

  private async fetchWithConfiguredTransport(
    endpoint: string,
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const response = await this.options.fetcher!(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  }

  private postJson(
    endpoint: string,
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const body = JSON.stringify(payload);
      const transport = url.protocol === "https:" ? https : http;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const request = transport.request(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body)
          },
          signal: controller.signal
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            resolve({
              ok: response.statusCode ? response.statusCode >= 200 && response.statusCode < 300 : false,
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
        }
      );
      request.on("error", (error) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      request.write(body);
      request.end();
    });
  }
}

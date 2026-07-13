import { normalizeOllamaBaseUrl } from "./ollamaEndpoint";

export interface OllamaEmbeddingClientOptions {
  baseUrl: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  keepAlive?: string;
}

export class OllamaEmbeddingClientError extends Error {}

export class OllamaEmbeddingClient {
  private readonly timeoutMs: number;

  public constructor(private readonly options: OllamaEmbeddingClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public async embed(input: string[]): Promise<number[][]> {
    if (!input.length) return [];
    const endpoint = `${normalizeOllamaBaseUrl(this.options.baseUrl).replace(/\/$/, "")}/api/embed`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetcher ?? fetch)(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          input,
          keep_alive: this.options.keepAlive ?? "10m"
        }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new OllamaEmbeddingClientError(
          `Ollama embeddings rejected the request (${response.status}): ${text.slice(0, 500)}`
        );
      }
      const parsed = JSON.parse(text) as { embeddings?: number[][]; embedding?: number[] };
      const embeddings = parsed.embeddings ?? (parsed.embedding ? [parsed.embedding] : []);
      if (embeddings.length !== input.length) {
        throw new OllamaEmbeddingClientError(
          `Ollama returned ${embeddings.length} embedding(s) for ${input.length} input(s).`
        );
      }
      return embeddings.map(normalizeVector);
    } catch (error) {
      if (error instanceof OllamaEmbeddingClientError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new OllamaEmbeddingClientError(`Ollama embeddings unavailable: ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}
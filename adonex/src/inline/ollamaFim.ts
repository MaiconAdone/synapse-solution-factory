/**
 * Cliente minimo de fill-in-middle (FIM) para autocomplete inline. Usa o
 * endpoint /api/generate do Ollama com o campo `suffix`, que aplica o template
 * FIM do modelo (qwen2.5-coder, deepseek-coder). Nao usa streaming: a sugestao
 * e curta e queremos latencia previsivel com cancelamento.
 */
export interface FimRequest {
  baseUrl: string;
  model: string;
  prefix: string;
  suffix: string;
  numPredict: number;
  temperature: number;
  timeoutMs: number;
  keepAlive: string;
  signal?: AbortSignal;
}

const STOP_TOKENS = [
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<|endoftext|>",
  "<|file_sep|>"
];

export async function fetchFimCompletion(request: FimRequest): Promise<string> {
  const endpoint = `${request.baseUrl.replace(/\/$/, "")}/api/generate`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  const forwardAbort = (): void => controller.abort();
  request.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prefix,
        suffix: request.suffix,
        stream: false,
        keep_alive: request.keepAlive,
        options: {
          temperature: request.temperature,
          num_predict: request.numPredict,
          top_p: 0.9,
          stop: STOP_TOKENS
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { response?: string };
    return payload.response ?? "";
  } catch {
    // Timeout, cancelamento ou Ollama indisponivel: sem sugestao, sem ruido.
    return "";
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}

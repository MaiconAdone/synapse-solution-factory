import assert from "node:assert/strict";
import test from "node:test";
import { OllamaClient, OllamaClientError } from "../src/llm/ollamaClient";

/** Response cujo body chega em pedacos exatos, para testar streaming real (nao um Response de string unica). */
function streamedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" }
  });
}

test("ollama client calls the local chat endpoint without fixed seed for open questions", async () => {
  let endpoint = "";
  let payload: Record<string, unknown> = {};
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async (input, init) => {
      endpoint = String(input);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "qwen-test",
          message: { content: "local response" },
          prompt_eval_count: 4,
          eval_count: 6
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });
  const result = await client.generate({
    systemPrompt: "system",
    userPrompt: "task"
  });
  assert.equal(result.provider, "ollama");
  assert.equal(result.text, "local response");
  assert.equal(endpoint, "http://localhost:11434/api/chat");
  assert.deepEqual(payload.messages, [
    { role: "system", content: "system" },
    { role: "user", content: "task" }
  ]);
  assert.deepEqual(payload.options, {
    temperature: 0,
    num_ctx: 8192,
    top_p: 0.9,
    repeat_penalty: 1.08,
    num_predict: 900
  });
  assert.equal(payload.keep_alive, "10m");
  assert.equal(payload.stream, true);
  assert.equal(payload.think, false);
});

test("ollama client can send an explicit seed for governed deterministic work", async () => {
  let payload: Record<string, unknown> = {};
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ model: "qwen-test", message: { content: "seeded" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });
  await client.generate({
    systemPrompt: "system",
    userPrompt: "task",
    seed: 42
  });
  assert.equal((payload.options as Record<string, unknown>).seed, 42);
});

test("ollama client can use the legacy generate endpoint", async () => {
  let endpoint = "";
  let payload: Record<string, unknown> = {};
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    apiStyle: "generate",
    fetcher: async (input, init) => {
      endpoint = String(input);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ model: "qwen-test", response: "legacy response" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });
  const result = await client.generate({
    systemPrompt: "system",
    userPrompt: "task",
    workspaceContext: "files"
  });
  assert.equal(endpoint, "http://localhost:11434/api/generate");
  assert.equal(payload.system, "system");
  assert.match(String(payload.prompt), /Workspace context:\nfiles/);
  assert.equal(payload.stream, true);
  assert.equal(payload.think, false);
  assert.equal(result.text, "legacy response");
});

test("ollama client parses streaming chat responses", async () => {
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async () => {
      return new Response(
        [
          JSON.stringify({ model: "qwen-test", message: { content: "ola " } }),
          JSON.stringify({
            model: "qwen-test",
            message: { content: "mundo" },
            done: true,
            prompt_eval_count: 3,
            eval_count: 2
          })
        ].join("\n"),
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      );
    }
  });

  const result = await client.generate({
    systemPrompt: "system",
    userPrompt: "task"
  });

  assert.equal(result.text, "ola mundo");
  assert.equal(result.inputTokens, 3);
  assert.equal(result.outputTokens, 2);
});

test("ollama client enables JSON mode for implementation proposals", async () => {
  let payload: Record<string, unknown> = {};
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ model: "qwen-test", response: "{}", eval_count: 1 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });
  await client.generate({
    systemPrompt: "system",
    userPrompt: "task",
    jsonMode: true
  });
  assert.equal(payload.format, "json");
});

test("ollama client returns a friendly unavailable error", async () => {
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async () => {
      throw new Error("connection refused");
    }
  });
  await assert.rejects(
    () => client.generate({ systemPrompt: "system", userPrompt: "task" }),
    OllamaClientError
  );
});

test("ollama client explains aborts as configurable timeouts", async () => {
  const client = new OllamaClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen-test",
    timeoutMs: 25_000,
    fetcher: async () => {
      throw new Error("This operation was aborted");
    }
  });
  await assert.rejects(
    () => client.generate({ systemPrompt: "system", userPrompt: "task" }),
    /request exceeded 25 seconds/
  );
});

test("ollama client retries transient failures before succeeding", async () => {
  let attempts = 0;
  const client = new OllamaClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen-test",
    maxRetries: 2,
    retryDelayMs: 1,
    fetcher: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("connection refused");
      }
      return new Response(
        JSON.stringify({
          model: "qwen-test",
          message: { content: "recovered response" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await client.generate({
    systemPrompt: "system",
    userPrompt: "task"
  });

  assert.equal(attempts, 3);
  assert.equal(result.text, "recovered response");
});

test("ollama client exposes the underlying fetch failure cause", async () => {
  const cause = Object.assign(new Error("connection refused"), {
    code: "ECONNREFUSED"
  });
  const client = new OllamaClient({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen-test",
    fetcher: async () => {
      throw new TypeError("fetch failed", { cause });
    }
  });
  await assert.rejects(
    () => client.generate({ systemPrompt: "system", userPrompt: "task" }),
    /ECONNREFUSED/
  );
});

test("ollama client reports streamed token progress via onToken", async () => {
  const reported: number[] = [];
  const streamedBody = [
    JSON.stringify({ message: { content: "a" } }),
    JSON.stringify({ message: { content: "b" } }),
    JSON.stringify({ message: { content: "c" }, eval_count: 3 })
  ].join("\n");
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    onToken: (tokens) => reported.push(tokens),
    fetcher: async () =>
      new Response(streamedBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  const result = await client.generate({ systemPrompt: "s", userPrompt: "u" });
  assert.equal(result.text, "abc");
  assert.deepEqual(reported, [3]);
});

test("ollama client streams incremental text via onChunk", async () => {
  const deltas: string[] = [];
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    onChunk: (text) => deltas.push(text),
    fetcher: async () =>
      streamedResponse([
        `${JSON.stringify({ message: { content: "ola " } })}\n`,
        `${JSON.stringify({ message: { content: "mundo" }, done: true, eval_count: 2 })}\n`
      ])
  });
  const result = await client.generate({ systemPrompt: "s", userPrompt: "u" });
  assert.deepEqual(deltas, ["ola ", "mundo"]);
  assert.equal(result.text, "ola mundo");
});

test("ollama client onChunk keeps a JSON line intact when it is split across chunk boundaries", async () => {
  const deltas: string[] = [];
  const fullLine = `${JSON.stringify({
    message: { content: "ola mundo" },
    done: true,
    eval_count: 2
  })}\n`;
  const splitPoint = Math.floor(fullLine.length / 2);
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    onChunk: (text) => deltas.push(text),
    fetcher: async () =>
      streamedResponse([fullLine.slice(0, splitPoint), fullLine.slice(splitPoint)])
  });
  const result = await client.generate({ systemPrompt: "s", userPrompt: "u" });
  assert.deepEqual(deltas, ["ola mundo"]);
  assert.equal(result.text, "ola mundo");
});

test("ollama client passes jsonSchema as the format field", async () => {
  let payload: Record<string, unknown> = {};
  const schema = { type: "object", properties: { x: { type: "string" } } };
  const client = new OllamaClient({
    baseUrl: "http://localhost:11434",
    model: "qwen-test",
    fetcher: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ message: { content: "{}" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });
  await client.generate({ systemPrompt: "s", userPrompt: "u", jsonSchema: schema });
  assert.deepEqual(payload.format, schema);
});

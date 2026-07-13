import assert from "node:assert/strict";
import test from "node:test";
import { cosineSimilarity, normalizeVector, OllamaEmbeddingClient } from "../src/llm/ollamaEmbeddingClient";

test("ollama embedding client calls local embed endpoint and normalizes vectors", async () => {
  let endpoint = "";
  let payload: Record<string, unknown> = {};
  const client = new OllamaEmbeddingClient({
    baseUrl: "http://localhost:11434",
    model: "nomic-embed-text:latest",
    fetcher: async (input, init) => {
      endpoint = String(input);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ embeddings: [[3, 4], [0, 2]] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const embeddings = await client.embed(["auth service", "login api"]);

  assert.equal(endpoint, "http://127.0.0.1:11434/api/embed");
  assert.equal(payload.model, "nomic-embed-text:latest");
  assert.deepEqual(payload.input, ["auth service", "login api"]);
  assert.ok(Math.abs(embeddings[0][0] - 0.6) < 0.0001);
  assert.ok(Math.abs(embeddings[0][1] - 0.8) < 0.0001);
  assert.deepEqual(embeddings[1], [0, 1]);
});

test("cosine similarity scores aligned normalized vectors higher", () => {
  const query = normalizeVector([1, 0]);
  const aligned = normalizeVector([2, 0]);
  const orthogonal = normalizeVector([0, 3]);

  assert.equal(cosineSimilarity(query, aligned), 1);
  assert.equal(cosineSimilarity(query, orthogonal), 0);
});
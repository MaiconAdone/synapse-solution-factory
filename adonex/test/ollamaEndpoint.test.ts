import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOllamaBaseUrl } from "../src/llm/ollamaEndpoint";

test("Ollama endpoint replaces legacy localhost with IPv4 loopback", () => {
  assert.equal(
    normalizeOllamaBaseUrl("http://localhost:11434"),
    "http://127.0.0.1:11434"
  );
  assert.equal(
    normalizeOllamaBaseUrl("http://127.0.0.1:11434"),
    "http://127.0.0.1:11434"
  );
});

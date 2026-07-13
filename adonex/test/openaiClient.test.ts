import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiClient, OpenAiClientError } from "../src/llm/openaiClient";

test("openai client uses SecretStorage and Responses API without exposing key", async () => {
  let receivedKey = "";
  const client = new OpenAiClient({
    secretStorage: { get: async () => "sk-test-secret-value-123456789" },
    clientFactory: (apiKey) => {
      receivedKey = apiKey;
      return {
        responses: {
          create: async () => ({
            output_text: "structured response",
            usage: { input_tokens: 12, output_tokens: 8 }
          })
        }
      };
    }
  });
  const result = await client.generate({
    systemPrompt: "system",
    userPrompt: "task",
    model: "test-model"
  });
  assert.equal(receivedKey, "sk-test-secret-value-123456789");
  assert.equal(result.text, "structured response");
  assert.equal(result.inputTokens, 12);
});

test("openai client fails clearly when key is missing", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const client = new OpenAiClient({
      secretStorage: { get: async () => undefined },
      configuredApiKey: ""
    });
    await assert.rejects(
      () =>
        client.generate({
          systemPrompt: "system",
          userPrompt: "task",
          model: "test"
        }),
      OpenAiClientError
    );
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  }
});

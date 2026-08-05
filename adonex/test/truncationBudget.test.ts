import assert from "node:assert/strict";
import test from "node:test";
import {
  generateWithTruncationBudget,
  MAX_OUTPUT_TOKEN_BUDGET,
  OllamaTruncatedResponseError
} from "../src/llm/ollamaClient";
import type { LlmResponse } from "../src/llm/types";

function fakeResponse(text: string): LlmResponse {
  return { provider: "ollama", model: "fake", text, inputTokens: 1, outputTokens: 1 };
}

test("returns the first response when nothing truncates", async () => {
  const budgets: number[] = [];
  const result = await generateWithTruncationBudget(async (budget) => {
    budgets.push(budget);
    return fakeResponse("ok");
  }, 768);
  assert.equal(result.text, "ok");
  assert.deepEqual(budgets, [768]);
});

test("retries once with doubled budget when the model truncates", async () => {
  const budgets: number[] = [];
  let retriedWith = 0;
  const result = await generateWithTruncationBudget(
    async (budget) => {
      budgets.push(budget);
      if (budget < 1536) throw new OllamaTruncatedResponseError("truncated");
      return fakeResponse("complete");
    },
    768,
    {
      onRetry: (budget) => {
        retriedWith = budget;
      }
    }
  );
  assert.equal(result.text, "complete");
  assert.deepEqual(budgets, [768, 1536]);
  assert.equal(retriedWith, 1536);
});

test("caps the retry budget at the ceiling", async () => {
  const budgets: number[] = [];
  await generateWithTruncationBudget(async (budget) => {
    budgets.push(budget);
    if (budget < MAX_OUTPUT_TOKEN_BUDGET) {
      throw new OllamaTruncatedResponseError("truncated");
    }
    return fakeResponse("ok");
  }, 3_000);
  assert.deepEqual(budgets, [3_000, MAX_OUTPUT_TOKEN_BUDGET]);
});

test("fails with a clear error when already at the budget ceiling", async () => {
  await assert.rejects(
    () =>
      generateWithTruncationBudget(async () => {
        throw new OllamaTruncatedResponseError("truncated");
      }, MAX_OUTPUT_TOKEN_BUDGET),
    /exceeded the output token budget.*ceiling/
  );
});

test("fails with a clear error when the retry also truncates", async () => {
  await assert.rejects(
    () =>
      generateWithTruncationBudget(async () => {
        throw new OllamaTruncatedResponseError("truncated");
      }, 768),
    /even after doubling/
  );
});

test("propagates non-truncation errors untouched", async () => {
  await assert.rejects(
    () =>
      generateWithTruncationBudget(async () => {
        throw new Error("connection refused");
      }, 768),
    /connection refused/
  );
});

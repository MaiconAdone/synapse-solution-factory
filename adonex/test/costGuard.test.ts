import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CostGuard, estimateCost, estimateTokens } from "../src/cost/costGuard";

test("cost guard estimates tokens and keeps local modes at zero cloud cost", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adonex-cost-"));
  const guard = new CostGuard(root, 0.0001, 1);
  const estimate = estimateCost("x".repeat(4000), "strong", 1000);
  assert.equal(estimateTokens("12345678"), 2);
  assert.equal(estimate.estimatedCostUsd, 0);
  assert.equal((await guard.check(estimate)).allowed, true);
});

test("cost guard records and resets usage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adonex-cost-"));
  const guard = new CostGuard(root, 10, 100);
  await guard.record({
    timestamp: new Date().toISOString(),
    provider: "ollama",
    model: "test",
    inputTokens: 10,
    outputTokens: 5,
    estimatedCostUsd: 0.1
  });
  assert.equal((await guard.check(estimateCost("small", "balanced"))).dailyUsedUsd, 0.1);
  await guard.reset();
  assert.equal((await guard.check(estimateCost("small", "balanced"))).dailyUsedUsd, 0);
});

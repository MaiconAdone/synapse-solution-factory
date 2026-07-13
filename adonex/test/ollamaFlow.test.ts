import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Ollama Synapse model inventory flows through model analysis", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "agent", "agentOrchestrator.ts"),
    "utf8"
  );

  assert.doesNotMatch(source, /buildSynapseModelInventoryAnswer/);
  assert.doesNotMatch(source, /inputTokens:\s*0/);
  assert.match(source, /Nao use atalhos deterministicos/);
  assert.match(source, /temperature:\s*configuration\.get<number>\("ollama\.temperature", 0\)/);
  assert.match(source, /repeatPenalty:\s*Math\.max/);
  assert.doesNotMatch(source, /seed:\s*42,[\s\S]*generateFastLocalChat/);
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildRufloCouncilContext,
  readEnterpriseAgents
} from "../src/synapse/rufloCouncil";

const root = path.resolve(process.cwd(), "..");

test("Ruflo council reads the 60 Synapse enterprise agents", () => {
  const agents = readEnterpriseAgents(root);

  assert.equal(agents.length, 60);
  assert.equal(agents.filter((agent) => agent.tier === "core").length, 15);
  assert.equal(
    agents.filter((agent) => agent.tier === "specialist").length,
    45
  );
});

test("Ruflo council activates all 60 roles without requesting 60 Ollama calls", () => {
  const council = buildRufloCouncilContext(
    root,
    "criar agente RAG com MCP, baixo custo e seguranca",
    {
      enabled: true,
      maxAgents: 60,
      llmConcurrency: 1,
      maxChars: 20_000
    }
  );

  assert.equal(council.enabled, true);
  assert.equal(council.activeAgents, 60);
  assert.equal(council.llmCalls, 1);
  assert.match(council.text, /RUFLO 60-AGENT COUNCIL ACTIVE/);
  assert.match(council.text, /do not create 60 separate Ollama generations/);
  assert.match(council.text, /rag-engineering/);
  assert.match(council.text, /mcp-integration-specialist/);
});

test("Ruflo council uses a compressed selective set for AdoneX code work", () => {
  const council = buildRufloCouncilContext(
    root,
    "corrija bug no backend com teste e seguranca usando modelo local",
    {
      enabled: true,
      maxAgents: 8,
      llmConcurrency: 1,
      maxChars: 6_000,
      action: "fix",
      localModelProfile: "code_review"
    }
  );

  assert.equal(council.enabled, true);
  assert.equal(council.activeAgents, 8);
  assert.equal(council.llmCalls, 1);
  assert.equal(council.strategy, "code-edit-code_review-8-roles");
  assert.match(council.text, /RUFLO SELECTIVE COUNCIL ACTIVE/);
  assert.match(council.text, /Quality gates for AdoneX code edits/);
  assert.match(council.text, /backend-engineering/);
  assert.match(council.text, /testing-qa/);
  assert.ok(council.domains.includes("backend"));
  assert.ok(council.domains.includes("quality"));
});

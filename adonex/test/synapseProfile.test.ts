import assert from "node:assert/strict";
import test from "node:test";
import { detectSynapseProject } from "../src/context/workspaceContextCore";
import { synapseSystemContext } from "../src/synapse/synapseProfile";

test("Synapse detector requires strong project-specific structure", () => {
  const result = detectSynapseProject(
    [
      "config/runtime_manifest.json",
      "scripts/start_ruflo_swarm.ps1",
      ".mcp.json",
      "agents/definitions/enterprise_agents.yaml",
      "backend/app/main.py",
      "frontend/package.json",
      "ml_systems/data_contract.yaml"
    ],
    "Ruflo agentic mesh Ollama OpenAI Jupyter"
  );
  assert.equal(result.detected, true);
  assert.ok(result.confidence >= 0.8);
  assert.ok(result.signals.includes("runtime-manifest"));
});

test("generic full-stack AI project is not falsely detected as Synapse", () => {
  const result = detectSynapseProject(
    ["backend/main.py", "frontend/package.json", "README.md"],
    "FastAPI React OpenAI"
  );
  assert.equal(result.detected, false);
});

test("Synapse system prompt activates senior AI architecture policy", () => {
  const prompt = synapseSystemContext(
    true,
    false,
    0.94,
    ["runtime-manifest", "ruflo-runtime"]
  );
  assert.match(prompt, /SYNAPSE MODE IS ACTIVE/);
  assert.match(prompt, /senior AI architect/);
  assert.match(prompt, /Ruflo 60-agent council/);
  assert.match(prompt, /Ollama/);
});

test("Synapse system prompt stays byte-stable across confidence jitter", () => {
  // Mesma faixa de confianca => mesmo texto, preservando o prefix cache.
  const a = synapseSystemContext(true, false, 0.94, ["runtime-manifest"]);
  const b = synapseSystemContext(true, false, 0.81, ["runtime-manifest"]);
  assert.equal(a, b);
  assert.doesNotMatch(a, /0\.94/);
  // Linha volatil de deteccao fica no final do bloco.
  assert.match(a.trim().split("\n").at(-1) ?? "", /automatically detected/);
});

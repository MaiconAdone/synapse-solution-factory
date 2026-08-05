import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeConfiguredAgentMode,
  resolveAgentMode,
  selectAutomaticAgentMode
} from "../src/chat/agentModeSelector";
import type { ChatRoute } from "../src/chat/chatRouting";

const localRoute: ChatRoute = {
  action: "chat",
  mode: "local",
  title: "Chat",
  governed: false
};

test("automatic agent mode keeps simple questions on local Ollama", () => {
  assert.equal(
    selectAutomaticAgentMode("qual o tempo medio de resposta do modelo local?", "chat", localRoute),
    "local"
  );
});

test("automatic agent mode escalates code changes and risky work", () => {
  assert.equal(
    selectAutomaticAgentMode("corrija o bug no painel", "implement", {
      mode: "local",
      governed: true
    }),
    "balanced"
  );
  assert.equal(
    selectAutomaticAgentMode("revise seguranca LGPD antes de producao", "review", localRoute),
    "strong"
  );
});

test("automatic agent mode selects Synapse for solution factory and synapse routes", () => {
  assert.equal(
    selectAutomaticAgentMode("crie uma solucao RAG com MCP", "synapse_agent", {
      mode: "synapse",
      governed: true
    }),
    "synapse"
  );
});

test("manual modes override automatic mode and legacy economic normalizes to auto", () => {
  assert.equal(resolveAgentMode("explique", "chat", localRoute, "strong"), "strong");
  assert.equal(resolveAgentMode("explique", "chat", localRoute, "auto"), "local");
  assert.equal(normalizeConfiguredAgentMode("economic"), "auto");
  assert.equal(normalizeConfiguredAgentMode("balanced"), "balanced");
});

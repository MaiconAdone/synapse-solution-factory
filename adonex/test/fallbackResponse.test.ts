import assert from "node:assert/strict";
import test from "node:test";
import {
  createSynapseExplanationResponse,
  createLocalChatFailureResponse,
  createLocalFallbackResponse
} from "../src/chat/fallbackResponse";
import type { TaskPlan, WorkspaceSnapshot } from "../src/llm/types";

test("Synapse fallback analyzes the question when Ollama times out", () => {
  const snapshot: WorkspaceSnapshot = {
    root: "C:/repo",
    stack: ["FastAPI", "React", "Ollama"],
    synapseDetected: true,
    synapseConfidence: 0.9,
    synapseSignals: ["runtime-manifest", "mcp-config"],
    structure: [],
    relevantFiles: [],
    estimatedTokens: 10
  };
  const plan: TaskPlan = {
    id: "p1",
    action: "chat",
    mode: "local",
    objective: "explique o projeto Synapse",
    filesToRead: ["package.json"],
    filesToChange: [],
    commands: ["npm run check"],
    risks: [],
    estimatedInputTokens: 10,
    estimatedOutputTokens: 10,
    estimatedCostUsd: 0,
    requiresApproval: false,
    recommendedExecution: "adonex-local"
  };
  const text = createLocalFallbackResponse(
    "explique o projeto Synapse e quais modelos locais estamos usando",
    snapshot,
    plan,
    "request exceeded 90 seconds"
  );
  assert.match(text, /Ollama local nao concluiu a resposta/);
  assert.match(text, /Analise da pergunta/);
  assert.match(text, /inventario-ou-roteamento-de-modelos/);
  assert.match(text, /Nenhuma resposta gerada pelo Ollama foi usada/);
  assert.match(text, /request exceeded 90 seconds/);
  assert.doesNotMatch(text, /Resposta deterministica de emergencia/i);
  assert.doesNotMatch(text, /Explicacao Executiva do Projeto Synapse/);
});

test("local chat timeout fallback is not rendered as user cancellation", () => {
  const text = createLocalChatFailureResponse(
    "qual o tempo medio de resposta do modelo local em uma solicitacao simples?",
    "qwen3-coder-14b-team",
    "request exceeded 120 seconds"
  );

  assert.match(text, /Ollama local nao concluiu a resposta/);
  assert.match(text, /qwen3-coder-14b-team/);
  assert.match(text, /inventario-ou-roteamento-de-modelos/);
  assert.match(text, /pergunta-aberta/);
  assert.match(text, /nao tratou isso como cancelamento do usuario/);
  assert.doesNotMatch(text, /Processo interrompido/);
});

test("static Synapse fallback explanation does not mention an Ollama failure", () => {
  const snapshot: WorkspaceSnapshot = {
    root: "C:/repo",
    stack: ["FastAPI", "React", "Ollama"],
    synapseDetected: true,
    synapseConfidence: 1,
    synapseSignals: ["runtime-manifest", "mcp-config"],
    structure: [],
    relevantFiles: [],
    estimatedTokens: 10
  };
  const plan: TaskPlan = {
    id: "p2",
    action: "synapse_explain",
    mode: "local",
    objective: "explique o projeto Synapse",
    filesToRead: ["README.md", "package.json"],
    filesToChange: [],
    commands: [],
    risks: [],
    estimatedInputTokens: 10,
    estimatedOutputTokens: 10,
    estimatedCostUsd: 0,
    requiresApproval: false,
    recommendedExecution: "adonex-local"
  };
  const text = createSynapseExplanationResponse(snapshot, plan);
  assert.match(text, /Explicacao Executiva do Projeto Synapse/);
  assert.doesNotMatch(text, /nao respondeu a tempo/i);
  assert.doesNotMatch(text, /deterministica/i);
});

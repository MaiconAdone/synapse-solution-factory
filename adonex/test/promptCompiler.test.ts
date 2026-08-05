import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePrompt,
  inferIntent
} from "../src/agent/promptCompiler";
import { STATIC_POLICY_PROMPT } from "../src/agent/prompts";
import type { WorkspaceSnapshot } from "../src/llm/types";

const snapshot: WorkspaceSnapshot = {
  root: "C:/repo",
  stack: ["FastAPI", "React", "Ollama", "Ruflo", "MCP"],
  synapseDetected: true,
  synapseConfidence: 1,
  synapseSignals: ["runtime-manifest", "mcp-config"],
  structure: [],
  relevantFiles: [
    {
      path: "README.md",
      content: "# Synapse",
      redacted: false,
      score: 12,
      reasons: ["project-doc"]
    }
  ],
  estimatedTokens: 200
};

test("prompt compiler classifies executive Synapse requests", () => {
  assert.equal(
    inferIntent("quero uma explicaÃ§Ã£o completa e executiva do Synapse", "chat"),
    "explicacao-executiva"
  );
});

test("prompt compiler classifies Synapse model inventory requests", () => {
  assert.equal(
    inferIntent("quais modelos estamos usando na Synapse?", "synapse_explain"),
    "inventario-de-modelos"
  );
});

test("prompt compiler creates a structured optimized prompt", () => {
  const compiled = compilePrompt(
    "crie um agente para validar contratos de API",
    "synapse_agent",
    "synapse",
    snapshot,
    { enabled: true }
  );

  assert.match(compiled.systemAddendum, /PROMPT ENGINEERING ACTIVE/);
  assert.match(compiled.optimizedPrompt, /PROMPT OTIMIZADO PELO ADONEX PROMPT COMPILER/);
  assert.match(compiled.optimizedPrompt, /Objetivo do usuario/);
  // Politicas estaticas nao podem voltar ao user prompt: elas vivem no system
  // prompt (STATIC_POLICY_PROMPT) para preservar o prefix cache do Ollama.
  assert.doesNotMatch(compiled.optimizedPrompt, /Politicas obrigatorias/);
});

test("static policy prompt keeps mandatory policies for the system prompt", () => {
  assert.match(STATIC_POLICY_PROMPT, /Politicas obrigatorias/);
  assert.match(STATIC_POLICY_PROMPT, /baixo custo/i);
  assert.match(STATIC_POLICY_PROMPT, /analisar o pedido atual/i);
  assert.match(STATIC_POLICY_PROMPT, /Nao usar resposta deterministica pronta/i);
  assert.match(STATIC_POLICY_PROMPT, /Padrao GPT\/Claude para modelo local/);
  assert.match(STATIC_POLICY_PROMPT, /Nao revelar chain-of-thought/);
  assert.match(STATIC_POLICY_PROMPT, /Anti-alucinacao/);
  assert.match(STATIC_POLICY_PROMPT, /nao tenho evidencia no contexto fornecido/i);
  assert.match(STATIC_POLICY_PROMPT, /Nao expor secrets/i);
  assert.match(STATIC_POLICY_PROMPT, /Ruflo, MCP, Ollama/);
  assert.match(STATIC_POLICY_PROMPT, /agentic coding profissional/);
  assert.match(STATIC_POLICY_PROMPT, /AdoneX usa somente modelos locais/);
  assert.match(STATIC_POLICY_PROMPT, /Nao encaminhar prompts para LLMs externos/);
});

test("prompt compiler blocks external LLM execution even in strong mode", () => {
  const compiled = compilePrompt(
    "usando modelo externo LLM evolua o agente de codificacao",
    "implement",
    "strong",
    snapshot,
    { enabled: true }
  );

  assert.equal(inferIntent(compiled.originalPrompt, "implement"), "implementacao-governada");
  assert.match(compiled.optimizedPrompt, /engenheiro senior do Synapse/);
});

test("prompt compiler can be disabled", () => {
  const compiled = compilePrompt("responda ok", "chat", "local", snapshot, {
    enabled: false
  });

  assert.equal(compiled.optimizedPrompt, "responda ok");
  assert.match(compiled.systemAddendum, /disabled/);
});

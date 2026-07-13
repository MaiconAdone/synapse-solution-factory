import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePrompt,
  inferIntent
} from "../src/agent/promptCompiler";
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
  assert.match(compiled.optimizedPrompt, /Politicas obrigatorias/);
  assert.match(compiled.optimizedPrompt, /baixo custo/i);
  assert.match(compiled.optimizedPrompt, /analisar o pedido atual/i);
  assert.match(compiled.optimizedPrompt, /Nao usar resposta deterministica pronta/i);
  assert.match(compiled.optimizedPrompt, /Padrao GPT\/Claude para modelo local/);
  assert.match(compiled.optimizedPrompt, /Nao revelar chain-of-thought/);
  assert.match(compiled.optimizedPrompt, /Anti-alucinacao/);
  assert.match(compiled.optimizedPrompt, /nao tenho evidencia no contexto fornecido/i);
  assert.match(compiled.optimizedPrompt, /Nao expor secrets/i);
  assert.match(compiled.optimizedPrompt, /Ruflo, MCP, Ollama/);
});

test("prompt compiler marks explicit external LLM coding mode as governed", () => {
  const compiled = compilePrompt(
    "usando modelo externo LLM evolua o agente de codificacao",
    "implement",
    "strong",
    snapshot,
    { enabled: true }
  );

  assert.equal(inferIntent(compiled.originalPrompt, "implement"), "implementacao-governada");
  assert.match(compiled.optimizedPrompt, /agentic coding profissional/);
  assert.match(compiled.optimizedPrompt, /LLM externo foi solicitado\/autorizado/);
  assert.match(compiled.optimizedPrompt, /escrita governada por aprovacao/);
});

test("prompt compiler can be disabled", () => {
  const compiled = compilePrompt("responda ok", "chat", "local", snapshot, {
    enabled: false
  });

  assert.equal(compiled.optimizedPrompt, "responda ok");
  assert.match(compiled.systemAddendum, /disabled/);
});

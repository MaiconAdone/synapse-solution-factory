import assert from "node:assert/strict";
import test from "node:test";
import { classifyTaskComplexity } from "../src/agent/taskRouter";

test("task router keeps simple summaries local", () => {
  assert.equal(
    classifyTaskComplexity("resuma este modulo e explique a funcao"),
    "adonex-local"
  );
});

test("task router keeps bounded implementation work local", () => {
  assert.equal(
    classifyTaskComplexity("implementar um pequeno modulo isolado com testes"),
    "adonex-local"
  );
  assert.equal(
    classifyTaskComplexity("implementar um pequeno modulo isolado com testes usando Ollama local e baixo custo"),
    "adonex-local"
  );
});

test("task router keeps Synapse implementation work on AdoneX local", () => {
  assert.equal(
    classifyTaskComplexity(
      "editar e programar alteracoes no Synapse",
      "Stack: TypeScript\nSynapse workspace: yes\nSynapse confidence: 1"
    ),
    "adonex-local"
  );
});

test("task router ignores explicit external LLM requests in Synapse", () => {
  assert.equal(
    classifyTaskComplexity(
      "usar modelo externo LLM para evoluir o agente de codificacao",
      "Stack: TypeScript\nSynapse workspace: yes\nSynapse confidence: 1"
    ),
    "adonex-local"
  );
});

test("task router recommends Codex for cross-system architecture", () => {
  assert.equal(
    classifyTaskComplexity(
      "refatorar arquitetura multi-file com backend, frontend, banco de dados, MCP e Ruflo multiagente"
    ),
    "codex-recommended"
  );
});

test("task router does not recommend Codex only because Synapse memory is complex", () => {
  const synapseContext =
    "architecture backend frontend database MCP Ruflo multi-agent security pipeline AI ML";
  assert.equal(
    classifyTaskComplexity(
      "resuma o estado atual",
      synapseContext.repeat(2000),
      synapseContext.repeat(1000)
    ),
    "adonex-local"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAdoneXResponse } from "../src/chat/responseSanitizer";

test("response sanitizer preserves the Synapse brand name", () => {
  const response = sanitizeAdoneXResponse("Jerico detectado: sim. O projeto jerico esta ativo.");

  assert.equal(response, "Synapse detectado: sim. O projeto Synapse esta ativo.");
});

test("response sanitizer replaces generic deterministic engineering checklist", () => {
  const response = sanitizeAdoneXResponse(
    [
      "O sistema Synapse está em conformidade com as especificações fornecidas.",
      "",
      "Optimização da Memória:",
      "Verifique recursos redundantes.",
      "",
      "Aumento da Concurrency:",
      "Aumente paralelismo.",
      "",
      "Melhoria da Latência:",
      "Revise gargalos."
    ].join("\n")
  );

  assert.match(response, /Corrigido: o projeto detectado deve ser chamado de Synapse/);
  assert.match(response, /rota ampla de orientacao de engenharia/);
  assert.doesNotMatch(response, /Optimização da Memória/);
});

test("response sanitizer removes local model thinking traces and low-value prefixes", () => {
  const response = sanitizeAdoneXResponse([
    "<think>vou raciocinar internamente</think>",
    "Claro, aqui está uma resposta profissional:",
    "",
    "## Conclusão",
    "O Synapse deve usar contexto local.",
    "",
    "",
    "Próximo passo: rode `npm test`."
  ].join("\n"));

  assert.doesNotMatch(response, /think|raciocinar internamente/i);
  assert.doesNotMatch(response, /^Claro/i);
  assert.match(response, /^## Conclusão/);
  assert.doesNotMatch(response, /\n{3,}/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { guardAgainstLocalHallucinations } from "../src/chat/hallucinationGuard";

test("hallucination guard flags unsupported operational certainty", () => {
  const guarded = guardAgainstLocalHallucinations(
    "O arquivo frontend/app/page.tsx foi alterado com certeza.",
    { files: ["README.md"], commands: [], stack: [], synapseDetected: true }
  );

  assert.match(guarded, /Nota de confiabilidade local/);
  assert.match(guarded, /certeza operacional/);
  assert.match(guarded, /frontend\/app\/page\.tsx/);
});

test("hallucination guard leaves grounded responses unchanged", () => {
  const response = "Conclusão: `README.md` documenta o Synapse.";
  const guarded = guardAgainstLocalHallucinations(response, {
    files: ["README.md"],
    commands: [],
    stack: ["Ollama"],
    synapseDetected: true
  });

  assert.equal(guarded, response);
});

test("hallucination guard softens unsupported execution claims", () => {
  const guarded = guardAgainstLocalHallucinations(
    "Rodei os testes e o build passou.",
    { files: ["package.json"], commands: [], stack: ["Ollama"], synapseDetected: true }
  );

  assert.match(guarded, /Nota de confiabilidade local/);
  assert.match(guarded, /sem comando confirmado/);
  assert.match(guarded, /Não tenho evidência do host/);
});

test("hallucination guard accepts execution claims when command evidence exists", () => {
  const response = "Executei npm test e os testes passaram.";
  const guarded = guardAgainstLocalHallucinations(response, {
    files: ["package.json"],
    commands: ["npm test"],
    stack: ["Ollama"],
    synapseDetected: true
  });

  assert.equal(guarded, response);
});
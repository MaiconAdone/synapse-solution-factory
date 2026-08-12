import assert from "node:assert/strict";
import test from "node:test";
import { actionPrompt, BASE_SYSTEM_PROMPT, FABLE_METHOD_POLICY } from "../src/agent/prompts";

test("AdoneX requires Brazilian Portuguese responses", () => {
  assert.match(BASE_SYSTEM_PROMPT, /portugues do Brasil \(pt-BR\)/i);
  assert.match(actionPrompt("review"), /pt-BR/i);
  assert.match(actionPrompt("implement"), /resumo em pt-BR/i);
});

test("AdoneX system prompt carries the simplicity-first guideline", () => {
  assert.match(BASE_SYSTEM_PROMPT, /Simplicidade primeiro/i);
  assert.match(BASE_SYSTEM_PROMPT, /sem abstracoes de uso unico/i);
});

test("fable-method policy declares the classify->done->evidence->act->verify->report cycle", () => {
  assert.match(FABLE_METHOD_POLICY, /Classificar/i);
  assert.match(FABLE_METHOD_POLICY, /Definir pronto/i);
  assert.match(FABLE_METHOD_POLICY, /Reunir evidencia/i);
  assert.match(FABLE_METHOD_POLICY, /Verificar/i);
  assert.match(FABLE_METHOD_POLICY, /Reportar/i);
});

test("fable-method policy forbids weakening tests to pass validation", () => {
  assert.match(FABLE_METHOD_POLICY, /nunca enfraqueca, remova, comente ou marque como skip\/only/i);
});

test("implement and fix require an explicit Criterio de pronto line in summary", () => {
  assert.match(actionPrompt("implement"), /Criterio de pronto:/);
  assert.match(actionPrompt("fix"), /Criterio de pronto:/);
});

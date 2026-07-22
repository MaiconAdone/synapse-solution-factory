import assert from "node:assert/strict";
import test from "node:test";
import { actionPrompt, BASE_SYSTEM_PROMPT } from "../src/agent/prompts";

test("AdoneX requires Brazilian Portuguese responses", () => {
  assert.match(BASE_SYSTEM_PROMPT, /portugues do Brasil \(pt-BR\)/i);
  assert.match(actionPrompt("review"), /pt-BR/i);
  assert.match(actionPrompt("implement"), /resumo em pt-BR/i);
});

test("AdoneX system prompt carries the simplicity-first guideline", () => {
  assert.match(BASE_SYSTEM_PROMPT, /Simplicidade primeiro/i);
  assert.match(BASE_SYSTEM_PROMPT, /sem abstracoes de uso unico/i);
});

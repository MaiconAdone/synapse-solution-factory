import assert from "node:assert/strict";
import test from "node:test";
import { answerLocalRuntimeQuestion } from "../src/chat/localRuntimeAnswers";

test("local runtime latency questions are answered without model generation", () => {
  const answer = answerLocalRuntimeQuestion(
    "qual o tempo medio de resposta do modelo local em uma solicitacao simples?",
    { model: "qwen2.5-coder:3b", timeoutSeconds: 120 }
  );

  assert.ok(answer);
  assert.match(answer, /resposta local imediata/);
  assert.match(answer, /qwen2\.5-coder:3b/);
  assert.match(answer, /120s/);
  assert.doesNotMatch(answer, /Ollama local nao concluiu/);
});

test("local runtime answers ignore unrelated prompts", () => {
  assert.equal(
    answerLocalRuntimeQuestion("explique arquitetura hexagonal", {
      model: "qwen2.5-coder:3b",
      timeoutSeconds: 120
    }),
    undefined
  );
});

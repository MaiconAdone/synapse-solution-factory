import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalChatContext,
  localChatOutputBudget,
  localChatSystemPrompt,
  shouldUseLeanLocalChat
} from "../src/chat/localChatPolicy";
import { ADONEX_LOCAL_MODEL_PROFILES } from "../src/llm/localModels";

test("lean local chat keeps simple local-model questions on model generation without workspace baggage", () => {
  const prompt = "qual o tempo medio de resposta do modelo local em uma solicitacao simples?";

  assert.equal(shouldUseLeanLocalChat(prompt), true);
  assert.equal(
    buildLocalChatContext({
      prompt,
      recentHistory: "fallback antigo",
      memoryContext: "memoria grande",
      projectContext: "contexto do projeto",
      mentionContext: "",
      attachmentContext: ""
    }),
    undefined
  );
  assert.equal(localChatOutputBudget(prompt, ADONEX_LOCAL_MODEL_PROFILES.fast, 900), 192);
  assert.match(localChatSystemPrompt("base", prompt), /Nao invente metricas medidas/);
});

test("lean local chat preserves explicit attachments and avoids edit requests", () => {
  assert.equal(shouldUseLeanLocalChat("corrija o bug no painel"), false);
  assert.equal(
    buildLocalChatContext({
      prompt: "explique este arquivo",
      recentHistory: "",
      memoryContext: "",
      projectContext: "",
      mentionContext: "Arquivo citado",
      attachmentContext: "Anexo"
    }),
    "Arquivo citado\n\nAnexo"
  );
});

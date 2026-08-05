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

test("'como rodar/usar o projeto' is not lean: needs real workspace context and a full answer budget", () => {
  // Regressao: comecava com "como" e caia no teto lean de 192 tokens sem
  // varredura de workspace, virando tutorial generico inventado e cortado.
  const prompt = "como posso rodar o validador no navegador?";
  assert.equal(shouldUseLeanLocalChat(prompt), false);
  assert.equal(
    localChatOutputBudget(prompt, ADONEX_LOCAL_MODEL_PROFILES.fast, 384),
    384
  );
  assert.notEqual(
    buildLocalChatContext({
      prompt,
      recentHistory: "",
      memoryContext: "",
      projectContext: "Conteudo real do projeto",
      mentionContext: "",
      attachmentContext: ""
    }),
    undefined
  );
});

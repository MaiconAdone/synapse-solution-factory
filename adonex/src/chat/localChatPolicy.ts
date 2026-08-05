import type { LocalModelCallProfile } from "../llm/localModels";

export function shouldUseLeanLocalChat(prompt: string): boolean {
  const normalized = stripAccents(prompt.toLowerCase());
  const simpleQuestion =
    /\b(o que|como|porque|por que|qual|quais|quanto|explique|explica|resuma)\b/.test(normalized);
  const editOrCommand =
    /\b(corrij|implemente|adicione|altere|edite|refatore|rode|execute|aplique|crie arquivo)\b/.test(
      normalized
    );
  const asksRuntime =
    /\b(modelo local|ollama|qwen|deepseek|latencia|tempo de resposta|tempo medio|performance|timeout)\b/.test(
      normalized
    );
  // "como rodar/usar/instalar o projeto" comeca com "como" (cai em
  // simpleQuestion) mas NAO e trivia: precisa do contexto real do workspace
  // (readProjectContext) e de um budget de resposta maior que o teto lean de
  // 192 tokens, senao vira tutorial generico inventado e cortado no meio.
  const asksHowToRunProject =
    /\b(como|onde)\b[\s\S]*\b(rodar|rodo|roda|executar|executo|usar|uso|instalar|instalo|iniciar|inicio|configurar|configuro|abrir|abro|subir|subo|start|startar)\b/.test(
      normalized
    );
  return (
    !editOrCommand &&
    !asksHowToRunProject &&
    (simpleQuestion || asksRuntime) &&
    prompt.length < 800
  );
}

export function localChatOutputBudget(
  prompt: string,
  profile: LocalModelCallProfile,
  configuredMaxTokens: number
): number {
  if (!shouldUseLeanLocalChat(prompt)) return configuredMaxTokens;
  return Math.min(configuredMaxTokens, profile.maxOutputTokens, 192);
}

export function buildLocalChatContext(parts: {
  prompt: string;
  recentHistory: string;
  memoryContext: string;
  projectContext: string;
  mentionContext: string;
  attachmentContext: string;
}): string | undefined {
  if (parts.mentionContext || parts.attachmentContext) {
    return [parts.mentionContext, parts.attachmentContext].filter(Boolean).join("\n\n");
  }
  if (shouldUseLeanLocalChat(parts.prompt)) return undefined;
  return (
    [parts.recentHistory, parts.memoryContext, parts.projectContext].filter(Boolean).join("\n\n") ||
    undefined
  );
}

export function localChatSystemPrompt(basePrompt: string, prompt: string): string {
  if (!shouldUseLeanLocalChat(prompt)) return basePrompt;
  return [
    basePrompt,
    "",
    "Para esta pergunta curta, responda diretamente em pt-BR.",
    "Nao invente metricas medidas, benchmarks, comandos executados ou estado atual do Ollama.",
    "Se a pergunta pedir valor medio/latencia e nao houver medicao fornecida, explique que depende do hardware, carga e tamanho do prompt, e diferencie timeout configurado de media real."
  ].join("\n");
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

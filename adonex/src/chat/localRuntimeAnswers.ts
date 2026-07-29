export interface LocalRuntimeAnswerOptions {
  model: string;
  timeoutSeconds: number;
}

export function answerLocalRuntimeQuestion(
  prompt: string,
  options: LocalRuntimeAnswerOptions
): string | undefined {
  const normalized = stripAccents(prompt.toLowerCase());
  const asksLatency =
    /\b(tempo medio|tempo de resposta|latencia|demora|quanto tempo|performance)\b/.test(normalized);
  const asksLocalModel =
    /\b(modelo local|ollama|qwen|deepseek|adonex local|llm local)\b/.test(normalized);
  if (!asksLatency || !asksLocalModel) return undefined;

  return [
    "Para uma solicitacao simples, o AdoneX deve responder de duas formas:",
    "",
    "- Perguntas operacionais sobre o proprio AdoneX/Ollama: resposta local imediata, sem chamar o modelo.",
    `- Perguntas abertas que exigem geracao: usa \`${options.model}\` e respeita timeout de ${options.timeoutSeconds}s.`,
    "",
    "No historico deste workspace, chamadas deterministicas de status/conexao responderam em menos de 1s. Ja geracoes abertas no Ollama em CPU/RAM podem variar bastante; quando chegam ao timeout configurado, como 120s, isso deve ser tratado como falha de runtime/cold start, nao como tempo medio aceitavel.",
    "",
    "Regra pratica: perguntas simples de status/configuracao devem ficar abaixo de 1s; perguntas abertas no modelo local devem ser medidas por benchmark no hardware atual, e qualquer estouro de timeout indica que o Ollama/modelo precisa ser aquecido, reiniciado ou ter contexto/saida reduzidos."
  ].join("\n");
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

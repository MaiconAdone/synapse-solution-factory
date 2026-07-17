export type TaskRoute =
  | "adonex-local"
  | "codex-recommended";

export function classifyTaskComplexity(
  prompt: string,
  workspaceContext = "",
  memory = ""
): TaskRoute {
  const text = prompt.toLowerCase();
  const contextText = `${workspaceContext}\n${memory}`.toLowerCase();
  const localPreferred =
    /\b(local|ollama|sem cloud|baixo custo|reduzir custo|economico|econ[oô]mico|rapido|r[áa]pido)\b/.test(
      text
    ) ||
    /\bsynapse workspace:\s*yes\b/.test(contextText) ||
    /\b(local-first|ollama local|cloud desativada|cloud proibida)\b/.test(contextText);
  const complexSignals = [
    /multi[- ]?file|varios arquivos|muitos arquivos/,
    /architectur|arquitetur/,
    /backend.*frontend|frontend.*backend/,
    /database|banco de dados|migration/,
    /authentication|autenticacao|security|seguranca/,
    /mcp.*ruflo|ruflo.*mcp|multi[- ]?agent|multiagente/,
    /pipeline.*(?:ai|ml)|(?:ai|ml).*pipeline/,
    /unknown root cause|causa desconhecida/
  ].filter((pattern) => pattern.test(text)).length;
  const explicitBroadScope =
    /\b(all|complete|entire|full|todo|completo|inteiro)\b/.test(text) &&
    /\b(project|system|workspace|projeto|sistema)\b/.test(text);
  const contextIsLarge =
    workspaceContext.length > 80_000 || memory.length > 40_000;
  if (
    complexSignals >= 2 ||
    (complexSignals >= 1 && explicitBroadScope) ||
    (text.length > 12_000 && contextIsLarge)
  ) {
    return "codex-recommended";
  }

  const mediumSignals = [
    /generate tests|gerar testes|test coverage/,
    /isolated fix|correcao isolada|bug/,
    /create module|criar modulo/,
    /technical review|revisao tecnica/,
    /implement|implementar/,
    /codifica|programar|editar|alterar|alteracoes|altera[cç][aã]o/
  ].filter((pattern) => pattern.test(text)).length;
  if (mediumSignals >= 1 || text.length > 4_000) {
    return "adonex-local";
  }
  return "adonex-local";
}

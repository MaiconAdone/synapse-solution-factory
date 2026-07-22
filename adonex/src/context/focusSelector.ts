import { summarizeCodeSymbols } from "./codeIntelligence";

export interface FocusFile {
  path: string;
  content: string;
}

/**
 * Seletor de arquivos-foco DETERMINISTICO, sem chamar LLM. Usa o grafo de
 * simbolos que o AdoneX ja extrai (summarizeCodeSymbols) para decidir quais
 * arquivos a tarefa referencia. E o caminho barato do narrowing: quando a tarefa
 * nomeia um simbolo (funcao/classe/const/export) ou o nome de um arquivo,
 * escolhemos esse arquivo sem gastar os ~14-25s de uma geracao 3B do router.
 *
 * Conservador de proposito: so retorna arquivos com match de simbolo/nome (alta
 * confianca). Se nada casar, retorna [] e o chamador cai no router LLM (ou nao
 * estreita), preservando o contexto completo em vez de arriscar cortar demais.
 */
export function selectFocusFilesByGraph(
  task: string,
  files: FocusFile[],
  maxFiles = 3
): string[] {
  if (files.length < 2) return [];
  const terms = tokenize(task);
  if (!terms.size) return [];

  const summaries = files.map((file) => ({
    path: file.path,
    base: baseNoExt(file.path),
    symbols: summarizeCodeSymbols(file.path, file.content)
  }));

  // Grafo: in-degree por basename (quantos candidatos importam este arquivo).
  const baseToPath = new Map<string, string>();
  for (const summary of summaries) {
    if (summary.base) baseToPath.set(summary.base, summary.path);
  }
  const inDegree = new Map<string, number>();
  for (const summary of summaries) {
    for (const specifier of summary.symbols.imports) {
      const target = baseToPath.get(baseNoExt(specifier));
      if (target && target !== summary.path) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  const scored = summaries
    .map((summary) => {
      let hits = 0;
      if (summary.base.length > 3 && terms.has(summary.base)) hits += 3;
      for (const symbol of [...summary.symbols.exports, ...summary.symbols.declared]) {
        if (symbol.length > 3 && terms.has(symbol.toLowerCase())) hits += 2;
      }
      const score = hits + (inDegree.get(summary.path) ?? 0) * 0.5;
      return { path: summary.path, hits, score };
    })
    // So arquivos explicitamente referenciados entram (alta confianca).
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  const result = scored.slice(0, maxFiles).map((item) => item.path);
  // Nao "estreita" se o foco cobrir todos os candidatos (sem ganho de contexto).
  if (result.length >= files.length) return [];
  return result;
}

function tokenize(task: string): Set<string> {
  const normalized = task
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const terms = new Set<string>();
  for (const term of normalized.split(/[^a-z0-9_]+/)) {
    if (term.length > 3) terms.add(term);
  }
  return terms;
}

function baseNoExt(specifier: string): string {
  const name = specifier.split(/[\\/]/).pop() ?? specifier;
  return name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

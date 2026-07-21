import type { ImplementationProposal, ProposedFileChange } from "../llm/types";

export type ComposerChangeKind = "create" | "modify" | "delete";

export interface ComposerFileView {
  path: string;
  changeKind: ComposerChangeKind;
  additions: number;
  deletions: number;
  selected: boolean;
  preview: string;
}

export interface ComposerProposalView {
  summary: string;
  files: ComposerFileView[];
  commands: string[];
}

const MAX_DIFF_LINES = 2_000;
const MAX_PREVIEW_LINES = 60;

/**
 * Classifica a mudanca de um arquivo do composer com base no conteudo anterior
 * e no conteudo proposto. Criacao quando o arquivo nao existia; delecao quando
 * o conteudo proposto esvazia um arquivo existente; caso contrario, modificacao.
 */
export function inferChangeKind(
  before: string | undefined,
  after: string
): ComposerChangeKind {
  const existed = before !== undefined && before.length > 0;
  if (!existed) return "create";
  if (after.trim().length === 0) return "delete";
  return "modify";
}

interface DiffLine {
  tag: " " | "-" | "+";
  text: string;
}

/**
 * Diff linha a linha por LCS, com teto de tamanho para nao travar arquivos
 * grandes. Acima do teto, cai para um diff cheio (tudo removido e readicionado),
 * que ainda produz contagens uteis sem custo quadratico.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    return [
      ...beforeLines.map((text): DiffLine => ({ tag: "-", text })),
      ...afterLines.map((text): DiffLine => ({ tag: "+", text }))
    ];
  }

  const rows = beforeLines.length;
  const cols = afterLines.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0)
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i][j] =
        beforeLines[i] === afterLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (beforeLines[i] === afterLines[j]) {
      result.push({ tag: " ", text: beforeLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ tag: "-", text: beforeLines[i] });
      i++;
    } else {
      result.push({ tag: "+", text: afterLines[j] });
      j++;
    }
  }
  while (i < rows) result.push({ tag: "-", text: beforeLines[i++] });
  while (j < cols) result.push({ tag: "+", text: afterLines[j++] });
  return result;
}

export function diffLineStats(
  before: string,
  after: string
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diffLines(before, after)) {
    if (line.tag === "+") additions++;
    else if (line.tag === "-") deletions++;
  }
  return { additions, deletions };
}

/** Preview compacto no estilo unified, limitado a poucas linhas alteradas. */
export function buildPreview(before: string, after: string): string {
  const lines = diffLines(before, after);
  const changed = lines.filter((line) => line.tag !== " ");
  const shown = changed.slice(0, MAX_PREVIEW_LINES);
  const preview = shown.map((line) => `${line.tag}${line.text}`).join("\n");
  const omitted = changed.length - shown.length;
  return omitted > 0 ? `${preview}\n… (+${omitted} linha(s) alterada(s))` : preview;
}

export function buildComposerFiles(
  changes: ProposedFileChange[],
  befores: Map<string, string | undefined>,
  previousSelection?: Set<string>
): ComposerFileView[] {
  return changes.map((change) => {
    const before = befores.get(change.path) ?? "";
    const changeKind = inferChangeKind(befores.get(change.path), change.content);
    const stats = diffLineStats(before, change.content);
    return {
      path: change.path,
      changeKind,
      additions: stats.additions,
      deletions: stats.deletions,
      selected: previousSelection ? previousSelection.has(change.path) : true,
      preview: buildPreview(before, change.content)
    };
  });
}

/** Filtra as mudancas efetivas para aplicar, respeitando a selecao do usuario. */
export function selectedChanges(
  changes: ProposedFileChange[],
  selection: Set<string>
): ProposedFileChange[] {
  return changes.filter((change) => selection.has(change.path));
}

export function summarizeProposalView(view: ComposerProposalView): string {
  const created = view.files.filter((file) => file.changeKind === "create").length;
  const modified = view.files.filter((file) => file.changeKind === "modify").length;
  const deleted = view.files.filter((file) => file.changeKind === "delete").length;
  const parts: string[] = [];
  if (created) parts.push(`${created} novo(s)`);
  if (modified) parts.push(`${modified} alterado(s)`);
  if (deleted) parts.push(`${deleted} removido(s)`);
  return parts.join(" · ") || "nenhuma mudanca";
}

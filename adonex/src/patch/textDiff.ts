const MAX_DIFF_LINES = 2_000;

export interface DiffLine {
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

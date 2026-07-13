import type { GeneratedPatch } from "../llm/types";

export interface PatchSummary {
  fileCount: number;
  addedLines: number;
  removedLines: number;
  files: string[];
  spoken: string;
}

export function summarizePatchForSpeech(patch: GeneratedPatch): PatchSummary {
  const files = patch.changes.map((change) => change.path);
  let addedLines = 0;
  let removedLines = 0;
  for (const line of patch.diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) addedLines += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removedLines += 1;
  }
  const fileList = files.slice(0, 4).join(", ");
  const more = files.length > 4 ? ` e mais ${files.length - 4} arquivo(s)` : "";
  return {
    fileCount: files.length,
    addedLines,
    removedLines,
    files,
    spoken: [
      `Preparei uma alteracao em ${files.length} arquivo(s): ${fileList}${more}.`,
      `O patch adiciona aproximadamente ${addedLines} linha(s) e remove ${removedLines} linha(s).`,
      "Diga ou clique em aplicar para gravar, ou em cancelar para descartar."
    ].join(" ")
  };
}

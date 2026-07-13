import type { TaskRecord } from "../llm/types";

export function formatTaskResult(record: TaskRecord): string {
  const lines = [
    "## Resultado do AdoneX",
    "",
    `- Status: \`${record.status}\``,
    `- Tarefa: \`${record.id}\``,
    record.provider && record.model
      ? `- Provider/modelo: \`${record.provider} / ${record.model}\``
      : "",
    `- Custo cloud: $${record.cost.actualEstimatedCostUsd.toFixed(6)}`
  ].filter(Boolean);

  if (record.commandResults.length) {
    lines.push("", "### Validacoes", "");
    for (const result of record.commandResults) {
      lines.push(
        `- \`${result.command}\`: ${result.exitCode === 0 ? "aprovado" : `falhou (exit ${result.exitCode})`} em ${result.durationMs} ms`
      );
    }
  }

  const changedFiles = record.patchDiff
    ? [...record.patchDiff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(
        (match) => match[1]
      )
    : [];
  if (changedFiles.length) {
    lines.push("", "### Arquivos alterados", "");
    lines.push(...changedFiles.map((file) => `- \`${file}\``));
  }

  const summary = record.finalSummary ?? record.proposalSummary;
  if (summary) {
    lines.push("", "### Resumo", "", summary);
  }

  const failed = [...record.commandResults]
    .reverse()
    .find((result) => result.exitCode !== 0);
  if (failed && record.status !== "completed") {
    const output = [failed.stdout, failed.stderr]
      .filter(Boolean)
      .join("\n")
      .slice(-6_000);
    lines.push("", "### Erro capturado", "", "```text", output, "```");
  }

  if (record.failureDiagnosis && record.status !== "completed") {
    lines.push(
      "",
      "### Diagnostico",
      "",
      `- Categoria: \`${record.failureDiagnosis.category}\``,
      `- Causa provavel: ${record.failureDiagnosis.probableCause}`,
      `- Proxima acao: ${record.failureDiagnosis.nextAction}`
    );
  }

  if (record.commitSuggestion) {
    lines.push(
      "",
      "### Commit sugerido",
      "",
      `\`${record.commitSuggestion}\``
    );
  }
  return lines.join("\n");
}

import type { CommandResult } from "../llm/types";

/**
 * Ciclo editar -> validar -> corrigir do Composer. Helpers puros para manter a
 * decisao testavel fora do host VS Code: o painel executa os comandos e aplica
 * patches; aqui vive apenas a selecao de comandos e a preparacao da correcao.
 */

/** Limite de comandos de validacao por rodada, como no fluxo governado. */
export const MAX_VALIDATION_COMMANDS = 3;

/**
 * Seleciona comandos executaveis: remove pseudo-comandos ("Review ..."),
 * deduplica preservando ordem e limita ao teto governado.
 */
export function selectValidationCommands(
  commands: readonly string[],
  cap = MAX_VALIDATION_COMMANDS
): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const raw of commands) {
    const command = raw.trim();
    if (!command || command.startsWith("Review")) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    selected.push(command);
    if (selected.length >= cap) break;
  }
  return selected;
}

/**
 * Prepara a entrada de correcao a partir do comando que falhou. O corte evita
 * estourar o orcamento de contexto do modelo local com logs longos.
 */
export function buildRepairInput(failed: CommandResult, maxChars = 12_000): string {
  const output = [failed.stdout, failed.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const bounded =
    output.length > maxChars
      ? // Falhas de build/teste concentram a causa no final do log.
        `[...saida truncada...]\n${output.slice(-maxChars)}`
      : output;
  return [
    `Comando que falhou: ${failed.command}`,
    `Exit code: ${failed.exitCode}`,
    bounded || "(sem saida capturada)"
  ].join("\n");
}

/** Entrada minima de um diagnostic de erro capturado do host (VS Code). */
export interface DiagnosticSnapshotEntry {
  path: string;
  message: string;
  /** Linha 1-based, quando disponivel. */
  line?: number;
}

/**
 * Diff antes/depois de diagnostics de erro: devolve apenas os erros NOVOS
 * introduzidos pelo patch (presentes em `after`, ausentes em `before`), sem
 * duplicatas. Puro e testavel: o chamador (painel VS Code) coleta os snapshots
 * via `vscode.languages.getDiagnostics` nos arquivos alterados.
 */
export function diffDiagnosticsErrors(
  before: readonly DiagnosticSnapshotEntry[],
  after: readonly DiagnosticSnapshotEntry[]
): DiagnosticSnapshotEntry[] {
  const seen = new Set(before.map(diagnosticKey));
  const fresh: DiagnosticSnapshotEntry[] = [];
  for (const entry of after) {
    const key = diagnosticKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(entry);
  }
  return fresh;
}

/**
 * Formata erros novos de diagnostics como saida de comando que falhou, para
 * entrar no mesmo ciclo governado de correcao (`buildRepairInput`) usado por
 * testes/build. Mantido curto para caber no orcamento do modelo local.
 */
export function formatDiagnosticsAsFailure(
  errors: readonly DiagnosticSnapshotEntry[],
  cap = 10
): string {
  const lines = errors
    .slice(0, cap)
    .map((entry) => `${entry.path}${entry.line ? `:${entry.line}` : ""}: ${entry.message}`);
  const extra = errors.length > cap ? `\n... e mais ${errors.length - cap} erro(s).` : "";
  return `Diagnostics do editor reportaram ${errors.length} erro(s) novo(s) apos o patch:\n${lines.join("\n")}${extra}`;
}

function diagnosticKey(entry: DiagnosticSnapshotEntry): string {
  return `${entry.path}:${entry.line ?? 0}:${entry.message}`;
}

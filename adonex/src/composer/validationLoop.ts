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

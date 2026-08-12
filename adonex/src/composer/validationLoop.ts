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

/** Mesma heuristica de arquivo de teste usada em codeIntelligence.ts. */
const TEST_FILE_PATTERN =
  /(^|\/|\\)(__tests__|tests?|specs?)(\/|\\)|(\.|-)(test|spec)\.[a-z0-9]+$/i;

/** Achado deterministico de possivel enfraquecimento de teste. */
export interface TestWeakeningFinding {
  path: string;
  reason: string;
  severity: "high" | "medium";
}

const ASSERTION_PATTERN = /\b(expect|assert)\s*[.(]/g;
const TEST_CASE_PATTERN = /\b(it|test)\s*\(/g;
const SKIP_ONLY_PATTERN =
  /\b(it|test|describe)\s*\.\s*(skip|only|todo)\s*\(|\bxit\s*\(|\bxdescribe\s*\(|\bxtest\s*\(/g;

/**
 * Deteccao 100% deterministica (sem LLM) de correcoes de teste que "passam"
 * enfraquecendo a checagem em vez de corrigir a causa raiz: menos
 * assertions/casos de teste que antes, novos skip/only/xit, ou o arquivo de
 * teste inteiro sendo removido. Roda apenas em arquivos que batem no padrao
 * de teste do workspace; qualquer outro arquivo retorna lista vazia.
 */
export function detectTestWeakening(
  path: string,
  before: string | undefined,
  after: string | undefined
): TestWeakeningFinding[] {
  if (!TEST_FILE_PATTERN.test(path)) return [];
  if (before === undefined) return [];
  if (after === undefined || after.trim() === "") {
    return [{ path, reason: "arquivo de teste foi removido/esvaziado", severity: "high" }];
  }
  if (before === after) return [];
  const findings: TestWeakeningFinding[] = [];
  const beforeAssertions = countMatches(before, ASSERTION_PATTERN);
  const afterAssertions = countMatches(after, ASSERTION_PATTERN);
  if (afterAssertions < beforeAssertions) {
    findings.push({
      path,
      reason: `numero de assertions caiu de ${beforeAssertions} para ${afterAssertions}`,
      severity: "high"
    });
  }
  const beforeCases = countMatches(before, TEST_CASE_PATTERN);
  const afterCases = countMatches(after, TEST_CASE_PATTERN);
  if (afterCases < beforeCases) {
    findings.push({
      path,
      reason: `numero de casos de teste caiu de ${beforeCases} para ${afterCases}`,
      severity: "high"
    });
  }
  const beforeSkips = countMatches(before, SKIP_ONLY_PATTERN);
  const afterSkips = countMatches(after, SKIP_ONLY_PATTERN);
  if (afterSkips > beforeSkips) {
    findings.push({
      path,
      reason: `novo(s) skip/only/todo adicionado(s) ao teste (${beforeSkips} -> ${afterSkips})`,
      severity: "medium"
    });
  }
  return findings;
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return text.match(pattern)?.length ?? 0;
}

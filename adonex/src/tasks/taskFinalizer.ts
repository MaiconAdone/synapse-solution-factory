import type {
  CommandResult,
  FailureDiagnosis,
  ImplementationProposal,
  TaskPlan
} from "../llm/types";

export interface TaskFinalization {
  summary: string;
  commitSuggestion: string;
}

export function finalizeTask(
  plan: TaskPlan,
  proposal: ImplementationProposal | undefined,
  results: CommandResult[]
): TaskFinalization {
  const changed = [
    ...(proposal?.changes.map((change) => change.path) ?? []),
    ...(proposal?.operations?.map((operation) => operation.path) ?? [])
  ].filter((file, index, all) => all.indexOf(file) === index);
  const latestResults = latestByCommand(results);
  const passed =
    latestResults.length > 0 &&
    latestResults.every((result) => result.exitCode === 0);
  const validation = latestResults.length
    ? passed
      ? `Validacao aprovada: ${latestResults.map((result) => result.command).join(", ")}.`
      : `Validacao falhou: ${latestResults
          .filter((result) => result.exitCode !== 0)
          .map((result) => result.command)
          .join(", ")}.`
    : "Nenhum comando de teste foi executado.";
  const summary = [
    `Objetivo: ${plan.objective}`,
    changed.length
      ? `Arquivos alterados: ${changed.join(", ")}.`
      : "Nenhum arquivo foi alterado.",
    validation,
    `Modo: ${plan.mode}. Custo estimado: $${plan.estimatedCostUsd.toFixed(6)}.`
  ].join("\n");
  const scope = inferScope(changed);
  const verb = changed.length ? "implement" : "analyze";
  return {
    summary,
    commitSuggestion: `${verb}(${scope}): ${shortObjective(plan.objective)}`
  };
}

export function diagnoseCommandFailure(result: CommandResult): FailureDiagnosis {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const evidence = output.slice(-1200).trim() || `Command exited with ${result.exitCode}.`;
  if (result.timedOut || /timed?\s*out|timeout|request exceeded/i.test(output)) {
    return {
      command: result.command,
      category: "timeout",
      probableCause: "O comando excedeu o tempo limite ou ficou bloqueado aguardando recurso externo.",
      evidence,
      nextAction: "Reexecutar comando focado ou aumentar timeout somente se a tarefa exigir."
    };
  }
  if (/tsc|typescript|type error|TS\d{4}/i.test(output)) {
    return {
      command: result.command,
      category: "typecheck",
      probableCause: "Falha de typecheck ou contrato TypeScript incompatível com a alteração.",
      evidence,
      nextAction: "Corrigir tipos/imports no menor trecho afetado e repetir o comando de typecheck."
    };
  }
  if (/module not found|cannot find module|no module named|importerror|npm ERR!.*missing/i.test(output)) {
    return {
      command: result.command,
      category: "dependency",
      probableCause: "Dependência, import ou módulo esperado não está disponível no ambiente atual.",
      evidence,
      nextAction: "Verificar import/caminho antes de propor instalação; instalação exige aprovação."
    };
  }
  if (/assert|failed|FAIL|pytest|node --test|expect\(|AssertionError/i.test(output)) {
    return {
      command: result.command,
      category: "test_failure",
      probableCause: "Teste ou asserção falhou após a alteração.",
      evidence,
      nextAction: "Ler a asserção e ajustar somente o comportamento ou teste relacionado."
    };
  }
  if (/exception|traceback|error:|fatal|exit code/i.test(output)) {
    return {
      command: result.command,
      category: "runtime",
      probableCause: "Erro de runtime capturado durante validação.",
      evidence,
      nextAction: "Isolar o stack trace principal, corrigir a causa raiz e repetir validação focada."
    };
  }
  return {
    command: result.command,
    category: "unknown",
    probableCause: "A falha não foi classificada automaticamente.",
    evidence,
    nextAction: "Inspecionar a saída completa e propor uma correção incremental."
  };
}

function latestByCommand(results: CommandResult[]): CommandResult[] {
  const latest = new Map<string, CommandResult>();
  for (const result of results) latest.set(result.command, result);
  return [...latest.values()];
}

function inferScope(paths: string[]): string {
  const first = paths[0]?.replace(/\\/g, "/");
  if (!first) return "adonex";
  const segment = first.split("/")[0];
  return segment === "src" ? first.split("/")[1] ?? "core" : segment;
}

function shortObjective(objective: string): string {
  const normalized = objective.trim().replace(/[.!?]+$/, "");
  return normalized.length <= 68
    ? normalized.toLowerCase()
    : `${normalized.slice(0, 65).trimEnd()}...`.toLowerCase();
}

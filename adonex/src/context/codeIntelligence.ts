export type ProgrammingTaskKind =
  | "explanation"
  | "bugfix"
  | "refactor"
  | "feature"
  | "test"
  | "architecture"
  | "security"
  | "documentation"
  | "unknown";

export interface CodeSymbolSummary {
  path: string;
  imports: string[];
  exports: string[];
  declared: string[];
}

export interface CodeIntelligenceSummary {
  taskKind: ProgrammingTaskKind;
  riskLevel: "low" | "medium" | "high";
  modelProfile:
    | "fast"
    | "general"
    | "balanced"
    | "code_review"
    | "code_strong"
    | "planning_strong"
    | "reasoning_strong"
    | "code_critical";
  suggestedAgents: string[];
  relatedTests: string[];
  dependencyHints: CodeSymbolSummary[];
  notes: string[];
}

export interface CodeIntelligenceFile {
  path: string;
  content: string;
}

const TEST_PATTERN = /(^|\/|\\)(__tests__|tests?|specs?)(\/|\\)|(\.|-)(test|spec)\.[a-z0-9]+$/i;

export function buildCodeIntelligence(
  task: string,
  structure: string[],
  files: CodeIntelligenceFile[]
): CodeIntelligenceSummary {
  const taskKind = classifyProgrammingTask(task);
  const relatedTests = findRelatedTests(
    files.map((file) => file.path),
    structure
  );
  const dependencyHints = files
    .filter((file) => isCodePath(file.path))
    .slice(0, 8)
    .map((file) => summarizeCodeSymbols(file.path, file.content));
  const riskLevel = classifyRisk(task, taskKind, files, relatedTests);
  return {
    taskKind,
    riskLevel,
    modelProfile: modelProfileFor(task, taskKind, riskLevel),
    suggestedAgents: agentsFor(taskKind, riskLevel),
    relatedTests,
    dependencyHints,
    notes: notesFor(taskKind, riskLevel, relatedTests)
  };
}

export function classifyProgrammingTask(task: string): ProgrammingTaskKind {
  const text = stripAccents(task.toLowerCase());
  if (/\b(vulnerabilidade|security|seguranca|auth|permiss|token|secret|lgpd)\b/.test(text)) {
    return "security";
  }
  if (/\b(teste|test|pytest|unitario|unitario|validacao|coverage|regressao)\b/.test(text)) {
    return "test";
  }
  if (/\b(refator|refactor|renomeie|reorganize|simplifique|limpe)\b/.test(text)) {
    return "refactor";
  }
  if (/\b(corrij|conserte|bug|erro|falha|stack trace|exception|quebra)\b/.test(text)) {
    return "bugfix";
  }
  if (/\b(implemente|adicione|crie|endpoint|feature|funcionalidade|integre)\b/.test(text)) {
    return "feature";
  }
  if (/\b(arquitetura|design|roadmap|governanca|multiagente|pipeline|mcp|rag)\b/.test(text)) {
    return "architecture";
  }
  if (/\b(documente|docs|readme|runbook|comentario)\b/.test(text)) {
    return "documentation";
  }
  if (/\b(explique|explica|como funciona|resuma|o que e|o que eh)\b/.test(text)) {
    return "explanation";
  }
  return "unknown";
}

export function summarizeCodeSymbols(path: string, content: string): CodeSymbolSummary {
  const imports = [...content.matchAll(/^\s*import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gm)]
    .map((match) => match[1])
    .slice(0, 12);
  const pythonImports = path.endsWith(".py")
    ? [...content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)]
        .map((match) => match[1] || match[2])
        .slice(0, 12)
    : [];
  const exports = [
    ...content.matchAll(/^\s*export\s+(?:default\s+)?(?:class|function|const|interface|type|enum)\s+([A-Za-z0-9_]+)/gm)
  ].map((match) => match[1]);
  const declared = [
    ...content.matchAll(/^\s*(?:class|function|def)\s+([A-Za-z0-9_]+)/gm),
    ...content.matchAll(/^\s*(?:const|let)\s+([A-Za-z0-9_]+)\s*=/gm)
  ].map((match) => match[1]);
  return {
    path,
    imports: [...new Set([...imports, ...pythonImports])].slice(0, 12),
    exports: [...new Set(exports)].slice(0, 12),
    declared: [...new Set(declared)].slice(0, 12)
  };
}

export function findRelatedTests(selectedPaths: string[], structure: string[]): string[] {
  const allTests = structure.filter((item) => TEST_PATTERN.test(normalizePath(item)));
  const bases = selectedPaths
    .filter((item) => !TEST_PATTERN.test(normalizePath(item)))
    .map((item) => basenameWithoutExtension(item).toLowerCase())
    .filter(Boolean);
  const direct = allTests.filter((testPath) => {
    const testBase = basenameWithoutExtension(testPath).toLowerCase();
    return bases.some((base) => testBase.includes(base) || base.includes(testBase.replace(/\.(test|spec)$/i, "")));
  });
  return [...new Set([...direct, ...allTests.slice(0, 8)])].slice(0, 12);
}

function classifyRisk(
  task: string,
  taskKind: ProgrammingTaskKind,
  files: CodeIntelligenceFile[],
  relatedTests: string[]
): "low" | "medium" | "high" {
  const text = stripAccents(task.toLowerCase());
  if (
    taskKind === "security" ||
    /\b(auth|pagamento|billing|database|migration|producao|delete|permissao)\b/.test(text) ||
    files.length > 8
  ) {
    return "high";
  }
  if (["feature", "refactor", "architecture"].includes(taskKind) || relatedTests.length === 0) {
    return "medium";
  }
  return "low";
}

function modelProfileFor(
  task: string,
  taskKind: ProgrammingTaskKind,
  riskLevel: "low" | "medium" | "high"
): CodeIntelligenceSummary["modelProfile"] {
  const text = stripAccents(task.toLowerCase());
  if (/\b(32b|modelo grande|code critical|codigo critico|revisao final|antes de producao)\b/.test(text)) {
    return "code_critical";
  }
  if (/\b(causa raiz|root cause|raciocinio|validacao logica|decisao final)\b/.test(text)) {
    return "reasoning_strong";
  }
  if (taskKind === "explanation" || taskKind === "documentation") return "general";
  if (taskKind === "architecture") return "planning_strong";
  if (riskLevel === "high" || taskKind === "feature") return "code_strong";
  if (taskKind === "bugfix" || taskKind === "test" || taskKind === "security") return "code_review";
  return riskLevel === "low" ? "fast" : "balanced";
}

function agentsFor(
  taskKind: ProgrammingTaskKind,
  riskLevel: "low" | "medium" | "high"
): string[] {
  const agents = new Set(["backend-engineering", "testing-qa"]);
  if (["feature", "refactor", "architecture"].includes(taskKind)) agents.add("integration-automation");
  if (taskKind === "architecture") agents.add("orchestration-manager");
  if (taskKind === "security" || riskLevel === "high") agents.add("security-compliance");
  if (taskKind === "documentation") agents.add("documentation");
  if (riskLevel !== "low") agents.add("observability-ops");
  return [...agents];
}

function notesFor(
  taskKind: ProgrammingTaskKind,
  riskLevel: "low" | "medium" | "high",
  relatedTests: string[]
): string[] {
  const notes = [
    `Classificacao de programacao: ${taskKind}.`,
    `Risco estimado: ${riskLevel}.`
  ];
  if (!relatedTests.length) {
    notes.push("Nenhum teste relacionado foi encontrado no contexto selecionado; propor validacao minima antes de alterar codigo.");
  }
  if (riskLevel === "high") {
    notes.push("Exigir plano, menor patch possivel, rollback e validacao antes de considerar concluido.");
  }
  return notes;
}

function isCodePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|py|ps1|sql)$/i.test(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function basenameWithoutExtension(path: string): string {
  const base = normalizePath(path).split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "");
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

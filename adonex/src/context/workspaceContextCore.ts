import path from "node:path";
import { isIgnoredContextPath, isSensitivePath } from "../security/secretScanner";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".ps1",
  ".sql"
]);

const IMPORTANT_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "docker-compose.yml",
  "docker-compose.yaml",
  "pytest.ini",
  "agents.md",
  "claude.md",
  "readme.md",
  "tsconfig.json"
]);

/**
 * Decide se um arquivo entra no contexto/indice do AdoneX: extensao de texto
 * conhecida OU nome de manifesto importante, e nunca um caminho sensivel ou
 * ignorado. Compartilhado por WorkspaceContext.collect() (selecao de contexto
 * por tarefa) e pelo comando "AdoneX: Rebuild Semantic Index" (indexacao
 * completa do workspace) para que os dois nunca divirjam sobre o que conta.
 */
export function isIndexableWorkspaceFile(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  const isTextLike =
    IMPORTANT_FILES.has(path.basename(relativePath).toLowerCase()) ||
    TEXT_EXTENSIONS.has(extension);
  return isTextLike && !isSensitivePath(relativePath) && !isIgnoredContextPath(relativePath);
}

export interface SynapseDetection {
  detected: boolean;
  confidence: number;
  signals: string[];
}

export function detectSynapseProject(
  paths: string[],
  contents = ""
): SynapseDetection {
  const normalizedPaths = paths.map((item) =>
    item.replace(/\\/g, "/").toLowerCase()
  );
  const body = contents.toLowerCase();
  const signals: string[] = [];
  let score = 0;
  const pathSignal = (label: string, weight: number, matcher: RegExp): void => {
    if (normalizedPaths.some((item) => matcher.test(item))) {
      score += weight;
      signals.push(label);
    }
  };
  const contentSignal = (label: string, weight: number, terms: string[]): void => {
    if (terms.some((term) => body.includes(term))) {
      score += weight;
      signals.push(label);
    }
  };

  pathSignal("runtime-manifest", 4, /(^|\/)config\/runtime_manifest\.json$/);
  pathSignal("ruflo-runtime", 4, /(^|\/)scripts\/start_ruflo_swarm\.ps1$/);
  pathSignal("mcp-config", 3, /(^|\/)\.mcp\.json$/);
  pathSignal("Synapse-instructions", 3, /(^|\/)(claude|agents)\.md$/);
  pathSignal("agent-catalog", 2, /(^|\/)agents(\/|$)/);
  pathSignal("ai-governance", 2, /(^|\/)(guardrails|llm_ops|rag_pipelines)(\/|$)/);
  pathSignal("ml-platform", 2, /(^|\/)(ml_systems|notebooks|evals)(\/|$)/);
  pathSignal("full-stack", 1, /(^|\/)(backend|frontend)(\/|$)/);
  contentSignal("ruflo", 2, ["ruflo"]);
  contentSignal("agentic-mesh", 2, ["agentic mesh", "multi-agent", "multiagente"]);
  contentSignal("ollama-openai", 1, ["ollama", "openai"]);
  contentSignal("mlflow-jupyter", 1, ["mlflow", "jupyter"]);

  return {
    detected: score >= 8 && signals.some((signal) =>
      ["runtime-manifest", "ruflo-runtime", "mcp-config", "Synapse-instructions"].includes(signal)
    ),
    confidence: Math.min(1, Number((score / 16).toFixed(2))),
    signals: [...new Set(signals)]
  };
}

export function detectStack(paths: string[], contents = ""): string[] {
  const normalized = paths.map((item) => item.toLowerCase());
  const stack = new Set<string>();
  const has = (value: string): boolean =>
    normalized.some((item) => item.endsWith(value) || item.includes(`/${value}`));
  const body = contents.toLowerCase();

  if (has("requirements.txt") || has("pyproject.toml") || has(".py")) stack.add("Python");
  if (body.includes("fastapi") || has("main.py")) stack.add("FastAPI");
  if (has("package.json")) stack.add("Node.js");
  if (has("tsconfig.json")) stack.add("TypeScript");
  if (body.includes("react") || has(".tsx")) stack.add("React");
  if (body.includes("next")) stack.add("Next.js");
  if (has("docker-compose.yml") || has("docker-compose.yaml") || has("dockerfile")) stack.add("Docker");
  if (body.includes("postgres")) stack.add("Postgres");
  if (body.includes("mlflow")) stack.add("MLflow");
  if (has(".ipynb") || normalized.some((item) => item.includes("notebooks/"))) stack.add("Jupyter");
  if (body.includes("ollama")) stack.add("Ollama");
  if (body.includes("openai")) stack.add("OpenAI");
  return [...stack];
}

export function scorePathForTask(relativePath: string, task: string): number {
  return rankPathForTask(relativePath, task).score;
}

export function selectContextExcerpt(
  content: string,
  maxChars: number,
  forceExcerpt = false
): string {
  if (maxChars <= 0) return "";
  if (!forceExcerpt && content.length <= maxChars) return content;
  if (maxChars < 800) return content.slice(0, maxChars);
  const marker = "\n\n[...conteudo omitido para caber no contexto local...]\n\n";
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.65);
  const tail = available - head;
  return `${content.slice(0, head)}${marker}${content.slice(-tail)}`;
}

export function rankPathForTask(
  relativePath: string,
  task: string
): { score: number; reasons: string[] } {
  const pathText = relativePath.toLowerCase();
  const normalizedTask = task.toLowerCase();
  const taskTerms = normalizedTask
    .split(/[^a-z0-9_-]+/)
    .filter((term) => term.length >= 3);
  const reasons: string[] = [];
  let score = 0;
  if (IMPORTANT_FILES.has(path.basename(pathText))) {
    score += 5;
    reasons.push("project-manifest");
  }
  const projectExplanation =
    /\b(explique|explica|descreva|resuma|apresente|projeto)\b/.test(
      normalizedTask
    ) && /\bsynapse\b/.test(normalizedTask);
  const synapseModelInventory =
    /\bsynapse\b/.test(normalizedTask) &&
    /\b(modelo|modelos|model|models|ollama|llm|8b|3b|qwen|deepseek|embedding)\b/.test(
      normalizedTask
    );
  if (synapseModelInventory) {
    if (
      /^(config\/runtime_manifest\.json|config\/model_providers\.json|backend\/app\/core_config\.py|adonex\/package\.json|adonex\/src\/llm\/localmodels\.ts)$/.test(
        pathText
      )
    ) {
      score += 20;
      reasons.push("synapse-model-inventory");
    }
    if (/^docker-compose\.ya?ml$/.test(pathText)) {
      score += 8;
      reasons.push("synapse-model-env");
    }
  }
  if (projectExplanation) {
    if (
      /^(package\.json|readme\.md|agents\.md|claude\.md|docker-compose\.ya?ml|config\/runtime_manifest\.json|\.mcp\.json)$/.test(
        pathText
      )
    ) {
      score += 12;
      reasons.push("Synapse-explanation-contract");
    }
    if (/^(adonex|output|artifacts|frontend\/\.next)\//.test(pathText)) {
      score -= 8;
      reasons.push("Synapse-explanation-deprioritized");
    }
  }
  for (const term of taskTerms) {
    if (pathText.includes(term)) {
      score += 3;
      reasons.push(`task-term:${term}`);
    }
  }
  const domainAliases: Record<string, string[]> = {
    auth: ["auth", "jwt", "login", "security", "user"],
    frontend: ["frontend", "react", "tsx", "webview", "ui"],
    backend: ["backend", "api", "route", "service", "fastapi"],
    data: ["data", "dataset", "schema", "sql", "repository"],
    ml: ["ml", "model", "training", "feature", "mlflow"],
    test: ["test", "spec", "pytest", "vitest", "jest"],
    quality: ["error", "erro", "bug", "audit", "security", "health", "test", "log"],
    docs: ["readme", "docs", "architecture", "runbook"]
  };
  for (const [domain, aliases] of Object.entries(domainAliases)) {
    if (
      aliases.some((alias) => normalizedTask.includes(alias)) &&
      aliases.some((alias) => pathText.includes(alias))
    ) {
      score += 4;
      reasons.push(`domain:${domain}`);
    }
  }
  if (pathText.includes("test") && /test|fix|implement|review/.test(normalizedTask)) {
    score += 3;
    reasons.push("validation-companion");
  }
  if (/package\.json|pyproject\.toml|requirements\.txt|tsconfig\.json/.test(pathText)) {
    score += 2;
    reasons.push("build-contract");
  }
  const broadVerification =
    /\b(verifique|revise|analise|investigue|encontre|erros?|bugs?|falhas?|testes?)\b/.test(
      normalizedTask
    );
  if (broadVerification) {
    if (
      /(^|\/)(package\.json|pytest\.ini|docker-compose\.ya?ml|agents\.md|claude\.md)$/.test(
        pathText
      )
    ) {
      score += 8;
      reasons.push("project-health-contract");
    }
    if (
      /(^|\/)(tests?\/.*|scripts\/validate_.*|scripts\/test_.*)/.test(pathText)
    ) {
      score += 5;
      reasons.push("project-health-validation");
    }
    if (/^tests\/.*(?:contract|backend|frontend|integration)/.test(pathText)) {
      score += 5;
      reasons.push("project-health-contract-test");
    }
    if (/^output\/|^artifacts\/|^adonex\/test\//.test(pathText)) {
      score -= 4;
      reasons.push("project-health-deprioritized");
    }
  }
  const depth = pathText.split("/").length;
  score += Math.max(0, 3 - Math.max(0, depth - 2));
  return { score, reasons: [...new Set(reasons)] };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

// Fluxo identico ao da Vick (frontend/app/api/vick/chat/route.ts):
// briefing minimo -> gate do BusinessSolutionAnalyzer -> create_ai_project.ps1
// com o universo ML / IA / Chatbolt / ML + IA (Hibrido).

export type SolutionUniverse = "ml" | "ia" | "chatbolt" | "hybrid";

export interface SolutionBriefing {
  projectGoal: string;
  businessProblem: string;
  successMetric: string;
  availableSources: string;
  riskLevel: string;
  universe: SolutionUniverse | null;
}

export interface AnalyzerGate {
  status: string;
  requestedUniverse: string;
  recommendedUniverse: string;
  architectureDecision: string;
  solutionStack: string[];
}

export interface ProjectDiagnosticCheck {
  id: string;
  description: string;
  detail: string;
}

export interface ProjectDiagnostics {
  status: "passed" | "failed";
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
  failedChecks: ProjectDiagnosticCheck[];
}

export interface SolutionProjectResult {
  projectName: string;
  destination: string;
  selectedUniverse: string;
  universeSource: "user" | "analyzer" | "default";
  tipoProjeto: string;
  gate: AnalyzerGate | null;
  diagnostics: ProjectDiagnostics | null;
}

export function normalizeFactoryText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function isBriefingCancellation(prompt: string): boolean {
  return /\b(cancelar|cancele|cancela|desistir|desisto|parar|pare)\b/.test(
    normalizeFactoryText(prompt)
  );
}

// O universo declarado pelo usuario e vinculante, como na Vick. O analisador
// externo so decide quando o dialogo nao traz um universo reconhecivel.
export function detectUniverse(text: string): SolutionUniverse | null {
  const normalized = normalizeFactoryText(text);
  if (/\b(hibrido|hybrid)\b|\bml\s*\+\s*ia\b|\bia\s*\+\s*ml\b/.test(normalized)) {
    return "hybrid";
  }
  const wantsMl =
    /\b(ml|machine learning|aprendizado de maquina|deep learning|dl|rede neural|redes neurais|serie temporal|series temporais)\b/.test(
      normalized
    );
  const wantsIa =
    /\b(ia|ai|inteligencia artificial|rag|mcp|agente|agentes|multiagente|llm|llms)\b/.test(
      normalized
    );
  const wantsChatbolt = /\b(chatbot|chatbolt)\b/.test(normalized);
  if (wantsChatbolt && !wantsMl) return "chatbolt";
  if (wantsMl && wantsIa) return "hybrid";
  if (wantsMl) return "ml";
  if (wantsIa) return "ia";
  return null;
}

export function universeToTipoProjeto(universe: string | null): string {
  switch (universe) {
    case "ml":
      return "ML";
    case "ia":
      return "IA";
    case "chatbolt":
      return "Chatbolt";
    default:
      return "ML + IA (Hibrido)";
  }
}

export function buildSolutionBriefing(dialogText: string): SolutionBriefing {
  const sentences = dialogText
    .split(/\r?\n|(?<=[.!?;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const pick = (pattern: RegExp): string =>
    sentences.find((sentence) => pattern.test(normalizeFactoryText(sentence))) ?? "";
  const fallback = dialogText.trim().slice(0, 400);
  const projectGoal =
    pick(
      /\b(crie|criar|monte|montar|objetivo|quero|preciso|projeto|solucao|aplicacao)\b/
    ) ||
    sentences[0] ||
    fallback;
  return {
    projectGoal,
    businessProblem:
      pick(
        /\b(problema|dor|resolver|reduzir|aumentar|melhorar|otimizar|prever|previsao|predicao|detectar|classificar|automatizar|vendas|receita|churn|fraude|demanda|estoque|atendimento|suporte|lead|cliente|comprador|compradores)\b/
      ) || fallback,
    successMetric:
      pick(
        /\b(metrica|metricas|kpi|criterio de aceite|sucesso|acuracia|accuracy|precisao|recall|f1|mae|rmse|mape|latencia|roi|conversao|sla|tempo de resposta|satisfacao)\b/
      ) || fallback,
    availableSources:
      pick(
        /\b(dados|dataset|base|csv|excel|json|parquet|documento|documentos|fonte|fontes|pdf|planilha|crm|erp|banco de dados|api|logs|historico)\b/
      ) || fallback,
    riskLevel:
      pick(/\b(risco|lgpd|pii|sensivel|critico|compliance)\b/) || "medio",
    universe: detectUniverse(dialogText)
  };
}

export function slugifyProjectName(text: string): string {
  const slug = normalizeFactoryText(text)
    .replace(
      /\b(adonex|vick|vamos|criar|crie|um|uma|projeto|solucao|aplicacao|de|do|da|para|teste)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "projeto-adonex";
}

export async function hasSolutionFactory(workspaceRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(workspaceRoot, "scripts", "create_ai_project.ps1"));
    return true;
  } catch {
    return false;
  }
}

async function uniqueProjectName(
  projectsRoot: string,
  baseName: string
): Promise<string> {
  let candidate = baseName;
  let suffix = 2;
  for (;;) {
    try {
      await fs.access(path.join(projectsRoot, candidate));
      candidate = `${baseName}-${suffix}`;
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

// Gate do analisador de solucao: mesma chamada usada pela Vick, executado
// automaticamente e sem aprovacao humana (leitura/decisao arquitetural).
async function consultBusinessAnalyzer(input: {
  workspaceRoot: string;
  projectName: string;
  briefing: SolutionBriefing;
}): Promise<AnalyzerGate | null> {
  const analyzerScript = path.join(
    input.workspaceRoot,
    "scripts",
    "analyze_business_solution.py"
  );
  try {
    const { stdout } = await execFileAsync(
      "python",
      [
        analyzerScript,
        "--print-recommendation",
        "--project-name",
        input.projectName,
        "--universe",
        "ia",
        "--project-goal",
        input.briefing.projectGoal,
        "--business-problem",
        input.briefing.businessProblem,
        "--solution-focus",
        "ai-ml-agents",
        "--success-metric",
        input.briefing.successMetric,
        "--available-sources",
        input.briefing.availableSources,
        "--risk-level",
        input.briefing.riskLevel
      ],
      {
        cwd: input.workspaceRoot,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      }
    );
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    const parsed = JSON.parse(line) as {
      status?: string;
      requested_universe?: string;
      recommended_universe?: string;
      architecture_decision?: string;
      solution_stack?: string[];
    };
    return {
      status: parsed.status ?? "unknown",
      requestedUniverse: parsed.requested_universe ?? "ia",
      recommendedUniverse: parsed.recommended_universe ?? "hybrid",
      architectureDecision: parsed.architecture_decision ?? "",
      solutionStack: parsed.solution_stack ?? []
    };
  } catch {
    return null;
  }
}

async function appendGateToSharedMemory(input: {
  workspaceRoot: string;
  projectName: string;
  gate: AnalyzerGate | null;
}): Promise<void> {
  const memoryPath = path.join(
    input.workspaceRoot,
    ".adonex",
    "memory",
    "SHARED_DIALOG_MEMORY.md"
  );
  const line = input.gate
    ? `- [adonex] ${new Date().toISOString()} analyzer-gate projeto=${input.projectName} status=${input.gate.status} requisitado=${input.gate.requestedUniverse} recomendado=${input.gate.recommendedUniverse}\n`
    : `- [adonex] ${new Date().toISOString()} analyzer-gate projeto=${input.projectName} status=indisponivel fallback=hybrid\n`;
  try {
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.appendFile(memoryPath, line, "utf8");
  } catch {
    // Memoria e best-effort; nunca bloqueia a criacao.
  }
}

// Abre o projeto recem-criado e roda a analise independente dele
// (scripts/diagnose_project.ps1), em vez de so confiar no plano/briefing.
// O script sai com codigo 1 quando ha checks falhando (nao e falha de
// execucao) e sempre grava output/project_diagnostics.json no proprio
// projeto; por isso o exit code e ignorado aqui e o relatorio e lido do
// disco. Best-effort: nunca bloqueia a criacao do projeto.
async function diagnoseCreatedProject(input: {
  workspaceRoot: string;
  projectName: string;
  projectsRoot: string;
  destination: string;
}): Promise<ProjectDiagnostics | null> {
  const scriptPath = path.join(input.workspaceRoot, "scripts", "diagnose_project.ps1");
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-ProjectName",
        input.projectName,
        "-DestinoBase",
        input.projectsRoot
      ],
      {
        cwd: input.workspaceRoot,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      }
    );
  } catch {
    // Segue para ler o relatorio mesmo assim; se o script realmente nao
    // rodou, a leitura abaixo tambem falha e retorna null.
  }
  try {
    const reportPath = path.join(input.destination, "output", "project_diagnostics.json");
    const raw = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw) as {
      overall_status?: string;
      checks_total?: number;
      checks_passed?: number;
      checks_failed?: number;
      checks?: Array<{ id?: string; description?: string; passed?: boolean; detail?: string }>;
    };
    const failedChecks = (parsed.checks ?? [])
      .filter((check) => check.passed === false)
      .map((check) => ({
        id: check.id ?? "",
        description: check.description ?? "",
        detail: check.detail ?? ""
      }));
    return {
      status: parsed.overall_status === "passed" ? "passed" : "failed",
      checksTotal: parsed.checks_total ?? 0,
      checksPassed: parsed.checks_passed ?? 0,
      checksFailed: parsed.checks_failed ?? failedChecks.length,
      failedChecks
    };
  } catch {
    return null;
  }
}

export async function createSolutionProject(input: {
  workspaceRoot: string;
  briefing: SolutionBriefing;
  onProgress?: (message: string) => void;
}): Promise<SolutionProjectResult> {
  const { workspaceRoot, briefing } = input;
  const projectsRoot = path.resolve(workspaceRoot, "..");
  const scriptPath = path.join(workspaceRoot, "scripts", "create_ai_project.ps1");
  const baseName = slugifyProjectName(briefing.projectGoal);
  const projectName = await uniqueProjectName(projectsRoot, baseName);
  const projectGoal = `${briefing.projectGoal}\n\nUniverso atendido: ${briefing.universe ?? "nao informado"}`;

  let gate: AnalyzerGate | null = null;
  if (!briefing.universe) {
    input.onProgress?.("Consultando o BusinessSolutionAnalyzer para decidir o universo...");
    gate = await consultBusinessAnalyzer({ workspaceRoot, projectName, briefing });
    void appendGateToSharedMemory({ workspaceRoot, projectName, gate });
  }
  const selectedUniverse =
    briefing.universe ?? gate?.recommendedUniverse ?? "hybrid";
  const universeSource: SolutionProjectResult["universeSource"] = briefing.universe
    ? "user"
    : gate
      ? "analyzer"
      : "default";
  const tipoProjeto = universeToTipoProjeto(selectedUniverse);
  const destination = path.join(projectsRoot, projectName);

  input.onProgress?.(
    `Criando o projeto ${projectName} (${tipoProjeto}) pela Solution Factory do Synapse...`
  );
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-NomeProjeto",
        projectName,
        "-TipoProjeto",
        tipoProjeto,
        "-ProjectGoal",
        projectGoal,
        "-BusinessProblem",
        briefing.businessProblem,
        "-SolutionFocus",
        "ai-ml-agents",
        "-SuccessMetric",
        briefing.successMetric,
        "-AvailableSources",
        briefing.availableSources,
        "-RiskLevel",
        briefing.riskLevel,
        "-ActivateRuflo",
        "-LocalMemoryOnly"
      ],
      {
        cwd: workspaceRoot,
        timeout: 600_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      }
    );
    input.onProgress?.(
      `Abrindo ${projectName} para analise independente (diagnose_project.ps1)...`
    );
    const diagnostics = await diagnoseCreatedProject({
      workspaceRoot,
      projectName,
      projectsRoot,
      destination
    });
    return {
      projectName,
      destination,
      selectedUniverse,
      universeSource,
      tipoProjeto,
      gate,
      diagnostics
    };
  } catch (error) {
    // uniqueProjectName garantiu que o caminho nao existia antes: uma criacao
    // que falhou deixa apenas um diretorio parcial desta execucao — remova-o.
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function renderProjectCreated(result: SolutionProjectResult): string {
  const universeNote =
    result.universeSource === "user"
      ? `Universo informado no briefing mantido: \`${result.selectedUniverse}\` (${result.tipoProjeto}).`
      : result.universeSource === "analyzer"
        ? `O analisador inferiu o universo \`${result.selectedUniverse}\` (${result.tipoProjeto}) porque ele nao foi informado no briefing.`
        : `Universo padrao aplicado (${result.tipoProjeto}) porque o briefing nao informou o universo e o analisador nao respondeu.`;
  const diagnostics = result.diagnostics;
  const diagnosticsSection = diagnostics
    ? [
        "",
        "### Analise independente do projeto (`scripts/diagnose_project.ps1`)",
        `- Status: ${diagnostics.status === "passed" ? "todos os checks passaram" : "ha pendencias"} (${diagnostics.checksPassed}/${diagnostics.checksTotal} checks)`,
        ...(diagnostics.failedChecks.length
          ? [
              "- Pendencias encontradas:",
              ...diagnostics.failedChecks
                .slice(0, 8)
                .map((check) => `  - ${check.description} (${check.detail})`),
              diagnostics.failedChecks.length > 8
                ? `  - ... e mais ${diagnostics.failedChecks.length - 8} item(ns) no relatorio completo.`
                : ""
            ].filter(Boolean)
          : []),
        `- Relatorio completo: \`${result.destination}\\output\\project_diagnostics.md\``
      ]
    : [
        "",
        "_Nao foi possivel rodar a analise independente (`scripts/diagnose_project.ps1`) automaticamente para este projeto; rode manualmente se precisar validar a estrutura gerada._"
      ];
  return [
    `### Projeto criado com sucesso: ${result.projectName}`,
    "",
    `- Local: \`${result.destination}\``,
    `- ${universeNote}`,
    "- O briefing, a analise de solucao (`config/business_solution_analysis.json`) e os artefatos base do Synapse foram gerados.",
    ...diagnosticsSection,
    "",
    "Posso abrir, analisar ou evoluir o projeto por aqui quando quiser."
  ].join("\n");
}

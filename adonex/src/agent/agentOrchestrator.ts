import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { WorkspaceContext } from "../context/workspaceContext";
import { estimateCost, estimateTokenCost } from "../cost/costGuard";
import { synapseSystemContext } from "../synapse/synapseProfile";
import { buildRufloCouncilContext } from "../synapse/rufloCouncil";
import {
  generateWithTruncationBudget,
  OllamaClient,
  OllamaClientError,
  OllamaTruncatedResponseError,
  type OllamaClientEvent
} from "../llm/ollamaClient";
import { SynapseGatewayClient, SynapseGatewayClientError } from "../llm/synapseGatewayClient";
import { normalizeOllamaBaseUrl } from "../llm/ollamaEndpoint";
import {
  ADONEX_FAST_LOCAL_MODEL,
  ADONEX_GENERAL_LOCAL_MODEL,
  ADONEX_REASONING_LOCAL_MODEL,
  ADONEX_CODE_STRONG_LOCAL_MODEL,
  ADONEX_PLANNING_STRONG_LOCAL_MODEL,
  ADONEX_REASONING_STRONG_LOCAL_MODEL,
  ADONEX_CODE_CRITICAL_LOCAL_MODEL,
  type AdoneXAllowedLocalModel,
  type AdoneXLocalModelProfile,
  type LocalModelCallProfile,
  localProfileForName,
  normalizeLocalModel,
  outputBudgetForTask,
  selectLocalModelProfileForTask
} from "../llm/localModels";
import type {
  AgentAction,
  AgentMode,
  ImplementationProposal,
  LlmResponse,
  TaskPlan,
  WorkspaceSnapshot
} from "../llm/types";
import { actionPrompt, BASE_SYSTEM_PROMPT, STATIC_POLICY_PROMPT } from "./prompts";
import {
  buildProposalRepairPrompt,
  parseProposalText,
  PROPOSAL_JSON_SCHEMA
} from "./proposalParser";
import {
  buildRouterSystemPrompt,
  buildRouterUserPrompt,
  formatRouterGuidance,
  parseRouterDecision,
  ROUTER_JSON_SCHEMA,
  selectFocusPaths,
  shouldRunRouter,
  type RouterDecision
} from "./routerAgent";
import { compilePrompt } from "./promptCompiler";
import { specialistPrompts } from "./specialists";
import { classifyTaskComplexity } from "./taskRouter";
import { MemoryReader } from "../memory/memoryReader";
import { formatWorkspaceSnapshot } from "../context/contextFormatter";
import { selectFocusFilesByGraph } from "../context/focusSelector";
import { extractPrimaryTask } from "../chat/chatRouting";

export interface AgentExecution {
  plan: TaskPlan;
  response: LlmResponse;
  proposal?: ImplementationProposal;
  actualEstimatedCostUsd: number;
}

export class AgentOrchestrator {
  private readonly workspaceContext = new WorkspaceContext();
  private lastCodeModelProfile?: string;

  public constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  public async createPlan(
    task: string,
    action: AgentAction,
    mode: AgentMode
  ): Promise<{ plan: TaskPlan; snapshot: WorkspaceSnapshot }> {
    const objective = extractPrimaryTask(task);
    const localFirst = true;
    const snapshot = await this.workspaceContext.collect(
      objective,
      localFirst ? this.collectBudgetForAction(action) : 42_000
    );
    const configuration = vscode.workspace.getConfiguration("adonex");
    if (
      configuration.get<boolean>("memory.enabled", true) &&
      configuration.get<boolean>("memory.autoReadBeforeTask", true) &&
      (mode === "synapse" || snapshot.synapseDetected)
    ) {
      snapshot.sharedMemory = (await new MemoryReader(
        snapshot.root,
        configuration.get<number>("memory.maxFileChars", 20_000)
      ).readForAdoneXPrompt()).slice(0, localFirst ? 2_500 : 6_000);
    }
    const formattedContext = formatWorkspaceSnapshot(
      snapshot,
      localFirst ? this.workspaceBudgetForAction(action) : 48_000
    );
    const recommendation = classifyTaskComplexity(
      task,
      formattedContext,
      snapshot.sharedMemory ?? ""
    );
    const rufloCouncilEnabled =
      snapshot.synapseDetected &&
      configuration.get<boolean>("synapse.rufloCouncil.enabled", true);
    const outputTokens = [
      "implement",
      "synapse_agent",
      "synapse_mcp"
    ].includes(action)
      ? 1800
      : localFirst
          ? ["chat", "explain"].includes(action)
          ? 160
          : 512
        : 900;
    const estimate = estimateCost(
      `${task}\n${formattedContext}`,
      "local",
      outputTokens
    );
    const filesToRead = snapshot.relevantFiles.map((file) => file.path);
    const filesToChange =
      ["implement", "document", "synapse_agent", "synapse_mcp"].includes(action)
        ? this.inferChangeCandidates(task, filesToRead)
        : [];
    const commands = ["test", "implement", "synapse_agent", "synapse_mcp"].includes(action)
      ? this.inferTestCommands(snapshot.stack, snapshot.synapseDetected)
      : [];
    return {
      snapshot,
      plan: {
        id: randomUUID(),
        action,
        mode,
        objective,
        filesToRead,
        filesToChange,
        commands,
        risks: [
          ...(snapshot.codeIntelligence?.notes ?? []),
          "Generated changes require human review.",
          "Workspace context is intentionally truncated to control cost.",
          "Local model quality may be lower for complex cross-file changes.",
          recommendation === "codex-recommended"
            ? "Codex is recommended because this task crosses complex architecture or multiple systems."
            : `Recommended execution route: ${recommendation}.`,
          rufloCouncilEnabled
            ? "Ruflo selective council will run as compressed local role synthesis before Ollama generation; full 60-agent mode requires an explicit request."
            : "Ruflo council context is disabled for this task."
        ],
        estimatedInputTokens: estimate.inputTokens,
        estimatedOutputTokens: estimate.outputTokens,
        estimatedCostUsd: estimate.estimatedCostUsd,
        requiresApproval:
          ["implement", "test", "synapse_agent", "synapse_mcp"].includes(action),
        recommendedExecution: recommendation
      }
    };
  }

  public async executeApproved(
    task: string,
    action: AgentAction,
    mode: AgentMode,
    plan: TaskPlan,
    snapshot: WorkspaceSnapshot,
    options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
  ): Promise<AgentExecution> {
    const configuration = vscode.workspace.getConfiguration("adonex");
    // Modo pensativo: o pipeline narra os proprios passos (custo zero de modelo).
    const progress = (text: string): void => {
      try {
        options.onProgress?.(text);
      } catch {
        // narracao nunca pode quebrar a execucao
      }
    };
    this.lastCodeModelProfile = snapshot.codeIntelligence?.modelProfile;
    const fullRufloLocalQuestion = this.isSynapseSystemQuestion(task, action);
    const workspaceBudget = this.workspaceBudgetForAction(action);
    let workspaceText = formatWorkspaceSnapshot(snapshot, workspaceBudget);
    progress(
      `Contexto coletado: ${snapshot.relevantFiles.length} arquivo(s) relevante(s), ~${Math.round(workspaceText.length / 1000)}k chars`
    );
    const rufloLocalProfile = this.selectOllamaProfile(action, task, configuration);
    const rufloCouncil = buildRufloCouncilContext(snapshot.root, task, {
      enabled:
        snapshot.synapseDetected &&
        configuration.get<boolean>("synapse.rufloCouncil.enabled", true),
      maxAgents: this.rufloCouncilMaxAgents(
        task,
        action,
        fullRufloLocalQuestion,
        configuration
      ),
      llmConcurrency: fullRufloLocalQuestion
        ? 2
        : configuration.get<number>(
            "synapse.rufloCouncil.llmConcurrency",
            1
          ),
      maxChars: Math.min(
        configuration.get<number>("synapse.rufloCouncil.maxChars", 12_000),
        fullRufloLocalQuestion ? 12_000 : this.rufloCouncilBudgetForAction(action)
      ),
      action,
      localModelProfile: rufloLocalProfile.profile
    });
    const compiledPrompt = compilePrompt(task, action, mode, snapshot, {
      enabled: configuration.get<boolean>("promptEngineering.enabled", true)
    });
    if (
      this.isFastLocalChatAction(action)
    ) {
      const response = await this.generateFastLocalChat(
        task,
        action,
        configuration,
        snapshot,
        rufloCouncil.text,
        compiledPrompt,
        options.signal
      );
      return {
        plan,
        response,
        actualEstimatedCostUsd: 0
      };
    }
    // Foco por grafo de simbolos (deterministico, sem LLM): se a tarefa nomeia
    // um simbolo ou arquivo, escolhemos os arquivos-foco de graca e pulamos o
    // router 3B (economiza ~14-25s). So cai no router LLM quando isso e
    // inconclusivo. Best-effort: nunca bloqueia a edicao.
    let routerDecision: RouterDecision | undefined;
    if (
      requiresJsonProposal(action) &&
      configuration.get<boolean>("synapse.router.graphFocus", true)
    ) {
      const graphFocus = selectFocusFilesByGraph(
        task,
        snapshot.relevantFiles.map((file) => ({ path: file.path, content: file.content })),
        3
      );
      if (graphFocus.length) {
        routerDecision = { focusFiles: graphFocus, strategy: "", roles: [] };
        progress(`Foco por grafo de simbolos: ${graphFocus.join(", ")}`);
      }
    }
    // Fallback: sub-agent 3B roteia foco/estrategia quando o grafo nao decidiu.
    if (!routerDecision) {
      const routerWillRun =
        requiresJsonProposal(action) &&
        shouldRunRouter(
          configuration.get<boolean>("synapse.router.enabled", false),
          configuration.get<number>("synapse.router.autoThreshold", 3),
          snapshot.relevantFiles.length
        );
      if (routerWillRun) {
        progress("Router local (3B) escolhendo arquivos-foco e estrategia...");
      }
      routerDecision = await this.tryRouterAgent(
        task,
        action,
        snapshot,
        configuration,
        options.signal
      );
      if (routerDecision?.focusFiles.length) {
        progress(`Foco do router: ${routerDecision.focusFiles.join(", ")}`);
      }
    }
    const routerGuidance = routerDecision
      ? formatRouterGuidance(routerDecision)
      : "";
    // Estreita o contexto para os arquivos-foco: e aqui que o router paga o
    // proprio custo em CPU, cortando prompt-eval em tarefas multi-arquivo.
    if (
      routerDecision?.focusFiles.length &&
      configuration.get<boolean>("synapse.router.narrowContext", true)
    ) {
      const narrowed = this.narrowWorkspaceForFocus(
        snapshot,
        routerDecision.focusFiles,
        workspaceBudget
      );
      if (narrowed) {
        progress(
          `Contexto estreitado para os arquivos-foco (~${Math.round(narrowed.length / 1000)}k chars)`
        );
        workspaceText = narrowed;
      }
    }
    if (rufloCouncil.enabled && rufloCouncil.leadAgent) {
      progress(
        `Council Ruflo: lider ${rufloCouncil.leadAgent.id} + ${Math.max(0, rufloCouncil.activeAgents - 1)} revisor(es)`
      );
    }
    // Ordem pensada para o prefix cache do Ollama (CPU-only): blocos 100%
    // estaveis primeiro, semi-estaveis no meio e dinamicos por ultimo. Qualquer
    // byte alterado invalida o cache de tudo que vem depois dele.
    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      STATIC_POLICY_PROMPT,
      compiledPrompt.systemAddendum,
      synapseSystemContext(
        snapshot.synapseDetected,
        mode === "synapse",
        snapshot.synapseConfidence,
        snapshot.synapseSignals
      ),
      actionPrompt(action),
      rufloCouncil.text,
      routerGuidance,
      ...specialistPrompts(task)
    ]
      .filter(Boolean)
      .join("\n\n");
    const wantsProposal = requiresJsonProposal(action);
    const useStructuredOutput =
      wantsProposal && configuration.get<boolean>("ollama.structuredOutput", true);
    const request: {
      systemPrompt: string;
      userPrompt: string;
      workspaceContext: string;
      maxOutputTokens: number;
      jsonMode: boolean;
      jsonSchema?: object;
      seed?: number;
      signal?: AbortSignal;
    } = {
      systemPrompt,
      userPrompt: compiledPrompt.optimizedPrompt,
      workspaceContext: workspaceText,
      maxOutputTokens: compiledPrompt.maxOutputTokens ?? plan.estimatedOutputTokens,
      jsonMode: wantsProposal,
      jsonSchema: useStructuredOutput ? PROPOSAL_JSON_SCHEMA : undefined,
      seed: this.seedForAction(action),
      signal: options.signal
    };

    // Encapsula gateway-ou-ollama para poder reexecutar no reparo de JSON.
    const runModel = async (req: typeof request): Promise<LlmResponse> => {
      const gatewayResponse = await this.tryGenerateWithSynapseGateway(
        req,
        action,
        task,
        snapshot,
        configuration
      );
      if (gatewayResponse) return gatewayResponse;
      if (!configuration.get<boolean>("ollama.enabled", true)) {
        throw new Error(
          "Ollama is disabled in AdoneX settings. Enable it to use AdoneX."
        );
      }
      const baseModel = configuration.get<string>(
        "ollama.model",
        ADONEX_FAST_LOCAL_MODEL
      );
      const selectedProfile = this.selectOllamaProfile(action, task, configuration);
      const selectedModel = selectedProfile.model;
      const startedAt = Date.now();
      let lastReportedTokens = 0;
      const clientOptions = {
        baseUrl: normalizeOllamaBaseUrl(configuration.get<string>(
          "ollama.baseUrl",
          "http://127.0.0.1:11434"
        )),
        model: selectedModel,
        apiStyle: configuration.get<"chat" | "generate">(
          "ollama.apiStyle",
          "chat"
        ),
        timeoutMs: this.ollamaTimeoutMs(action, configuration),
        keepAlive: configuration.get<string>("ollama.keepAlive", "10m"),
        numCtx: this.ollamaContextWindow(action, configuration, selectedProfile),
        temperature: this.ollamaTemperature(configuration, selectedProfile),
        topP: selectedProfile.topP,
        repeatPenalty: selectedProfile.repeatPenalty,
        maxRetries: configuration.get<number>("ollama.maxRetries", 2),
        retryDelayMs: configuration.get<number>("ollama.retryDelayMs", 250),
        // Modo pensativo: eventos do cliente viram passos visiveis na UI.
        logger: (event: OllamaClientEvent): void => {
          if (event.type === "request") {
            progress(`Chamando ${event.model} (lendo o prompt)...`);
          } else if (event.type === "first_token") {
            progress(
              `Primeiro token apos ${Math.round((event.durationMs ?? 0) / 1000)}s; escrevendo a resposta...`
            );
          } else if (event.type === "retry") {
            progress("Falha transitoria do Ollama; tentando de novo...");
          }
        },
        onToken: (tokens: number): void => {
          if (tokens - lastReportedTokens >= 48) {
            lastReportedTokens = tokens;
            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            progress(`Gerando... ~${tokens} tokens (${elapsed}s)`);
          }
        }
      };
      const runOllama = async (maxOutputTokens: number): Promise<LlmResponse> => {
        try {
          return await new OllamaClient(clientOptions).generate({
            ...req,
            maxOutputTokens
          });
        } catch (error) {
          if (
            selectedModel !== baseModel &&
            error instanceof OllamaClientError &&
            !(error instanceof OllamaTruncatedResponseError) &&
            /not found|pull model|model/i.test(error.message)
          ) {
            return await new OllamaClient({
              ...clientOptions,
              model: baseModel
            }).generate(req);
          }
          throw error;
        }
      };
      // Se a proposta truncar por budget de saida, tenta UMA vez com
      // num_predict dobrado (ate o teto interno); truncando de novo, o erro
      // claro de budget excedido sobe para o painel.
      return generateWithTruncationBudget(
        runOllama,
        outputBudgetForTask(selectedProfile, action, task),
        {
          onRetry: (budget) =>
            progress(
              `Saida truncada pelo limite de tokens; tentando de novo com budget maior (~${budget} tokens)...`
            )
        }
      );
    };

    const response = await runModel(request);
    if (wantsProposal) progress("Interpretando a proposta JSON do modelo...");
    const proposal = wantsProposal
      ? await this.parseProposalWithRepair(response, request, runModel, progress)
      : undefined;
    if (proposal) {
      progress(
        `Proposta pronta: ${proposal.changes.length} arquivo(s), ${proposal.operations?.length ?? 0} operacao(oes)`
      );
    }

    return {
      plan,
      response,
      proposal,
      actualEstimatedCostUsd: estimateTokenCost(
        response.inputTokens || plan.estimatedInputTokens,
        response.outputTokens || plan.estimatedOutputTokens,
        "local"
      ).estimatedCostUsd
    };
  }

  /**
   * Interpreta a proposta com tolerancia a JSON quase valido. Se ainda assim
   * falhar, faz UMA regeneracao de reparo pedindo ao modelo somente o JSON
   * corrigido (com o schema forcado quando disponivel). Isso evita perder a
   * geracao inteira por prosa ou virgula sobrando de um modelo local.
   */
  private async parseProposalWithRepair(
    response: LlmResponse,
    request: {
      systemPrompt: string;
      userPrompt: string;
      workspaceContext: string;
      maxOutputTokens: number;
      jsonMode: boolean;
      jsonSchema?: object;
      seed?: number;
      signal?: AbortSignal;
    },
    runModel: (req: typeof request) => Promise<LlmResponse>,
    onProgress?: (text: string) => void
  ): Promise<ImplementationProposal> {
    try {
      return parseProposalText(response.text);
    } catch (firstError) {
      try {
        onProgress?.("JSON invalido; pedindo ao modelo a versao corrigida...");
        const repaired = await runModel({
          ...request,
          userPrompt: buildProposalRepairPrompt(response.text),
          jsonMode: true,
          jsonSchema: request.jsonSchema ?? PROPOSAL_JSON_SCHEMA,
          maxOutputTokens: Math.min(request.maxOutputTokens, 2_048)
        });
        return parseProposalText(repaired.text);
      } catch {
        throw new Error(
          `The model did not return a valid AdoneX patch proposal: ${
            firstError instanceof Error ? firstError.message : String(firstError)
          }`
        );
      }
    }
  }

  public async proposeFix(
    originalTask: string,
    testError: string,
    mode: AgentMode,
    plan: TaskPlan,
    snapshot: WorkspaceSnapshot,
    options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
  ): Promise<AgentExecution> {
    const fixPrompt = [
      `Original task:\n${originalTask}`,
      `Captured failing test output:\n${testError.slice(0, 40_000)}`,
      "Propose a correction and a validation command."
    ].join("\n\n");
    const estimate = estimateCost(
      `${fixPrompt}\n${this.workspaceContext.format(snapshot)}`,
      "local",
      Math.max(plan.estimatedOutputTokens, 1600)
    );
    return this.executeApproved(
      fixPrompt,
      "fix",
      mode,
      {
        ...plan,
        action: "fix",
        objective: `Fix failed validation for: ${originalTask}`,
        estimatedInputTokens: estimate.inputTokens,
        estimatedOutputTokens: estimate.outputTokens,
        estimatedCostUsd: estimate.estimatedCostUsd
      },
      snapshot,
      options
    );
  }

  public async refreshSnapshot(task: string): Promise<WorkspaceSnapshot> {
    return this.workspaceContext.collect(task);
  }

  private async tryGenerateWithSynapseGateway(
    request: {
      systemPrompt: string;
      userPrompt: string;
      workspaceContext: string;
      maxOutputTokens: number;
      jsonMode: boolean;
      jsonSchema?: object;
    },
    action: AgentAction,
    task: string,
    snapshot: WorkspaceSnapshot,
    configuration: vscode.WorkspaceConfiguration
  ): Promise<LlmResponse | undefined> {
    if (
      !snapshot.synapseDetected ||
      !configuration.get<boolean>("synapse.llmGateway.enabled", true)
    ) {
      return undefined;
    }
    const selectedProfile = this.selectOllamaProfile(action, task, configuration);
    const client = new SynapseGatewayClient({
      baseUrl: configuration.get<string>("synapse.llmGateway.baseUrl", "http://127.0.0.1:8000"),
      apiKey: (await this.extensionContext.secrets.get("adonex.synapse.gatewayApiKey")) ??
        configuration.get<string>("synapse.llmGateway.apiKey", ""),
      projectId: configuration.get<string>("synapse.llmGateway.projectId", "adonex"),
      agentId: "adonex",
      toolName: `adonex.${action}`,
      humanApproved: false,
      localModelProfile: selectedProfile.profile,
      temperature: selectedProfile.temperature,
      timeoutMs: this.ollamaTimeoutMs(action, configuration)
    });
    try {
      return await client.generate(request);
    } catch (error) {
      if (configuration.get<boolean>("synapse.llmGateway.requireGateway", false)) {
        throw error;
      }
      if (error instanceof SynapseGatewayClientError) {
        return undefined;
      }
      return undefined;
    }
  }

  private inferChangeCandidates(task: string, files: string[]): string[] {
    const scored = files.filter((file) =>
      task
        .toLowerCase()
        .split(/\W+/)
        .some((term) => term.length > 3 && file.toLowerCase().includes(term))
    );
    return (scored.length ? scored : files).slice(0, 8);
  }

  private inferTestCommands(stack: string[], synapseDetected: boolean): string[] {
    if (synapseDetected) return ["npm run check"];
    const commands: string[] = [];
    if (stack.includes("Node.js")) commands.push("npm test");
    if (stack.includes("TypeScript")) commands.push("npm run compile");
    if (stack.includes("Python")) commands.push("python -m pytest");
    return commands.length ? commands : ["Review the project test configuration"];
  }

  private selectOllamaProfile(
    action: AgentAction,
    task: string,
    configuration: vscode.WorkspaceConfiguration
  ): LocalModelCallProfile {
    const profileModel = this.localModelProfileFromCodeProfile(
      this.lastCodeModelProfile,
      configuration
    );
    if (profileModel) return profileModel;
    return this.applyConfiguredLocalModel(
      selectLocalModelProfileForTask(
      action,
      task,
      configuration.get<string>("ollama.model", ADONEX_FAST_LOCAL_MODEL),
      configuration.get<string>("ollama.modelReasoning")
      ),
      configuration
    );
  }

  private localModelProfileFromCodeProfile(
    profile: string | undefined,
    configuration: vscode.WorkspaceConfiguration
  ): LocalModelCallProfile | undefined {
    const selected = localProfileForName(
      profile,
      configuration.get<string>("ollama.model", ADONEX_FAST_LOCAL_MODEL),
      configuration.get<string>("ollama.modelReasoning")
    );
    return selected
      ? this.applyConfiguredLocalModel(selected, configuration)
      : undefined;
  }

  private applyConfiguredLocalModel(
    profile: LocalModelCallProfile,
    configuration: vscode.WorkspaceConfiguration
  ): LocalModelCallProfile {
    const keyByProfile: Partial<
      Record<AdoneXLocalModelProfile, [string, AdoneXAllowedLocalModel]>
    > = {
      fast: ["ollama.model", ADONEX_FAST_LOCAL_MODEL],
      general: ["ollama.modelGeneral", ADONEX_GENERAL_LOCAL_MODEL],
      balanced: ["ollama.modelReasoning", ADONEX_REASONING_LOCAL_MODEL],
      code_review: ["ollama.modelCodeReview", ADONEX_REASONING_LOCAL_MODEL],
      code_strong: ["ollama.modelCodeStrong", ADONEX_CODE_STRONG_LOCAL_MODEL],
      planning_strong: ["ollama.modelPlanningStrong", ADONEX_PLANNING_STRONG_LOCAL_MODEL],
      reasoning_strong: ["ollama.modelReasoningStrong", ADONEX_REASONING_STRONG_LOCAL_MODEL],
      code_critical: ["ollama.modelCodeCritical", ADONEX_CODE_CRITICAL_LOCAL_MODEL]
    };
    const entry = keyByProfile[profile.profile];
    if (!entry) return profile;
    const [key, fallback] = entry;
    return {
      ...profile,
      model: normalizeLocalModel(configuration.get<string>(key), fallback)
    };
  }

  private async generateFastLocalChat(
    task: string,
    action: AgentAction,
    configuration: vscode.WorkspaceConfiguration,
    snapshot: WorkspaceSnapshot,
    councilText: string,
    compiledPrompt: ReturnType<typeof compilePrompt>,
    signal?: AbortSignal
  ): Promise<LlmResponse> {
    if (!configuration.get<boolean>("ollama.enabled", true)) {
      throw new Error(
        "Ollama is disabled in AdoneX settings. Enable it or choose a cloud mode."
      );
    }
    const fastModel = normalizeLocalModel(
      configuration.get<string>("ollama.model", ADONEX_FAST_LOCAL_MODEL),
      ADONEX_FAST_LOCAL_MODEL
    );
    const clientOptions = {
      baseUrl: normalizeOllamaBaseUrl(configuration.get<string>(
        "ollama.baseUrl",
        "http://127.0.0.1:11434"
      )),
      model: fastModel,
      apiStyle: configuration.get<"chat" | "generate">("ollama.apiStyle", "chat"),
      timeoutMs: this.ollamaTimeoutMs(action, configuration),
      keepAlive: configuration.get<string>("ollama.keepAlive", "10m"),
      numCtx: Math.min(configuration.get<number>("ollama.numCtx", 4096), 2048),
      temperature: configuration.get<number>("ollama.temperature", 0),
      topP: configuration.get<number>("ollama.topP", 0.9),
      repeatPenalty: Math.max(configuration.get<number>("ollama.repeatPenalty", 1.08), 1.12)
    };
    const client = new OllamaClient(clientOptions);
    const workspaceSummary = [
      `Synapse detectado: ${snapshot.synapseDetected ? "sim" : "nao"}`,
      `Confianca Synapse: ${Math.round(snapshot.synapseConfidence * 100)}%`,
      `Stack: ${snapshot.stack.slice(0, 10).join(", ") || "nao inferida"}`,
      `Sinais: ${snapshot.synapseSignals.slice(0, 12).join(", ") || "nenhum"}`,
      `Arquivos selecionados: ${snapshot.relevantFiles
        .slice(0, 5)
        .map((file) => file.path)
        .join(", ") || "nenhum"}`,
      this.buildSynapseModelInventory(snapshot.root, configuration),
      councilText.split("\n").slice(0, 10).join("\n")
    ].join("\n");
    const synapseSystemQuestion = this.isSynapseSystemQuestion(task, action);
    const synapseModelQuestion = this.isSynapseModelQuestion(task);
    if (synapseSystemQuestion) {
      const councilDraft = await client.generate({
        systemPrompt: [
          "Voce e o analisador local 3B do AdoneX para perguntas, tarefas e comandos sobre o sistema Synapse.",
          "O nome canonico do produto e Synapse; nunca substitua por Jerico, Jericó ou outro nome.",
          "Antes de responder, classifique internamente: intencao do usuario, tipo de tarefa, comandos pedidos, arquivos citados e lacunas de contexto.",
          "Use o conselho Ruflo completo como contexto consultivo.",
          "Se o contexto nao sustentar uma afirmacao, diga que nao ha evidencia no contexto fornecido e proponha a verificacao minima.",
          "Produza a resposta final diretamente com o modelo rapido; Nao use atalhos deterministicos, resposta pronta ou texto fixo.",
          STATIC_POLICY_PROMPT,
          synapseModelQuestion
            ? "Para pergunta sobre modelos, preserve nomes exatos, perfis e usos do inventario fornecido."
            : "",
          "Cloud proibida; nao recomende LLM externo."
        ].filter(Boolean).join("\n"),
        userPrompt: compiledPrompt.optimizedPrompt,
        workspaceContext: [
          workspaceSummary,
          "",
          "Ruflo 60-agent council context:",
          councilText
        ].join("\n"),
        maxOutputTokens: 220,
        jsonMode: false,
        signal
      });
      return councilDraft;
    }
    return client.generate({
      systemPrompt: [
        "Voce e o AdoneX no Synapse Mode.",
        "O nome canonico do produto e Synapse; nunca substitua por Jerico, Jericó ou outro nome.",
        "Responda sempre em portugues Brasil, direto e tecnico.",
        "Use Ollama local com custo cloud zero.",
        "Analise sempre a pergunta, a tarefa, comandos solicitados, arquivos citados e lacunas antes de responder.",
        "Nao complete lacunas com conhecimento plausivel: quando faltar evidencia, declare a lacuna e proponha a menor verificacao.",
        "Nao use resposta deterministica pronta; adapte a resposta ao pedido atual e ao contexto do workspace.",
        "Se o usuario apontar erro de nomenclatura ou resposta generica, explique a causa e a correcao concreta em vez de listar melhorias genericas.",
        "Para criacao ou implementacao de projetos Synapse pelo chat, siga config/llm_solution_factory_policy.json.",
        "Antes de decidir arquitetura, consulte ou recomende o BusinessSolutionAnalyzer e config/business_solution_analysis.json.",
        "Se faltar objetivo, problema de negocio, universo, metrica de sucesso, dados/fontes ou risco, pergunte ao usuario antes de implementar.",
        "A caixa de dialogo e o caminho principal; tasks VS Code sao atalhos opcionais.",
        STATIC_POLICY_PROMPT,
        compiledPrompt.systemAddendum,
        "Nao diga que nao consultou o Ollama se esta resposta foi gerada por esta chamada.",
        "Se precisar de validacao real, recomende npm run check."
      ].join("\n"),
      userPrompt: compiledPrompt.optimizedPrompt,
      workspaceContext: workspaceSummary,
      maxOutputTokens: compiledPrompt.maxOutputTokens ?? (action === "chat" ? 160 : 220),
      jsonMode: false,
      signal
    });
  }

  private isSynapseSystemQuestion(task: string, action: AgentAction): boolean {
    if (!["chat", "explain", "synapse_explain"].includes(action)) return false;
    const normalized = task
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return (
      /\bsynapse\b/.test(normalized) &&
      /\b(o que|explique|explica|como funciona|resuma|status|pergunta|duvida|referente|sobre|sistema)\b/.test(
        normalized
      )
    );
  }

  private isSynapseModelQuestion(task: string): boolean {
    const normalized = task
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return (
      /\bsynapse\b/.test(normalized) &&
      /\b(modelo|modelos|model|models|ollama|llm|qwen|deepseek|embedding|3b|8b)\b/.test(
        normalized
      )
    );
  }

  private buildSynapseModelInventory(
    workspaceRoot: string,
    configuration: vscode.WorkspaceConfiguration
  ): string {
    const runtime = this.readJson(path.join(workspaceRoot, "config", "runtime_manifest.json"));
    const providers = this.readJson(path.join(workspaceRoot, "config", "model_providers.json"));
    const local = (runtime?.local_llm ?? providers?.providers?.ollama ?? {}) as Record<string, any>;
    const profiles = (local.model_profiles ?? {}) as Record<string, any>;
    const allowed = (local.allowed_local_models ?? local.allowed_models ?? []) as unknown;
    return [
      "Inventario local de modelos Synapse/AdoneX:",
      `- Provider local: ${local.provider ?? "ollama"}`,
      `- Base Ollama: ${configuration.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")}`,
      `- fast/default: ${profiles.fast ?? local.default_model ?? configuration.get<string>("ollama.model", ADONEX_FAST_LOCAL_MODEL)}`,
      `- general/8B: ${profiles.general ?? local.general_model ?? ADONEX_GENERAL_LOCAL_MODEL}`,
      `- balanced: ${profiles.balanced ?? local.balanced_model ?? "deepseek-coder-v2:lite"}`,
      `- code_review: ${profiles.code_review ?? local.code_review_model ?? "deepseek-coder-v2:lite"}`,
      `- code_strong: ${profiles.code_strong ?? local.code_strong_model ?? "qwen2.5-coder:14b"}`,
      `- planning_strong: ${profiles.planning_strong ?? local.planning_strong_model ?? "qwen3:14b"}`,
      `- reasoning_strong: ${profiles.reasoning_strong ?? local.reasoning_strong_model ?? "deepseek-r1:14b"}`,
      `- code_critical/large: ${profiles.code_critical ?? local.code_critical_model ?? local.large_model ?? "qwen2.5-coder:32b"}`,
      `- embeddings: ${profiles.embeddings ?? local.embedding_model ?? "nomic-embed-text:latest"}`,
      `- Modelos locais permitidos: ${Array.isArray(allowed) && allowed.length ? allowed.join(", ") : "qwen2.5-coder:3b, qwen3:8b, deepseek-coder-v2:lite, qwen2.5-coder:14b, qwen3:14b, deepseek-r1:14b, qwen2.5-coder:32b, nomic-embed-text:latest"}`,
      "- Perfis de chamada recomendados:",
      "- fast qwen2.5-coder:3b: triagem/resumo/classificacao; ctx 2048; temp 0.15.",
      "- fast qwen2.5-coder:3b: caminho diario para perguntas, explicacoes, triagem e respostas finais; ctx 2048; temp 0.15.",
      "- general qwen3:8b: explicacoes mais longas somente por pedido explicito; cold start pode ser lento.",
      "- balanced/code_review deepseek-coder-v2:lite: debugging, review, reparo e seguranca somente quando explicitamente solicitado.",
      "- code_strong qwen2.5-coder:14b: implementacao, scripts, endpoints e integracoes somente sob demanda.",
      "- planning_strong qwen3:14b: arquitetura, governanca e roadmap somente sob demanda.",
      "- reasoning_strong deepseek-r1:14b: causa raiz e decisao tecnica dificil somente sob demanda.",
      "- code_critical qwen2.5-coder:32b: codigo critico/revisao final por pedido explicito; ctx 8192; temp 0.",
      "- embeddings nomic-embed-text:latest: memoria/RAG/busca semantica; nao usar para chat.",
      "- Limite de provedor: AdoneX usa somente Ollama; tarefas destinadas ao Codex ou Claude Code devem gerar handoff, nunca chamada cloud direta."
    ].join("\n");
  }

  private readJson(filePath: string): Record<string, any> | undefined {
    try {
      if (!fs.existsSync(filePath)) return undefined;
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
    } catch {
      return undefined;
    }
  }

  private ollamaTimeoutMs(
    action: AgentAction,
    configuration: vscode.WorkspaceConfiguration
  ): number {
    const configured = configuration.get<number>("ollama.timeoutSeconds", 120);
    const minimum = ["synapse_explain"].includes(action)
      ? 300
      : ["chat", "explain", "commit"].includes(action)
        ? 120
        : 60;
    return Math.max(minimum, configured) * 1000;
  }

  private isFastLocalChatAction(action: AgentAction): boolean {
    return ["chat", "explain", "synapse_explain"].includes(action);
  }

  private ollamaContextWindow(
    action: AgentAction,
    configuration: vscode.WorkspaceConfiguration,
    profile: LocalModelCallProfile
  ): number {
    const configured = configuration.get<number>("ollama.numCtx", 4096);
    const requested = configured === 4096 ? profile.numCtx : configured;
    if (["chat", "explain", "synapse_explain", "commit"].includes(action)) {
      return Math.min(requested, Math.max(profile.numCtx, 2048));
    }
    return requested;
  }

  private ollamaTemperature(
    configuration: vscode.WorkspaceConfiguration,
    profile: LocalModelCallProfile
  ): number {
    const configured = configuration.get<number>("ollama.temperature", 0);
    return configured === 0 ? profile.temperature : configured;
  }

  private seedForAction(action: AgentAction): number | undefined {
    return requiresJsonProposal(action) || ["test", "commit"].includes(action)
      ? 42
      : undefined;
  }

  private collectBudgetForAction(action: AgentAction): number {
    return ["chat", "explain", "synapse_explain", "commit"].includes(action)
      ? 2_500
      : 8_000;
  }

  private workspaceBudgetForAction(action: AgentAction): number {
    if (["chat", "explain", "synapse_explain", "commit"].includes(action)) {
      return 4_000;
    }
    // Em CPU o prompt-eval (~27 tok/s medido) domina a latencia de uma edicao;
    // 16k chars de contexto custavam ~175s so para "ler". Configuravel para
    // maquinas rapidas subirem; default enxuto para o caso comum.
    const configured = vscode.workspace
      .getConfiguration("adonex")
      .get<number>("context.codeEditMaxChars", 10_000);
    return Math.max(2_000, Math.min(configured, 48_000));
  }

  /**
   * Sub-agent de roteamento: uma chamada rapida a um modelo pequeno que escolhe
   * arquivos-foco, estrategia e papeis antes da geracao forte. Sequencial (nao
   * paralelo — em CPU sem GPU concorrencia so disputa o mesmo nucleo), opt-in via
   * `synapse.router.enabled`, e best-effort: qualquer falha retorna "" e o fluxo
   * segue exatamente como sem router.
   */
  private async tryRouterAgent(
    task: string,
    action: AgentAction,
    snapshot: WorkspaceSnapshot,
    configuration: vscode.WorkspaceConfiguration,
    signal?: AbortSignal
  ): Promise<RouterDecision | undefined> {
    if (!requiresJsonProposal(action)) return undefined;
    if (!configuration.get<boolean>("ollama.enabled", true)) return undefined;
    const shouldRun = shouldRunRouter(
      configuration.get<boolean>("synapse.router.enabled", false),
      configuration.get<number>("synapse.router.autoThreshold", 3),
      snapshot.relevantFiles.length
    );
    if (!shouldRun) return undefined;
    const candidateFiles = snapshot.relevantFiles.map((file) => file.path);
    try {
      const client = new OllamaClient({
        baseUrl: normalizeOllamaBaseUrl(
          configuration.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")
        ),
        model: normalizeLocalModel(
          configuration.get<string>("synapse.router.model"),
          ADONEX_FAST_LOCAL_MODEL
        ),
        apiStyle: configuration.get<"chat" | "generate">("ollama.apiStyle", "chat"),
        timeoutMs:
          Math.max(configuration.get<number>("synapse.router.timeoutSeconds", 20), 5) *
          1_000,
        keepAlive: configuration.get<string>("ollama.keepAlive", "10m"),
        numCtx: 2_048,
        temperature: 0,
        maxRetries: 0
      });
      const response = await client.generate({
        systemPrompt: buildRouterSystemPrompt(),
        userPrompt: buildRouterUserPrompt(task, candidateFiles),
        maxOutputTokens: configuration.get<number>("synapse.router.maxTokens", 200),
        jsonMode: true,
        jsonSchema: ROUTER_JSON_SCHEMA,
        signal
      });
      return parseRouterDecision(response.text, candidateFiles);
    } catch {
      return undefined;
    }
  }

  /**
   * Estreita o contexto de workspace para os focus_files do router. Ataca o
   * gargalo real em CPU (prompt-eval): em tarefas multi-arquivo, enviar so os
   * arquivos-foco corta milhares de tokens de leitura. Retorna undefined quando
   * nao ha ganho (nenhum match ou o foco cobre todos os arquivos), preservando o
   * contexto completo.
   */
  private narrowWorkspaceForFocus(
    snapshot: WorkspaceSnapshot,
    focusFiles: string[],
    budget: number
  ): string | undefined {
    const focusPaths = selectFocusPaths(
      snapshot.relevantFiles.map((file) => file.path),
      focusFiles
    );
    if (!focusPaths.length || focusPaths.length >= snapshot.relevantFiles.length) {
      return undefined;
    }
    const focusSet = new Set(focusPaths);
    const narrowed: WorkspaceSnapshot = {
      ...snapshot,
      relevantFiles: snapshot.relevantFiles.filter((file) => focusSet.has(file.path))
    };
    return formatWorkspaceSnapshot(narrowed, budget);
  }

  private rufloCouncilBudgetForAction(action: AgentAction): number {
    // Em CPU (~5,5 tok/s) o texto do council entra em TODA geracao e concorre com
    // o prefix cache. Para edicao de codigo ele deve condicionar, nao dominar:
    // council enxuto = menos prompt-eval e sinal do papel certo menos diluido.
    if (["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action)) {
      return 2_500;
    }
    if (["synapse_architecture", "synapse_pipeline", "synapse_roadmap"].includes(action)) {
      return 8_000;
    }
    if (["chat", "explain", "synapse_explain", "commit"].includes(action)) {
      return 1_500;
    }
    return 4_000;
  }

  private rufloCouncilMaxAgents(
    task: string,
    action: AgentAction,
    fullRufloLocalQuestion: boolean,
    configuration: vscode.WorkspaceConfiguration
  ): number {
    const configured = configuration.get<number>("synapse.rufloCouncil.maxAgents", 3);
    const normalized = task
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (/\b(60 agentes|todos os agentes|full council|conselho completo)\b/.test(normalized)) {
      return Math.min(60, Math.max(configured, 60));
    }
    if (["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action)) {
      // Edicao de codigo: subconjunto enxuto (lider + 1-2 revisores) para latencia.
      return Math.max(1, Math.min(configured, 3));
    }
    if (["synapse_architecture", "synapse_pipeline", "synapse_roadmap"].includes(action)) {
      return Math.min(15, Math.max(configured, 10));
    }
    if (fullRufloLocalQuestion) {
      return Math.min(8, Math.max(configured, 5));
    }
    return Math.min(8, Math.max(configured, 3));
  }
}

function requiresJsonProposal(action: AgentAction): boolean {
  return ["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action);
}

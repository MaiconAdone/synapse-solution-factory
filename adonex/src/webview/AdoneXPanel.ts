import * as vscode from "vscode";
import { AgentOrchestrator } from "../agent/agentOrchestrator";
import { ComposerSession } from "../composer/composerSession";
import {
  buildRepairInput,
  diffDiagnosticsErrors,
  formatDiagnosticsAsFailure,
  selectValidationCommands,
  type DiagnosticSnapshotEntry
} from "../composer/validationLoop";
import { CommandRunner } from "../execution/commandRunner";
import type {
  AgentAction,
  AgentMode,
  CommandResult,
  GeneratedPatch,
  ImplementationProposal,
  LlmResponse,
  TaskRecord,
  TaskPlan,
  WorkspaceSnapshot
} from "../llm/types";
import { PatchEngine } from "../patch/patchEngine";
import { summarizePatchForSpeech } from "../patch/patchSummary";
import { requestApproval } from "../security/approvalGate";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { inferUpdateFromText } from "../memory/memorySummarizer";
import { parseMentions } from "../context/mentionResolver";
import { SYNAPSE_SPECIALIST_SYSTEM, buildChildProjectChatSystemPrompt } from "../synapse/synapseKnowledge";
import { detectProjectIdentity } from "../context/projectIdentity";
import { MemoryWriter } from "../memory/memoryWriter";
import type { TaskLog as MemoryTaskLog } from "../memory/types";
import { diagnoseCommandFailure, finalizeTask } from "../tasks/taskFinalizer";
import {
  activateTaskPhase,
  completeTaskLifecycle,
  createTaskLifecycle,
  updateTaskLifecycle
} from "../tasks/taskLifecycle";
import { TaskStore } from "../tasks/taskStore";
import { normalizeConfiguredAgentMode, resolveAgentMode } from "../chat/agentModeSelector";
import {
  checkSolutionFactoryDialog,
  renderSolutionFactoryMissingInfo,
  resolveChatPrompt,
  routeChatCommand,
  shouldUseComposer
} from "../chat/chatRouting";
import {
  askDatabaseSpecialist,
  hasDatabaseSpecialist,
  looksLikeDatabaseQuestion,
  renderSpecialistProposal
} from "../chat/databaseSpecialist";
import { createLocalChatFailureResponse } from "../chat/fallbackResponse";
import {
  buildLocalChatContext,
  localChatOutputBudget,
  localChatSystemPrompt,
  shouldUseLeanLocalChat
} from "../chat/localChatPolicy";
import { evidenceFromSnapshot, guardAgainstLocalHallucinations } from "../chat/hallucinationGuard";
import { sanitizeAdoneXResponse } from "../chat/responseSanitizer";
import { formatWorkspaceSnapshot } from "../context/contextFormatter";
import { WorkspaceContext } from "../context/workspaceContext";
import { VickVoiceSession, type VickVoiceState } from "../voice/vickVoice";
import { VickLocalServiceClient } from "../voice/vickLocalService";
import { OllamaClient } from "../llm/ollamaClient";
import { normalizeOllamaBaseUrl } from "../llm/ollamaEndpoint";
import { ADONEX_FAST_LOCAL_MODEL, selectLocalModelProfileForTask } from "../llm/localModels";
import { MEMORY_PATHS } from "../memory/memoryFiles";

interface PendingTask {
  task: string;
  action: AgentAction;
  mode: AgentMode;
  plan: TaskPlan;
  snapshot: WorkspaceSnapshot;
}

export interface QueueTaskOptions {
  reveal?: boolean;
  applyMode?: "prepare" | "apply";
}

export class AdoneXPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "adonex.chatView";
  private view?: vscode.WebviewView;
  private pending?: PendingTask;
  private proposal?: ImplementationProposal;
  private patch?: GeneratedPatch;
  private taskRecord?: TaskRecord;
  private taskStore?: TaskStore;
  private abortController?: AbortController;
  private selectedAttachments: vscode.Uri[] = [];
  private readonly localChatHistory: Array<{ role: "user" | "assistant"; text: string }> = [];
  private applyMode: "prepare" | "apply" = "prepare";
  private readonly orchestrator: AgentOrchestrator;
  private readonly workspaceScanner = new WorkspaceContext();
  private readonly patchEngine = new PatchEngine();
  private readonly composer: ComposerSession;
  private readonly commandRunner = new CommandRunner();
  private readonly vick = new VickVoiceSession();
  private readonly vickLocalService = new VickLocalServiceClient(
    "http://127.0.0.1:8765",
    async (event) => this.simulateVickCommand(`Vick ${event.command}`)
  );

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.orchestrator = new AgentOrchestrator(context);
    this.composer = new ComposerSession(this.orchestrator, this.patchEngine);
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "webview", "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "media")
      ]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (message: {
        type: string;
        task?: string;
        action?: AgentAction;
        mode?: AgentMode;
        path?: string;
        selected?: boolean;
      }) => void this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );
    this.configureVickFromWorkspace();
    this.postVickStatus(this.vick.status());
    if (this.vickAutoStart()) {
      void this.startVickVoice(false);
    }
  }

  // Revela o dialogo do AdoneX. Acionado pelo icone/logo na activity bar e pelo
  // comando "AdoneX: Open Chat". O <viewId>.focus abre o container onde ele estiver.
  public async reveal(): Promise<void> {
    if (this.view?.show) {
      this.view.show(true);
      return;
    }
    await vscode.commands.executeCommand(`${AdoneXPanel.viewType}.focus`);
  }

  public async queueTask(
    task: string,
    action: AgentAction,
    mode?: AgentMode,
    options: QueueTaskOptions = {}
  ): Promise<TaskRecord | undefined> {
    if (options.reveal !== false) {
      await this.reveal();
    }
    await this.createPlan(
      task,
      action,
      this.resolveMode(
        task,
        action,
        { mode: mode ?? "auto", governed: isGovernedAction(action) },
        mode ?? this.defaultMode()
      ),
      options.applyMode
    );
    if (this.isAutonomousSynapse()) {
      await this.runAutonomousSynapse();
    }
    return this.taskRecord;
  }

  public async startVickVoice(reveal = true): Promise<void> {
    if (reveal) await this.reveal();
    this.configureVickFromWorkspace();
    this.postVickStatus(this.vick.start());
    const configuration = vscode.workspace.getConfiguration("adonex");
    if (configuration.get<string>("voice.engine", "simulated") === "local_service") {
      try {
        const health = await this.vickLocalService.start();
        this.postVickStatus(
          this.vick.setState(
            health.engineReady ? "asleep" : "error",
            health.engineReady
              ? "Vick local está ouvindo e aguardando a palavra de ativação."
              : `Serviço de voz ativo, mas a transcrição local não iniciou: ${health.error ?? "motor indisponível"}`
          )
        );
      } catch (error) {
        this.postVickStatus(
          this.vick.setState(
            "error",
            `Serviço local da Vick indisponível: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }
  }

  public async stopVickVoice(): Promise<void> {
    this.vickLocalService.stop();
    this.postVickStatus(this.vick.stop());
  }

  public async toggleVickMute(): Promise<void> {
    this.postVickStatus(this.vick.toggleMute());
  }

  public async simulateVickCommand(transcript?: string): Promise<void> {
    if (!transcript?.trim()) {
      const input = await vscode.window.showInputBox({
        title: "Vick: Simulate Voice Command",
        prompt: "Type a command as if spoken after the wake word",
        placeHolder: "Vick revise a arquitetura do Synapse",
        ignoreFocusOut: true
      });
      transcript = input;
    }
    if (!transcript?.trim()) return;

    this.configureVickFromWorkspace();
    const result = this.vick.handleTranscript(transcript);
    this.postVickStatus(result);
    if (!result.activated || result.command === undefined) return;

    const command = result.command.trim();
    if (!command) {
      this.postVickStatus(this.vick.setState("listening", "Vick is ready for the next command."));
      return;
    }

    const route = routeChatCommand(undefined, command);
    const resolved = resolveChatPrompt(command, route);
    if (!resolved) {
      this.postVickStatus(
        this.vick.setState("error", "Vick could not convert the voice command into an AdoneX task.")
      );
      return;
    }
    this.postVickStatus(this.vick.setState("thinking", "Vick routed the command to AdoneX."));
    await this.queueTask(resolved, route.action, route.mode, {
      reveal: false,
      applyMode: this.vickRequiresPatchConfirmation() ? "prepare" : this.patchApplyMode()
    });
  }

  private async handleMessage(message: {
    type: string;
    task?: string;
    action?: AgentAction;
    mode?: AgentMode;
    path?: string;
    selected?: boolean;
  }): Promise<void> {
    try {
      if (message.type === "composerGenerate" && message.task) {
        await this.composerGenerate(message.task, message.mode);
      } else if (message.type === "composerRefine" && message.task) {
        await this.composerRefine(message.task, message.mode);
      } else if (message.type === "composerToggle" && message.path !== undefined) {
        this.composer.toggleFile(message.path, message.selected ?? true);
      } else if (message.type === "composerSelectAll") {
        this.composer.setAllSelected(message.selected ?? true);
      } else if (message.type === "composerOpenDiff" && message.path) {
        await this.composer.openDiff(message.path);
      } else if (message.type === "composerApply") {
        await this.composerApply();
      } else if (message.type === "composerUndo") {
        await this.composerUndo();
      } else if (message.type === "composerDiscard") {
        this.composer.reset();
        this.post({ type: "composerState", state: "idle", text: "Proposta descartada." });
      } else if (message.type === "plan" && message.task && message.action && message.mode) {
        await this.createPlan(message.task, message.action, message.mode);
      } else if (message.type === "send" && message.task) {
        await this.handleUnifiedRequest(message.task, message.mode);
      } else if (message.type === "mentionPick") {
        await this.pickMention();
      } else if (message.type === "selectAttachments") {
        await this.selectAttachments();
      } else if (message.type === "clearAttachments") {
        this.selectedAttachments = [];
        this.postAttachmentState();
      } else if (message.type === "clearHistory") {
        this.localChatHistory.length = 0;
      } else if (message.type === "openSharedMemory") {
        await this.openSharedMemory();
      } else if (message.type === "resumeSharedTask" && message.task) {
        await this.resumeSharedTask(message.task);
      } else if (message.type === "approve") {
        await this.executePending();
      } else if (message.type === "reject") {
        if (this.taskRecord && this.taskStore) {
          this.taskRecord.status = "rejected";
          await this.taskStore.save(this.taskRecord);
        }
        this.pending = undefined;
        this.proposal = undefined;
        this.patch = undefined;
        this.post({ type: "status", text: "Plan rejected." });
      } else if (message.type === "previewPatch") {
        await this.previewPatch();
      } else if (message.type === "applyPatch") {
        await this.applyPatch();
      } else if (message.type === "undoPatch") {
        await this.undoPatch();
      } else if (message.type === "cancel") {
        await this.cancelCurrentTask();
      } else if (message.type === "stop") {
        this.stopCurrent();
      } else if (message.type === "vickStart") {
        await this.startVickVoice(false);
      } else if (message.type === "vickStop") {
        await this.stopVickVoice();
      } else if (message.type === "vickMute") {
        await this.toggleVickMute();
      } else if (message.type === "vickSimulate") {
        await this.simulateVickCommand(message.task);
      } else if (message.type === "runTests") {
        await this.runTests();
      } else if (message.type === "fixFromError") {
        await this.fixFromError();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const aborted = isUserCancellation(error, this.abortController?.signal);
      if (aborted) {
        if (this.taskRecord && this.taskStore) {
          this.taskRecord.status = "cancelled";
          await this.taskStore.save(this.taskRecord);
        }
        this.post({ type: "stopped", text: "Processo interrompido." });
        return;
      }
      if (this.taskRecord && this.taskStore) {
        this.taskRecord.status = "failed";
        this.taskRecord.error = detail;
        await this.taskStore.save(this.taskRecord);
      }
      this.post({ type: "error", text: detail });
    }
  }

  /** Aborta o processo em andamento (chat, composer ou tarefa) sem apagar a proposta. */
  private stopCurrent(): void {
    this.abortController?.abort();
    this.postVickStatus(this.vick.setState("asleep", "Vick voltou ao repouso."));
  }

  /** Compatibilidade: o antigo comando Composer agora foca o chat unificado. */
  public async openComposer(): Promise<void> {
    await this.reveal();
    this.post({ type: "focusPrompt" });
  }

  private composerMode(task: string, requested?: AgentMode): Exclude<AgentMode, "auto"> {
    return this.resolveMode(
      task,
      "implement",
      { mode: "local", governed: true },
      requested ?? this.defaultMode()
    );
  }

  private async composerGenerate(task: string, mode?: AgentMode): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.post({ type: "composerState", state: "planning", text: "Planejando mudancas multi-arquivo..." });
    this.postRuntimeState("thinking", "Composer: gerando proposta multi-arquivo...");
    const result = await this.composer.generate(
      task,
      this.composerMode(task, mode),
      this.abortController.signal,
      (text) => this.postStep(text)
    );
    this.postComposerProposal(result);
  }

  private async composerRefine(instruction: string, mode?: AgentMode): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.post({ type: "composerState", state: "planning", text: "Refinando a proposta..." });
    const result = await this.composer.refine(
      instruction,
      this.composerMode(instruction, mode),
      this.abortController.signal,
      (text) => this.postStep(text)
    );
    this.postComposerProposal(result);
  }

  private postComposerProposal(result: {
    view: { summary: string; files: unknown[]; commands: string[] };
    responseText: string;
    model: string;
    warnings?: string[];
  }): void {
    for (const warning of result.warnings ?? []) {
      this.post({ type: "status", text: `Aviso: ${warning}` });
    }
    this.post({
      type: "composerProposal",
      summary: result.view.summary,
      files: result.view.files,
      commands: result.view.commands,
      model: result.model
    });
    this.postRuntimeState(
      "awaiting_confirmation",
      `Composer preparou ${result.view.files.length} arquivo(s). Revise e aplique os selecionados.`
    );
  }

  private async composerApply(): Promise<void> {
    this.post({ type: "composerState", state: "applying", text: "Aplicando arquivos selecionados..." });
    this.postRuntimeState("editing", "Composer: aplicando arquivos selecionados...");
    // O clique em "Aplicar" na revisao ja e a aprovacao humana explicita; os
    // guards de secrets e de caminho no PatchEngine seguem ativos.
    const diagnosticsBefore = this.captureErrorDiagnostics(this.composer.selectedPaths());
    const result = await this.composer.apply(false);
    this.post({
      type: "composerApplied",
      appliedPaths: result.appliedPaths,
      commands: result.commands
    });
    // Validacao estrutural gratuita: erros novos de linguagem (tsc, eslint etc.)
    // detectados pelo editor, independente dos comandos propostos pelo modelo.
    const newErrors = await this.reportNewDiagnostics(diagnosticsBefore, result.appliedPaths);
    const commands = selectValidationCommands(result.commands);
    if (!commands.length) {
      if (newErrors.length) {
        // Sem comando de validacao, os diagnostics viram a falha que alimenta
        // o mesmo ciclo governado de correcao do Composer.
        await this.handleComposerValidationFailure(
          {
            command: "vscode diagnostics (language server)",
            exitCode: 1,
            stdout: formatDiagnosticsAsFailure(newErrors),
            stderr: "",
            durationMs: 0,
            timedOut: false
          },
          true,
          async () => {
            // Revalidacao do modo autonomo: compara de novo os diagnostics
            // contra o estado anterior ao patch (nao executa shell).
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            const stillFailing = diffDiagnosticsErrors(
              diagnosticsBefore,
              this.captureErrorDiagnostics(this.composer.selectedPaths())
            );
            this.postRuntimeState(
              "idle",
              stillFailing.length
                ? `Diagnostics ainda reportam ${stillFailing.length} erro(s) novo(s) apos a correcao. Revise manualmente.`
                : "Composer validado: diagnostics limpos apos a correcao."
            );
          }
        );
        return;
      }
      this.postRuntimeState(
        "idle",
        `Composer aplicou ${result.appliedPaths.length} arquivo(s). Nenhum comando de validacao foi proposto.`
      );
      return;
    }
    // Ciclo editar -> validar -> corrigir: valida automaticamente e tenta uma
    // unica correcao governada, como o fluxo autonomo do Synapse Mode.
    await this.composerValidate(commands, true);
  }

  /**
   * Roda os comandos de validacao propostos apos a aplicacao do Composer.
   * Em caso de falha, gera uma unica correcao a partir da saida capturada;
   * a correcao volta para revisao humana, exceto no modo autonomo Synapse,
   * em que e aplicada e revalidada uma vez (sem nova rodada de correcao).
   */
  private async composerValidate(commands: string[], allowRepair: boolean): Promise<void> {
    const root =
      this.composer.getRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.postRuntimeState("idle", "Sem workspace para validar. Rode os comandos manualmente.");
      return;
    }
    const requireApproval = this.requiresCommandApproval();
    let failed: CommandResult | undefined;
    for (const command of commands) {
      this.post({ type: "composerState", state: "validating", text: `Validando: ${command}` });
      this.postRuntimeState(
        "validating",
        requireApproval
          ? `Aguardando aprovacao para validar: ${command}`
          : `Composer validando: ${command}`
      );
      const result = await this.commandRunner.runCaptured(
        command,
        root,
        600_000,
        requireApproval,
        this.abortController?.signal
      );
      this.post({ type: "testResult", result });
      if (result.exitCode !== 0) {
        failed = result;
        break;
      }
    }
    if (!failed) {
      this.post({
        type: "composerState",
        state: "idle",
        text: `Validacao passou (${commands.length} comando(s)).`
      });
      this.postRuntimeState("idle", `Composer validado: ${commands.join("; ")}.`);
      return;
    }
    await this.handleComposerValidationFailure(failed, allowRepair);
  }

  /**
   * Trata uma falha de validacao do Composer (comando ou diagnostics do
   * editor): diagnostica, notifica e gera uma unica correcao governada.
   * A correcao volta para revisao humana, exceto no modo autonomo Synapse.
   */
  private async handleComposerValidationFailure(
    failed: CommandResult,
    allowRepair: boolean,
    revalidate?: () => Promise<void>
  ): Promise<void> {
    const diagnosis = diagnoseCommandFailure(failed);
    this.post({
      type: "testFailure",
      text: [failed.stdout, failed.stderr].filter(Boolean).join("\n"),
      command: failed.command,
      diagnosis
    });
    if (!allowRepair) {
      this.postRuntimeState(
        "idle",
        `Validacao falhou apos a correcao automatica: ${failed.command}. Revise manualmente ou refine no Composer.`
      );
      return;
    }
    this.post({
      type: "status",
      text: "Validacao falhou. Gerando uma unica correcao automatica a partir da saida capturada."
    });
    const repaired = await this.composer.repair(
      buildRepairInput(failed),
      this.abortController?.signal,
      (text) => this.postStep(text)
    );
    // fable-judge: se a correcao acusou possivel enfraquecimento de teste, o
    // modo autonomo Synapse NAO aplica sozinho — exige revisao humana mesmo
    // quando `synapse.autonomous` estiver ligado.
    const judgeFlagged = (repaired.warnings ?? []).some((warning) =>
      warning.startsWith("fable-judge:")
    );
    if (this.composerAutonomousSynapse() && !judgeFlagged) {
      this.post({
        type: "status",
        text: `Modo autonomo Synapse: aplicando correcao (${repaired.view.files.length} arquivo(s)) e revalidando.`
      });
      const applied = await this.composer.apply(false);
      this.post({
        type: "composerApplied",
        appliedPaths: applied.appliedPaths,
        commands: applied.commands
      });
      // Revalida somente o que falhou; sem nova rodada de correcao.
      if (revalidate) {
        await revalidate();
        return;
      }
      await this.composerValidate([failed.command], false);
      return;
    }
    this.postComposerProposal(repaired);
    this.postRuntimeState(
      "awaiting_confirmation",
      judgeFlagged
        ? "fable-judge sinalizou possivel enfraquecimento de teste nesta correcao. Revise manualmente antes de aplicar."
        : "Correcao proposta a partir da falha capturada. Revise e aplique para revalidar."
    );
  }

  /**
   * Snapshot dos erros de linguagem (severity Error) dos arquivos informados,
   * via language servers ja ativos no editor. Custo zero e independente dos
   * comandos de validacao propostos pelo modelo.
   */
  private captureErrorDiagnostics(
    relativePaths: readonly string[]
  ): DiagnosticSnapshotEntry[] {
    const root =
      this.composer.getRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];
    const entries: DiagnosticSnapshotEntry[] = [];
    for (const relativePath of relativePaths) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), relativePath);
      for (const diagnostic of vscode.languages.getDiagnostics(uri)) {
        if (diagnostic.severity !== vscode.DiagnosticSeverity.Error) continue;
        entries.push({
          path: relativePath,
          message: diagnostic.message,
          line: diagnostic.range.start.line + 1
        });
      }
    }
    return entries;
  }

  /**
   * Compara diagnostics antes/depois do apply e reporta erros NOVOS no painel.
   * Aguarda um curto intervalo para os language servers reprocessarem os
   * arquivos recem-escritos. Retorna os erros novos para o chamador decidir
   * se alimenta o ciclo de correcao.
   */
  private async reportNewDiagnostics(
    before: readonly DiagnosticSnapshotEntry[],
    relativePaths: readonly string[]
  ): Promise<DiagnosticSnapshotEntry[]> {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const fresh = diffDiagnosticsErrors(before, this.captureErrorDiagnostics(relativePaths));
    if (fresh.length) {
      this.post({
        type: "status",
        text: `Aviso: ${formatDiagnosticsAsFailure(fresh, 5)}`
      });
    }
    return fresh;
  }

  private composerAutonomousSynapse(): boolean {
    return Boolean(
      this.composer.isSynapseWorkspace() &&
      vscode.workspace.getConfiguration("adonex").get<boolean>("synapse.autonomous", false)
    );
  }

  private async composerUndo(): Promise<void> {
    await this.composer.undo();
    this.post({ type: "composerState", state: "idle", text: "Ultima aplicacao do Composer revertida." });
    this.postRuntimeState("idle", "Composer: ultima aplicacao revertida.");
  }

  private async handleUnifiedRequest(prompt: string, requestedMode?: AgentMode): Promise<void> {
    const route = routeChatCommand(undefined, prompt);
    const resolved = resolveChatPrompt(prompt, route);
    if (!resolved) return;
    const solutionFactory = checkSolutionFactoryDialog(resolved, route);
    if (solutionFactory.applies) {
      if (solutionFactory.missingFields.length) {
        const response = renderSolutionFactoryMissingInfo(solutionFactory);
        this.rememberLocalChat(resolved, response);
        this.post({ type: "chatResponse", text: response, provider: "adonex", model: "solution-factory" });
        return;
      }
      await this.createPlan(resolved, route.action, "synapse");
      if (this.isAutonomousSynapse()) {
        await this.runAutonomousSynapse();
      }
      return;
    }
    const mode = this.resolveMode(resolved, route.action, route, requestedMode ?? this.defaultMode());
    if (shouldUseComposer(route)) {
      await this.composerGenerate(resolved, mode);
      return;
    }
    await this.sendLocalChat(resolved);

  }
  private async sendLocalChat(prompt: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("adonex");
    if (!config.get<boolean>("ollama.enabled", true)) {
      throw new Error("O Ollama esta desativado nas configuracoes do AdoneX.");
    }
    this.abortController?.abort();
    this.abortController = new AbortController();
    const safePrompt = scanAndRedactSecrets(prompt).redacted;
    if (await this.tryDatabaseSpecialistChat(safePrompt)) return;
    const baseUrl = normalizeOllamaBaseUrl(config.get<string>("ollama.baseUrl", "http://127.0.0.1:11434"));
    const inventory = await this.answerLocalModelInventory(safePrompt, baseUrl);
    if (inventory) {
      this.rememberLocalChat(safePrompt, inventory);
      this.selectedAttachments = [];
      this.postAttachmentState();
      this.post({ type: "chatResponse", text: inventory, provider: "ollama", model: "inventario-local" });
      return;
    }
    const profile = selectLocalModelProfileForTask(
      "chat", safePrompt,
      config.get<string>("ollama.fastModel", ADONEX_FAST_LOCAL_MODEL),
      config.get<string>("ollama.reasoningModel", "deepseek-coder-v2:lite")
    );
    const attachmentContext = await this.readAttachmentContext();
    const mentionContext = await this.readMentionContext(safePrompt);
    // Memoria e historico entram como contexto DINAMICO (workspaceContext), nunca
    // no system prompt, para nao quebrar o prefix cache do Ollama.
    const memoryContext = (mentionContext || attachmentContext)
      ? ""
      : await this.readBoundedWorkspaceFile(MEMORY_PATHS.sharedDialogMemory, 1_500);
    const recentHistory = this.localChatHistory.slice(-4)
      .map((item) => `${item.role === "user" ? "Usuario" : "AdoneX"}: ${item.text}`)
      .join("\n");
    // WorkspaceContext.collect() varre o workspace (findFiles + leitura de
    // ate 40 arquivos + rerank semantico opcional via Ollama) — mais caro
    // que memoryContext (1 leitura de arquivo). Pulamos para perguntas
    // "lean" (curtas/triviais) e quando ja ha mencao/anexo, que ganham
    // sozinhos em buildLocalChatContext de qualquer forma.
    const skipProjectScan = Boolean(mentionContext) || Boolean(attachmentContext) || shouldUseLeanLocalChat(safePrompt);
    if (!skipProjectScan) this.postStep("Percorrendo o projeto aberto...");
    const projectContext = skipProjectScan ? "" : await this.readProjectContext(safePrompt);
    // SYNAPSE_SPECIALIST_SYSTEM descreve a PLATAFORMA Synapse como se fosse
    // o workspace atual; para um projeto GERADO pela Solution Factory (nao a
    // plataforma em si) isso faz o modelo negar conhecer o proprio projeto
    // aberto. Troca para um system prompt neutro, ancorado no nome real do
    // projeto, nesse caso.
    const root = this.composer.getRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const projectIdentity = root ? detectProjectIdentity(root) : undefined;
    const chatBaseSystemPrompt = projectIdentity && !projectIdentity.isPlatformRepo
      ? buildChildProjectChatSystemPrompt(projectIdentity)
      : SYNAPSE_SPECIALIST_SYSTEM;
    const dynamicContext = buildLocalChatContext({
      prompt: safePrompt,
      recentHistory: recentHistory ? `Conversa recente:\n${recentHistory}` : "",
      memoryContext: memoryContext ? `Memoria compartilhada (trecho):\n${memoryContext}` : "",
      projectContext,
      mentionContext,
      attachmentContext
    });
    const model = profile.model;
    this.postStep(`Gerando resposta com ${model}...`);
    const chatStartedAt = Date.now();
    let chatTokensReported = 0;
    let response: LlmResponse;
    // Uma pergunta com contexto de projeto anexado (dynamicContext) tem um
    // prompt bem maior que uma pergunta "lean" -- em CPU o prompt-eval domina
    // a latencia, entao o mesmo timeout de 120s configurado para perguntas
    // curtas corta respostas legitimas pela metade quando ha varredura de
    // workspace real envolvida. Mesmo padrao de minimo-por-carga que
    // agentOrchestrator.ollamaTimeoutMs ja usa para o pipeline governado.
    const timeoutSeconds = Math.max(
      dynamicContext ? 240 : 120,
      config.get<number>("ollama.timeoutSeconds", 120)
    );
    try {
      response = await new OllamaClient({
        baseUrl,
        model,
        apiStyle: config.get<"chat" | "generate">("ollama.apiStyle", "chat"),
        timeoutMs: timeoutSeconds * 1000,
        keepAlive: config.get<string>("ollama.keepAlive", "10m"),
        numCtx: profile.numCtx,
        temperature: profile.temperature,
        topP: profile.topP,
        repeatPenalty: profile.repeatPenalty,
        maxRetries: config.get<number>("ollama.maxRetries", 2),
        retryDelayMs: config.get<number>("ollama.retryDelayMs", 250),
        logger: (event) => {
          if (event.type === "first_token") {
            this.postStep(
              `Primeiro token apos ${Math.round((event.durationMs ?? 0) / 1000)}s; escrevendo...`
            );
          }
        },
        onToken: (tokens) => {
          if (tokens - chatTokensReported >= 48) {
            chatTokensReported = tokens;
            const elapsed = Math.round((Date.now() - chatStartedAt) / 1000);
            this.postStep(`Gerando... ~${tokens} tokens (${elapsed}s)`);
          }
        },
        onChunk: (text) => this.postStreamChunk(text)
      }).generate({
        systemPrompt: localChatSystemPrompt(chatBaseSystemPrompt, safePrompt),
        userPrompt: safePrompt,
        workspaceContext: dynamicContext,
        maxOutputTokens: localChatOutputBudget(
          safePrompt,
          profile,
          config.get<number>("chat.maxTokens", profile.maxOutputTokens)
        ),
        signal: this.abortController.signal
      });
    } catch (error) {
      if (isUserCancellation(error, this.abortController.signal)) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const fallback = createLocalChatFailureResponse(safePrompt, model, detail);
      this.rememberLocalChat(safePrompt, fallback);
      this.selectedAttachments = [];
      this.postAttachmentState();
      this.post({ type: "chatResponse", text: fallback, provider: "ollama", model });
      return;
    }
    const answer = guardAgainstLocalHallucinations(sanitizeAdoneXResponse(response.text));
    this.rememberLocalChat(safePrompt, answer);
    this.selectedAttachments = [];
    this.postAttachmentState();
    this.post({ type: "chatResponse", text: answer, provider: response.provider, model: response.model });
  }

  private async readProjectContext(prompt: string): Promise<string> {
    try {
      const snapshot = await this.workspaceScanner.collect(prompt, 2_500);
      return formatWorkspaceSnapshot(snapshot, 4_000);
    } catch {
      return "";
    }
  }

  /**
   * Intercepta perguntas de banco de dados no chat livre antes do fluxo
   * normal do Ollama: comando explicito "/banco" ou deteccao implicita por
   * regex (looksLikeDatabaseQuestion). So aciona o pipeline planner->writer
   * ->critic quando ha evidencia real de banco no workspace
   * (hasDatabaseSpecialist); caso contrario deixa o chat seguir normalmente.
   */
  private async tryDatabaseSpecialistChat(prompt: string): Promise<boolean> {
    const explicitCommand = /^\/banco\b/i.test(prompt.trim());
    const question = explicitCommand ? prompt.trim().replace(/^\/banco\b/i, "").trim() : prompt.trim();
    if (!explicitCommand && !looksLikeDatabaseQuestion(question)) return false;
    const root = this.composer.getRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !question) return false;
    if (!(await hasDatabaseSpecialist(root))) return false;
    this.postStep("Consultando o especialista de banco (planner -> writer -> critic no Ollama local)...");
    try {
      const proposal = await askDatabaseSpecialist(root, question, {
        signal: this.abortController?.signal,
        onProgress: (text) => this.postStep(text)
      });
      const answer = renderSpecialistProposal(proposal);
      this.rememberLocalChat(prompt, answer);
      this.selectedAttachments = [];
      this.postAttachmentState();
      this.post({ type: "chatResponse", text: answer, provider: "especialista-banco", model: proposal.model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: "chatResponse",
        text: `O especialista de banco falhou: ${message}`,
        provider: "especialista-banco",
        model: "planner-writer-critic"
      });
    }
    return true;
  }

  private async selectAttachments(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
      openLabel: "Anexar ao AdoneX",
      filters: { "Arquivos e imagens": ["txt", "md", "json", "yaml", "yml", "toml", "ts", "tsx", "js", "jsx", "py", "css", "html", "sql", "csv", "png", "jpg", "jpeg", "webp", "gif", "svg"] }
    });
    if (!selected?.length) return;
    this.selectedAttachments = selected.slice(0, 5);
    this.postAttachmentState();
  }

  private postAttachmentState(): void {
    this.post({ type: "attachments", files: this.selectedAttachments.map((uri) => uri.path.split("/").pop() ?? uri.fsPath) });
  }

  private async openSharedMemory(): Promise<void> {
    const shared = await this.readBoundedWorkspaceFile(MEMORY_PATHS.sharedDialogMemory, 80_000);
    const tasks = await this.readBoundedWorkspaceFile(MEMORY_PATHS.chatTasks, 80_000);
    const entries = this.sharedHistoryEntries(`${shared}\n${tasks}`);
    this.post({ type: "sharedHistory", entries });
  }

  private sharedHistoryEntries(content: string): Array<{
    source: string; status: string; summary: string; task: string;
  }> {
    const entries: Array<{ source: string; status: string; summary: string; task: string }> = [];
    const seen = new Set<string>();
    for (const rawLine of content.split(/\r?\n/).reverse()) {
      const line = rawLine.trim();
      if (!line || !/(Codex|Claude Code|AdoneX)/i.test(line)) continue;
      const clean = line.replace(/^[-|\s]+|[|\s]+$/g, "");
      const columns = clean.split("|").map((item) => item.trim()).filter(Boolean);
      const source = columns.find((item) => /^(Codex(?:\/OpenAI)?|Claude Code|AdoneX)$/i.test(item)) ??
        (line.match(/Codex(?:\/OpenAI)?|Claude Code|AdoneX/i)?.[0] ?? "Compartilhado");
      const status = columns.find((item) => /^(pending|received|briefing|done|blocked|guidance|analysis|clarification)$/i.test(item)) ??
        (line.match(/\b(pending|received|briefing|done|blocked|guidance|analysis|clarification)\b/i)?.[0] ?? "history");
      const candidates = columns.filter((item) => item !== source && item !== status && !/^\d{4}-\d{2}-\d{2}/.test(item));
      const summary = (candidates.at(-1) ?? clean).replace(/^[-:]\s*/, "").slice(0, 1_200);
      const task = candidates.length > 1 ? candidates[candidates.length - 2] : summary;
      const key = `${source}|${status}|${summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ source, status: status.toLowerCase(), summary, task });
      if (entries.length >= 60) break;
    }
    return entries.sort((a, b) => Number(this.isPendingHistory(b.status)) - Number(this.isPendingHistory(a.status)));
  }

  private isPendingHistory(status: string): boolean {
    return /^(pending|received|briefing|blocked)$/i.test(status);
  }

  private async resumeSharedTask(task: string): Promise<void> {
    const safeTask = scanAndRedactSecrets(task).redacted.trim();
    if (!safeTask) throw new Error("Selecione uma tarefa valida do historico compartilhado.");
    const continuation = [
      "Continue localmente com o AdoneX a tarefa compartilhada abaixo.",
      "Consulte a memoria compartilhada e o estado atual do workspace antes de agir.",
      "Preserve mudancas existentes e mantenha aprovacoes humanas para patches e comandos.",
      "",
      safeTask
    ].join("\n");
    const route = routeChatCommand(undefined, continuation);
    const resolved = resolveChatPrompt(continuation, route);
    if (!resolved) throw new Error("Nao foi possivel converter o registro em tarefa local.");
    await this.queueTask(resolved, route.action, route.mode ?? "local", { reveal: false });
  }

  private async readAttachmentContext(): Promise<string> {
    if (!this.selectedAttachments.length) return "";
    const sections: string[] = [];
    for (const uri of this.selectedAttachments) {
      const name = uri.path.split("/").pop() ?? uri.fsPath;
      if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
        sections.push(`Imagem anexada: ${name}. Nao descreva seu conteudo sem evidencia visual.`);
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        sections.push(`Arquivo anexado (${name}):\n${scanAndRedactSecrets(Buffer.from(bytes).toString("utf8").slice(0, 20_000)).redacted}`);
      } catch { sections.push(`Anexo selecionado, mas nao legivel como texto: ${name}`); }
    }
    return sections.join("\n\n");
  }

  /** Resolve mencoes @ do prompt (arquivos, @selection, @editor/@file) em contexto. */
  private async readMentionContext(prompt: string): Promise<string> {
    const parsed = parseMentions(prompt);
    if (!parsed.specials.length && !parsed.paths.length) return "";
    const sections: string[] = [];
    const editor = vscode.window.activeTextEditor;
    if (parsed.specials.includes("selection") && editor) {
      const selection = editor.document.getText(editor.selection).trim();
      if (selection) {
        sections.push(
          `Selecao ativa (${vscode.workspace.asRelativePath(editor.document.uri)}):\n${scanAndRedactSecrets(selection.slice(0, 8_000)).redacted}`
        );
      }
    }
    if ((parsed.specials.includes("editor") || parsed.specials.includes("file")) && editor) {
      sections.push(
        `Arquivo ativo (${vscode.workspace.asRelativePath(editor.document.uri)}):\n${scanAndRedactSecrets(editor.document.getText().slice(0, 12_000)).redacted}`
      );
    }
    for (const mention of parsed.paths.slice(0, 5)) {
      const uri = await this.resolveMentionUri(mention);
      if (!uri) {
        sections.push(`Mencao @${mention}: arquivo nao encontrado no workspace.`);
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const relative = vscode.workspace.asRelativePath(uri);
        sections.push(
          `Arquivo mencionado (${relative}):\n${scanAndRedactSecrets(Buffer.from(bytes).toString("utf8").slice(0, 12_000)).redacted}`
        );
      } catch {
        sections.push(`Mencao @${mention}: nao foi possivel ler o arquivo.`);
      }
    }
    return sections.length ? `Contexto por mencao:\n\n${sections.join("\n\n")}` : "";
  }

  private async resolveMentionUri(mention: string): Promise<vscode.Uri | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root) {
      const direct = vscode.Uri.joinPath(root, ...mention.split("/"));
      try {
        await vscode.workspace.fs.stat(direct);
        return direct;
      } catch {
        // Segue para busca por padrao abaixo.
      }
    }
    const basename = mention.split("/").pop() ?? mention;
    const found = await vscode.workspace.findFiles(
      `**/${basename}`,
      "**/{node_modules,.git,dist,out,.next,.venv,__pycache__}/**",
      1
    );
    return found[0];
  }

  /** QuickPick para inserir uma mencao @ no chat (arquivo, selecao ou arquivo ativo). */
  private async pickMention(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const items: Array<vscode.QuickPickItem & { token: string }> = [];
    if (editor && !editor.selection.isEmpty) {
      items.push({ label: "$(selection) Selecao ativa", description: "@selection", token: "@selection" });
    }
    if (editor) {
      items.push({
        label: "$(file) Arquivo ativo",
        description: `@file (${vscode.workspace.asRelativePath(editor.document.uri)})`,
        token: "@file"
      });
    }
    const files = await vscode.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,dist,out,.next,.venv,__pycache__,.adonex,.vscode-test}/**",
      300
    );
    for (const uri of files) {
      const relative = vscode.workspace.asRelativePath(uri);
      items.push({ label: `$(code) ${relative}`, token: `@${relative}` });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: "AdoneX: adicionar contexto por mencao",
      placeHolder: "Escolha um arquivo, a selecao ou o arquivo ativo"
    });
    if (picked) this.post({ type: "insertMention", token: `${picked.token} ` });
  }

  private async readBoundedWorkspaceFile(relativePath: string, maxChars: number): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return "";
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...relativePath.split("/")));
      return Buffer.from(bytes).toString("utf8").slice(0, maxChars);
    } catch { return ""; }
  }

  private async answerLocalModelInventory(prompt: string, baseUrl: string): Promise<string | undefined> {
    const normalized = prompt.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (!/(modelos? locais?|modelos? (?:do|no) adonex|modelos? (?:baixados|instalados|disponiveis))/.test(normalized)) return undefined;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: this.abortController?.signal });
    if (!response.ok) throw new Error(`Nao foi possivel consultar o Ollama local (HTTP ${response.status}).`);
    const payload = await response.json() as { models?: Array<{ name?: string; size?: number }> };
    const models = (payload.models ?? []).filter((item) => item.name).map((item) => ({ name: item.name!, size: item.size }));
    if (!models.length) return "O Ollama esta acessivel, mas nao retornou nenhum modelo local instalado.";
    return [`O Ollama retornou ${models.length} modelo(s) instalado(s) nesta maquina:`, "", ...models.map((item) => `- ${item.name}${item.size ? ` (${(item.size / 1_073_741_824).toFixed(1)} GB)` : ""}`), "", "Essa lista veio diretamente do Ollama (/api/tags), nao de uma suposicao do modelo."].join("\n");
  }

  private rememberLocalChat(user: string, assistant: string): void {
    this.localChatHistory.push({ role: "user", text: user }, { role: "assistant", text: assistant });
    if (this.localChatHistory.length > 12) this.localChatHistory.splice(0, this.localChatHistory.length - 12);
  }

  private async createPlan(
    task: string,
    action: AgentAction,
    mode: AgentMode,
    applyMode?: "prepare" | "apply"
  ): Promise<void> {
    const safeTask = scanAndRedactSecrets(task).redacted;
    mode = this.resolveMode(safeTask, action, { mode, governed: isGovernedAction(action) }, mode);
    this.applyMode = applyMode ?? this.patchApplyMode();
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.postRuntimeState("thinking", "Analyzing workspace...");
    this.postVickStatus(this.vick.setState("thinking", "Vick is analyzing the request."));
    const result = await this.orchestrator.createPlan(safeTask, action, mode);
    this.pending = { task: safeTask, action, mode, ...result };
    this.proposal = undefined;
    this.patch = undefined;
    this.taskStore = new TaskStore(result.snapshot.root);
    const now = new Date().toISOString();
    this.taskRecord = {
      id: result.plan.id,
      createdAt: now,
      updatedAt: now,
      status: "planned",
      objective: safeTask,
      action,
      mode,
      selectedFiles: result.snapshot.relevantFiles.map((file) => ({
        path: file.path,
        score: file.score,
        reasons: file.reasons
      })),
      plan: result.plan,
      commands: result.plan.commands,
      commandResults: [],
      cost: {
        estimatedInputTokens: result.plan.estimatedInputTokens,
        estimatedOutputTokens: result.plan.estimatedOutputTokens,
        estimatedCostUsd: result.plan.estimatedCostUsd,
        actualInputTokens: 0,
        actualOutputTokens: 0,
        actualEstimatedCostUsd: 0
      },
      lifecycle: updateTaskLifecycle(
        createTaskLifecycle(now),
        "plan",
        "completed",
        "Workspace analyzed and initial execution plan created.",
        now
      )
    };
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    this.post({
      type: "plan",
      plan: result.plan,
      synapse: {
        detected: result.snapshot.synapseDetected,
        confidence: result.snapshot.synapseConfidence,
        signals: result.snapshot.synapseSignals,
        active: mode === "synapse" || result.snapshot.synapseDetected
      }
    });
    this.post({
      type: "status",
      text: `Task registered: .adonex/tasks/${result.plan.id}.json`
    });
  }

  private async executePending(): Promise<void> {
    if (!this.pending) throw new Error("There is no pending AdoneX plan.");
    if (!this.taskRecord || !this.taskStore) {
      throw new Error("The pending task has no persistent AdoneX record.");
    }
    this.ensureNotCancelled();
    this.taskRecord.status = "approved";
    this.taskRecord.lifecycle = activateTaskPhase(
      this.taskRecord.lifecycle,
      "act",
      "Generating model response and implementation proposal."
    );
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    this.postRuntimeState("thinking", "Executing approved plan...");
    this.postRuntimeState("editing", "Preparing implementation proposal for the Synapse workspace...");
    const execution = await this.orchestrator.executeApproved(
      this.pending.task,
      this.pending.action,
      this.pending.mode,
      this.pending.plan,
      this.pending.snapshot,
      {
        signal: this.abortController?.signal,
        onProgress: (text) => this.postStep(text),
        onToolStep: (step) => this.postToolStep(step)
      }
    );
    this.ensureNotCancelled();
    this.proposal = execution.proposal;
    if (this.taskRecord) this.taskRecord.toolSteps = execution.toolSteps;
    this.taskRecord.lifecycle = activateTaskPhase(
      this.taskRecord.lifecycle,
      "observe",
      `Received response from ${execution.response.provider}/${execution.response.model}.`
    );
    this.patch = execution.proposal
      ? await this.patchEngine.generate(
          execution.proposal.changes,
          execution.proposal.operations,
          { droppedOperations: execution.proposal.droppedOperations }
        )
      : undefined;
    // Nunca deixa proposta parcial passar em silencio: entradas malformadas
    // descartadas pelo parser viram aviso explicito no painel.
    for (const warning of this.patch?.warnings ?? []) {
      this.post({ type: "status", text: `Aviso: ${warning}` });
    }
    const patchSummary = this.patch ? summarizePatchForSpeech(this.patch) : undefined;
    const responseText = guardAgainstLocalHallucinations(
      sanitizeAdoneXResponse(execution.response.text),
      evidenceFromSnapshot(this.pending.snapshot, this.pending.plan.commands)
    );
    this.taskRecord.status = execution.proposal ? "awaiting_patch_confirmation" : "completed";
    this.taskRecord.lifecycle = execution.proposal
      ? activateTaskPhase(
          this.taskRecord.lifecycle,
          "patch",
          `Patch proposal prepared with ${this.patch?.changes.length ?? 0} file change(s).`
        )
      : completeTaskLifecycle(this.taskRecord.lifecycle, "Read-only task completed.");
    this.taskRecord.provider = execution.response.provider;
    this.taskRecord.model = execution.response.model;
    this.taskRecord.proposalSummary = execution.proposal?.summary;
    this.taskRecord.patchDiff = this.patch?.diff;
    this.taskRecord.spokenDiffSummary = patchSummary?.spoken;
    this.taskRecord.commands =
      execution.proposal?.commands.length
        ? execution.proposal.commands
        : this.taskRecord.commands;
    this.taskRecord.cost.actualInputTokens += execution.response.inputTokens;
    this.taskRecord.cost.actualOutputTokens += execution.response.outputTokens;
    this.taskRecord.cost.actualEstimatedCostUsd +=
      execution.actualEstimatedCostUsd;
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    this.post({
      type: "response",
      text: responseText,
      proposalSummary: execution.proposal?.summary,
      provider: execution.response.provider,
      model: execution.response.model,
      // this.patch (PatchEngine.generate) ja resolve `operations` em `changes`;
      // checar so execution.proposal.changes ficaria falso-negativo para
      // propostas do Tool Loop, que chegam so como operations cirurgicas.
      hasPatch: Boolean(this.patch?.changes.length),
      diff: this.patch?.diff,
      spokenDiffSummary: patchSummary?.spoken
    });
    if (patchSummary) {
      this.postRuntimeState("awaiting_confirmation", patchSummary.spoken);
    }
    if (!execution.proposal) {
      this.post({ type: "status", text: "No code changes were proposed. The workspace remains unchanged." });
      this.taskRecord.finalSummary = responseText;
      this.taskRecord.commitSuggestion =
        this.pending.action === "commit" ? responseText : undefined;
      await this.taskStore.save(this.taskRecord);
      await this.persistSharedMemory(responseText);
      this.post({
        type: "final",
        summary: responseText,
        commitSuggestion: this.taskRecord.commitSuggestion,
        cost: this.taskRecord.cost
      });
    }
  }

  private async previewPatch(): Promise<void> {
    if (!this.patch?.changes.length) {
      throw new Error("No patch proposal is available.");
    }
    const diff = await this.patchEngine.preview(this.patch);
    this.post({ type: "diff", text: diff });
  }

  private async applyPatch(): Promise<void> {
    if (!this.patch?.changes.length) {
      throw new Error("No patch proposal is available.");
    }
    this.ensureNotCancelled();
    this.postRuntimeState("editing", `Applying ${this.patch.changes.length} file change(s) to the Synapse workspace...`);
    const diagnosticsBefore = this.captureErrorDiagnostics(
      this.patch.changes.map((change) => change.path)
    );
    const receipt = await this.patchEngine.apply(
      this.patch,
      true,
      this.requiresWriteApproval()
    );
    // Reporta erros novos de linguagem introduzidos pelo patch (aviso; o ciclo
    // de correcao governado segue disponivel via validacao de comandos).
    await this.reportNewDiagnostics(
      diagnosticsBefore,
      this.patch.changes.map((change) => change.path)
    );
    if (this.taskRecord && this.taskStore) {
      this.taskRecord.status = "patch_applied";
      this.taskRecord.appliedPatch = receipt;
      this.taskRecord.lifecycle = updateTaskLifecycle(
        this.taskRecord.lifecycle,
        "patch",
        "completed",
        `Applied ${this.patch.changes.length} file change(s).`
      );
      await this.taskStore.save(this.taskRecord);
      this.postLifecycle();
    }
    this.post({
      type: "status",
      text: `Applied ${this.patch.changes.length} file change(s) to the Synapse workspace.`
    });
  }

  private async undoPatch(): Promise<void> {
    if (!this.taskRecord?.appliedPatch || !this.taskStore) {
      throw new Error("No reversible AdoneX patch is available.");
    }
    this.postRuntimeState("editing", "Reverting the last AdoneX patch...");
    await this.patchEngine.revert(this.taskRecord.appliedPatch);
    this.taskRecord.status = "patch_reverted";
    await this.taskStore.save(this.taskRecord);
    this.postRuntimeState("idle", "Last AdoneX patch was reverted.");
  }

  private async cancelCurrentTask(): Promise<void> {
    this.abortController?.abort();
    this.pending = undefined;
    this.proposal = undefined;
    this.patch = undefined;
    if (this.taskRecord && this.taskStore) {
      this.taskRecord.status = "cancelled";
      await this.taskStore.save(this.taskRecord);
    }
    this.postRuntimeState("cancelled", "Task cancelled.");
    this.postVickStatus(this.vick.setState("asleep", "Vick returned to standby."));
  }

  private async runTests(
    requireApproval = this.requiresCommandApproval()
  ): Promise<boolean> {
    if (!this.pending || !this.taskRecord || !this.taskStore) {
      throw new Error("No persistent task is ready for validation.");
    }
    const commands = selectValidationCommands([
      ...(this.proposal?.commands ?? []),
      ...this.pending.plan.commands
    ]);
    if (!commands.length) throw new Error("No test command was proposed.");

    const results: CommandResult[] = [];
    this.taskRecord.status = "validating";
    this.taskRecord.lifecycle = activateTaskPhase(
      this.taskRecord.lifecycle,
      "test",
      `Running up to ${commands.slice(0, 3).length} validation command(s).`
    );
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    for (const command of commands.slice(0, 3)) {
      this.ensureNotCancelled();
      this.post({
        type: "voiceState",
        state: "validating",
        text: requireApproval
          ? `Aguardando aprovacao para executar validacao: ${command}`
          : `Executando validacao automatica: ${command}`
      });
      this.post({
        type: "status",
        text: requireApproval
          ? `Aguardando aprovacao para: ${command}`
          : `Executando automaticamente: ${command}`
      });
      const result = await this.commandRunner.runCaptured(
        command,
        this.pending.snapshot.root,
        600_000,
        requireApproval,
        this.abortController?.signal
      );
      results.push(result);
      this.post({ type: "testResult", result });
      if (result.exitCode !== 0) break;
    }
    this.taskRecord.commandResults.push(...results);
    const failed = results.find((result) => result.exitCode !== 0);
    this.taskRecord.status = failed ? "tests_failed" : "tests_passed";
    if (failed) {
      this.taskRecord.lifecycle = activateTaskPhase(
        this.taskRecord.lifecycle,
        "repair",
        `Validation failed: ${failed.command}`
      );
      this.taskRecord.failureDiagnosis = diagnoseCommandFailure(failed);
      await this.taskStore.save(this.taskRecord);
      this.postLifecycle();
      this.post({
        type: "testFailure",
        text: [failed.stdout, failed.stderr].filter(Boolean).join("\n"),
        command: failed.command,
        diagnosis: this.taskRecord.failureDiagnosis
      });
      return false;
    }
    await this.completeTask();
    return true;
  }

  private async fixFromError(): Promise<void> {
    if (!this.pending || !this.taskRecord || !this.taskStore) {
      throw new Error("No failed task is available for correction.");
    }
    const failed = [...this.taskRecord.commandResults]
      .reverse()
      .find((result) => result.exitCode !== 0);
    if (!failed) throw new Error("No captured test error is available.");
    this.post({ type: "status", text: "Generating a correction from captured output..." });
    this.taskRecord.lifecycle = activateTaskPhase(
      this.taskRecord.lifecycle,
      "repair",
      "Generating correction patch from captured validation output."
    );
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    const refreshedSnapshot = await this.orchestrator.refreshSnapshot(
      `${this.pending.task}\n${failed.stderr}`
    );
    this.pending.snapshot = refreshedSnapshot;
    const execution = await this.orchestrator.proposeFix(
      this.pending.task,
      [failed.stdout, failed.stderr].filter(Boolean).join("\n"),
      this.pending.mode,
      this.pending.plan,
      refreshedSnapshot,
      {
        signal: this.abortController?.signal,
        onProgress: (text) => this.postStep(text)
      }
    );
    if (!execution.proposal?.changes.length) {
      throw new Error("AdoneX did not produce a correction patch.");
    }
    this.proposal = execution.proposal;
    this.patch = await this.patchEngine.generate(
      execution.proposal.changes,
      execution.proposal.operations
    );
    const patchSummary = summarizePatchForSpeech(this.patch);
    this.taskRecord.status = "fix_proposed";
    this.taskRecord.provider = execution.response.provider;
    this.taskRecord.model = execution.response.model;
    this.taskRecord.proposalSummary = execution.proposal.summary;
    this.taskRecord.patchDiff = this.patch.diff;
    this.taskRecord.spokenDiffSummary = patchSummary.spoken;
    this.taskRecord.commands = execution.proposal.commands;
    this.taskRecord.cost.actualInputTokens += execution.response.inputTokens;
    this.taskRecord.cost.actualOutputTokens += execution.response.outputTokens;
    this.taskRecord.cost.actualEstimatedCostUsd +=
      execution.actualEstimatedCostUsd;
    await this.taskStore.save(this.taskRecord);
    this.post({
      type: "response",
      text: execution.proposal.summary,
      provider: execution.response.provider,
      model: execution.response.model,
      hasPatch: true,
      diff: this.patch.diff,
      spokenDiffSummary: patchSummary.spoken
    });
    this.postRuntimeState("awaiting_confirmation", patchSummary.spoken);
  }

  private async completeTask(): Promise<void> {
    if (!this.pending || !this.taskRecord || !this.taskStore) return;
    const final = finalizeTask(
      this.pending.plan,
      this.proposal,
      this.taskRecord.commandResults
    );
    this.taskRecord.status = "completed";
    this.taskRecord.lifecycle = completeTaskLifecycle(
      this.taskRecord.lifecycle,
      "Task finalized with technical summary and commit suggestion."
    );
    this.taskRecord.finalSummary = final.summary;
    this.taskRecord.commitSuggestion = final.commitSuggestion;
    await this.taskStore.save(this.taskRecord);
    this.postLifecycle();
    await this.persistSharedMemory(final.summary);
    this.post({
      type: "final",
      summary: final.summary,
      commitSuggestion: final.commitSuggestion,
      cost: this.taskRecord.cost
    });
  }

  private isAutonomousSynapse(): boolean {
    return Boolean(
      this.pending?.snapshot.synapseDetected &&
      vscode.workspace
        .getConfiguration("adonex")
        .get<boolean>("synapse.autonomous", false)
    );
  }

  private requiresWriteApproval(): boolean {
    return vscode.workspace
      .getConfiguration("adonex")
      .get<boolean>("security.requireApprovalBeforeWrite", true);
  }

  private requiresCommandApproval(): boolean {
    return vscode.workspace
      .getConfiguration("adonex")
      .get<boolean>("security.requireApprovalBeforeCommand", true);
  }

  private async runAutonomousSynapse(): Promise<void> {
    if (!this.pending) return;
    this.post({
      type: "status",
      text: "Modo autonomo Synapse ativo. Bloqueios de secrets, caminhos e comandos perigosos permanecem ativos."
    });
    if (this.pending.action === "test") {
      await this.runTests();
      return;
    }

    await this.executePending();
    if (!this.patch?.changes.length) {
      if (this.pending.plan.commands.length) await this.runTests();
      return;
    }
    if (this.applyMode === "prepare") {
      this.postRuntimeState(
        "awaiting_confirmation",
        "Patch prepared. Apply it from the panel or by a confirmed voice command."
      );
      return;
    }

    await this.applyPatch();
    if (await this.runTests()) return;

    this.post({
      type: "status",
      text: "A validacao falhou. Gerando uma unica correcao automatica."
    });
    await this.fixFromError();
    await this.applyPatch();
    await this.runTests();
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  /**
   * Modo pensativo: cada passo do pipeline vira uma linha na bolha "pensando"
   * do chat (ou no status do Composer). Narracao gerada pelo host, custo zero.
   */
  private postStep(text: string): void {
    this.post({ type: "step", text });
  }

  /** Texto incremental do chat principal (ver onChunk em sendLocalChat). */
  private postStreamChunk(text: string): void {
    this.post({ type: "streamChunk", text });
  }

  /**
   * Passo estruturado do Tool Loop: complementa o canal `step` (texto livre,
   * ja tratado acima) com nome da ferramenta e resumo do resultado, para o
   * webview renderar uma linha por chamada em vez de so uma frase narrada.
   */
  private postToolStep(step: {
    index: number;
    tool: string;
    argsSummary: string;
    resultSummary: string;
    ok: boolean;
    timestamp: string;
  }): void {
    this.post({ type: "toolStep", ...step });
  }

  private postVickStatus(status: {
    state: VickVoiceState;
    text: string;
    wakeWord: string;
    engine: string;
    muted: boolean;
    enabled: boolean;
  }): void {
    this.post({
      type: "vickState",
      state: status.state,
      text: status.text,
      wakeWord: status.wakeWord,
      engine: status.engine,
      muted: status.muted,
      enabled: status.enabled
    });
  }

  private postRuntimeState(
    state:
      | "idle"
      | "listening"
      | "thinking"
      | "editing"
      | "validating"
      | "awaiting_confirmation"
      | "cancelled",
    text: string
  ): void {
    this.post({ type: "voiceState", state, text });
    this.post({ type: "status", text });
    this.postVickStatus(this.vick.setState(state, text));
  }

  private postLifecycle(): void {
    if (!this.taskRecord?.lifecycle) return;
    this.post({ type: "lifecycle", lifecycle: this.taskRecord.lifecycle });
  }

  private ensureNotCancelled(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error("AdoneX task was cancelled.");
    }
  }

  private async persistSharedMemory(summary: string): Promise<void> {
    if (!this.pending || !this.taskRecord) return;
    const configuration = vscode.workspace.getConfiguration("adonex");
    if (
      !configuration.get<boolean>("memory.enabled", true) ||
      !configuration.get<boolean>("memory.createTaskLogAfterTask", true)
    ) {
      return;
    }
    if (
      configuration.get<boolean>("memory.askBeforeUpdate", true) &&
      !(await requestApproval(
        "Update shared project memory?",
        `Task: ${this.pending.task}\n\nAdoneX will append a task log and development update. Existing history will be preserved.`,
        "Update Memory"
      ))
    ) {
      return;
    }
    const changedFiles = [
      ...(this.proposal?.changes.map((change) => change.path) ?? []),
      ...(this.proposal?.operations?.map((operation) => operation.path) ?? [])
    ].filter((file, index, all) => all.indexOf(file) === index);
    const update = inferUpdateFromText(summary, changedFiles, "adonex");
    const writer = new MemoryWriter(this.pending.snapshot.root);
    await writer.appendDevelopmentLog(update);
    await writer.appendAgentChangelog(update);
    await writer.updateCurrentState(`# Current State

Last updated: ${new Date().toISOString()}
Source: AdoneX

## Last Completed Task

${summary}

## Files Changed

${changedFiles.map((file) => `- ${file}`).join("\n") || "- None"}

## Next Steps

${update.nextSteps.map((step) => `- ${step}`).join("\n") || "- Review task outcome"}
`);
    const log: MemoryTaskLog = {
      id: this.taskRecord.id,
      title: this.pending.task.slice(0, 120),
      date: new Date().toISOString(),
      tool: "adonex",
      status: this.taskRecord.status,
      objective: this.pending.task,
      context: this.taskRecord.selectedFiles.map((file) => file.path),
      plan: [
        ...this.pending.plan.filesToChange.map((file) => `Change ${file}`),
        ...this.pending.plan.commands.map((command) => `Validate with ${command}`)
      ],
      filesRead: this.taskRecord.selectedFiles.map((file) => file.path),
      filesChanged: changedFiles,
      commandsRun: this.taskRecord.commandResults.map((result) => result.command),
      decisions: update.decisionsAdded,
      problems: update.issuesOpened,
      result: summary,
      nextSteps: update.nextSteps
    };
    await writer.appendTaskLog(log);
  }

  private defaultMode(): AgentMode {
    const configured = vscode.workspace
      .getConfiguration("adonex")
      .get<string>("agent.defaultMode", "auto");
    return normalizeConfiguredAgentMode(configured);
  }

  private resolveMode(
    prompt: string,
    action: AgentAction,
    route: { mode: AgentMode; governed: boolean },
    requestedMode?: AgentMode
  ): Exclude<AgentMode, "auto"> {
    return resolveAgentMode(prompt, action, route, requestedMode);
  }

  private patchApplyMode(): "prepare" | "apply" {
    return vscode.workspace
      .getConfiguration("adonex")
      .get<"prepare" | "apply">("patch.applyMode", "prepare");
  }

  private configureVickFromWorkspace(): void {
    const configuration = vscode.workspace.getConfiguration("adonex");
    this.vickLocalService.configure(
      configuration.get<string>("voice.localServiceUrl", "http://127.0.0.1:8765")
    );
    this.vick.configure({
      enabled: configuration.get<boolean>("voice.enabled", true),
      wakeWord: configuration.get<string>("voice.wakeWord", "Vick"),
      engine: configuration.get<
        "simulated" | "local_service" | "openwakeword" | "vosk" | "faster_whisper"
      >("voice.engine", "simulated"),
      listenSeconds: configuration.get<number>("voice.commandListenSeconds", 8)
    });
  }

  private vickAutoStart(): boolean {
    return vscode.workspace
      .getConfiguration("adonex")
      .get<boolean>("voice.startWithVSCode", true);
  }

  private vickRequiresPatchConfirmation(): boolean {
    return vscode.workspace
      .getConfiguration("adonex")
      .get<boolean>("voice.requireConfirmationForPatch", true);
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "media",
        "main.js"
      )
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "media",
        "style.css"
      )
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "adonex.svg")
    );
    const nonce = getNonce();
    const defaultMode = this.defaultMode();
    const selected = (mode: AgentMode): string =>
      defaultMode === mode ? " selected" : "";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>AdoneX</title>
</head>
<body>
  <header>
    <div class="titlebar">
      <img class="logo" src="${logoUri}" alt="" aria-hidden="true" />
      <span class="brand">AdoneX</span>
      <div class="local-badge" title="Execucao 100% local via Ollama, sem chamada de LLM externo. Orquestrado pelos 60 agentes do ruflo.">
        <span class="local-dot" aria-hidden="true"></span>
        <span class="local-label">100% local</span>
        <span id="activeModel" class="local-model">Ollama</span>
        <span id="costBadge" class="local-cost">US$ 0,00</span>
      </div>
    </div>
    <div class="toolbar">

      <select id="mode" aria-label="Agent mode">
        <option value="auto"${selected("auto")}>Auto</option>
        <option value="local"${selected("local")}>Local / Ollama</option>
        <option value="synapse"${selected("synapse")}>Synapse Mode</option>
      </select>
    </div>
  </header>
  <main>
    <section id="history" aria-live="polite">
      <div class="empty-state">
        <img class="empty-logo" src="${logoUri}" alt="" aria-hidden="true" />
        <p>Converse diretamente com o modelo local. As respostas rodam 100% no Ollama.</p>
      </div>
    </section>
    <section id="composerView" class="composer-view" hidden aria-label="Composer multi-arquivo">
      <div class="composer-intro" hidden>
        <strong>Composer multi-arquivo</strong>
        <p>Descreva a solucao ou feature. O AdoneX planeja, gera e deixa voce revisar e aplicar as mudancas arquivo a arquivo, 100% local.</p>
      </div>
      <textarea id="composerGoal" hidden rows="4" placeholder="Ex.: crie um endpoint FastAPI /health com teste e registre no roteador principal..."></textarea>
      <div class="composer-actions" hidden>
        <button id="composerGenerate" class="primary" type="button">Gerar proposta</button>
        <button id="composerCancel" class="ghost" type="button" hidden>Cancelar</button>
      </div>
      <div id="composerStatus" class="composer-status" hidden></div>
      <div id="composerResult" class="composer-result" hidden>
        <div class="composer-summary">
          <span id="composerSummary"></span>
          <span id="composerStats" class="composer-stats"></span>
        </div>
        <div class="composer-select-row">
          <label class="composer-selectall"><input id="composerSelectAll" type="checkbox" checked /> Selecionar todos</label>
          <span id="composerModel" class="composer-model"></span>
        </div>
        <div id="composerFiles" class="composer-files"></div>
        <div id="composerCommands" class="composer-commands" hidden></div>
        <div class="composer-apply-row">
          <button id="composerApply" class="primary" type="button">Aplicar selecionados</button>
          <button id="composerUndo" class="ghost" type="button" hidden>Reverter</button>
          <button id="composerDiscard" class="ghost" type="button">Descartar</button>
        </div>
        <div class="composer-refine">
          <textarea id="composerRefineInput" rows="2" placeholder="Refinar: ex. adicione testes, renomeie X, trate erros..."></textarea>
          <button id="composerRefine" class="secondary" type="button">Refinar proposta</button>
        </div>
      </div>
    </section>
  </main>
  <section id="memoryPanel" class="memory-panel" hidden aria-label="Historico compartilhado">
    <div class="memory-panel-header">
      <div><strong>Continuidade compartilhada</strong><small>Codex · Claude Code · AdoneX</small></div>
      <button id="closeMemory" class="icon-button" type="button" aria-label="Fechar historico">×</button>
    </div>
    <p class="memory-help">Selecione uma tarefa. Pendencias aparecem primeiro e podem continuar nos modelos locais do AdoneX.</p>
    <div id="memoryHistory" class="memory-history"></div>
    <button id="resumeTask" class="primary" type="button" disabled>Continuar com AdoneX local</button>
  </section>
  <footer class="composer">
    <div class="composer-input-row">
      <textarea id="prompt" rows="3" placeholder="Converse, peça alterações ou implemente recursos... use @ para citar arquivos"></textarea>
    </div>
    <div class="composer-action-row">
      <div class="composer-context-actions">
      <button id="attach" class="icon-button" type="button" aria-label="Carregar arquivos e imagens" title="Carregar arquivos e imagens"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6.5 8.9 14.1a3 3 0 0 0 4.2 4.2l7.1-7.1a5 5 0 0 0-7.1-7.1L5.6 11.6a7 7 0 0 0 9.9 9.9l5.3-5.3"/></svg></button>
      <button id="mention" class="icon-button mention-button" type="button" aria-label="Adicionar contexto por mencao" title="Adicionar contexto: @arquivo, @selection, @file">@</button>
      <button id="memory" class="icon-button" type="button" aria-label="Abrir memoria compartilhada" title="Memoria compartilhada: AdoneX, Claude Code e Codex"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z"/><path d="M9 13h6M12 10v6"/></svg></button>
      <button id="clearHistory" class="icon-button" type="button" aria-label="Limpar historico de mensagens" title="Limpar historico de mensagens"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"/></svg></button>
      </div>
      <button id="send" class="primary" type="button" aria-label="Enviar mensagem">Enviar</button>
    </div>
    <div id="attachments" class="attachment-strip" hidden></div>
    <div id="estimate">Estimated input: 0 tokens</div>
  </footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isUserCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function isGovernedAction(action: AgentAction): boolean {
  return ["implement", "fix", "test", "synapse_agent", "synapse_mcp"].includes(action);
}

function getNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

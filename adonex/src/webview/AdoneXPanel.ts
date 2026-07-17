import * as vscode from "vscode";
import { AgentOrchestrator } from "../agent/agentOrchestrator";
import { CommandRunner } from "../execution/commandRunner";
import type {
  AgentAction,
  AgentMode,
  CommandResult,
  GeneratedPatch,
  ImplementationProposal,
  TaskRecord,
  TaskPlan,
  WorkspaceSnapshot
} from "../llm/types";
import { PatchEngine } from "../patch/patchEngine";
import { summarizePatchForSpeech } from "../patch/patchSummary";
import { requestApproval } from "../security/approvalGate";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { inferUpdateFromText } from "../memory/memorySummarizer";
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
import { resolveChatPrompt, routeChatCommand } from "../chat/chatRouting";
import { evidenceFromSnapshot, guardAgainstLocalHallucinations } from "../chat/hallucinationGuard";
import { sanitizeAdoneXResponse } from "../chat/responseSanitizer";
import { VickVoiceSession, type VickVoiceState } from "../voice/vickVoice";
import { VickLocalServiceClient } from "../voice/vickLocalService";

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
  private applyMode: "prepare" | "apply" = "prepare";
  private readonly orchestrator: AgentOrchestrator;
  private readonly patchEngine = new PatchEngine();
  private readonly commandRunner = new CommandRunner();
  private readonly vick = new VickVoiceSession();
  private readonly vickLocalService = new VickLocalServiceClient(
    "http://127.0.0.1:8765",
    async (event) => this.simulateVickCommand(`Vick ${event.command}`)
  );

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.orchestrator = new AgentOrchestrator(context);
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "webview", "media")
      ]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (message: { type: string; task?: string; action?: AgentAction; mode?: AgentMode }) =>
        void this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );
    this.configureVickFromWorkspace();
    this.postVickStatus(this.vick.status());
    if (this.vickAutoStart()) {
      void this.startVickVoice(false);
    }
  }

  public async reveal(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.adonex");
    this.view?.show?.(true);
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
      mode ?? this.defaultMode(),
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
  }): Promise<void> {
    try {
      if (message.type === "plan" && message.task && message.action && message.mode) {
        await this.createPlan(message.task, message.action, message.mode);
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
      if (this.taskRecord && this.taskStore) {
        this.taskRecord.status = "failed";
        this.taskRecord.error =
          error instanceof Error ? error.message : String(error);
        await this.taskStore.save(this.taskRecord);
      }
      this.post({
        type: "error",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async createPlan(
    task: string,
    action: AgentAction,
    mode: AgentMode,
    applyMode?: "prepare" | "apply"
  ): Promise<void> {
    const safeTask = scanAndRedactSecrets(task).redacted;
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
      { signal: this.abortController?.signal }
    );
    this.ensureNotCancelled();
    this.proposal = execution.proposal;
    this.taskRecord.lifecycle = activateTaskPhase(
      this.taskRecord.lifecycle,
      "observe",
      `Received response from ${execution.response.provider}/${execution.response.model}.`
    );
    this.patch = execution.proposal
      ? await this.patchEngine.generate(
          execution.proposal.changes,
          execution.proposal.operations
        )
      : undefined;
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
      hasPatch: Boolean(execution.proposal?.changes.length),
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
    const receipt = await this.patchEngine.apply(
      this.patch,
      true,
      this.requiresWriteApproval()
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
    const commands = [
      ...(this.proposal?.commands ?? []),
      ...this.pending.plan.commands
    ].filter(
      (command, index, all) =>
        !command.startsWith("Review") && all.indexOf(command) === index
    );
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
        requireApproval
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
      { signal: this.abortController?.signal }
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
    return vscode.workspace
      .getConfiguration("adonex")
      .get<AgentMode>("agent.defaultMode", "local");
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
    const nonce = getNonce();
    const defaultMode = this.defaultMode();
    const selected = (mode: AgentMode): string =>
      defaultMode === mode ? " selected" : "";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>AdoneX</title>
</head>
<body>
  <header>
    <div class="brand">AdoneX</div>
    <select id="mode" aria-label="Agent mode">
      <option value="economic"${selected("economic")}>Economic</option>
      <option value="balanced"${selected("balanced")}>Local Balanced</option>
      <option value="strong"${selected("strong")}>Local Strong</option>
      <option value="local"${selected("local")}>Local / Ollama</option>
      <option value="synapse"${selected("synapse")}>Synapse Mode</option>
    </select>
  </header>
  <main>
    <section id="synapseStatus" class="synapse-status" hidden></section>
    <section id="vickCockpit" class="vick-cockpit" aria-live="polite">
      <div class="vick-meter" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="vick-copy">
        <strong>Vick</strong>
        <span id="vickState">standby</span>
      </div>
      <div class="vick-actions">
        <button id="vickStart">Start</button>
        <button id="vickMute">Mute</button>
        <button id="vickSimulate">Voice Command</button>
        <button id="vickStop">Stop</button>
      </div>
    </section>
    <section id="history" aria-live="polite"></section>
    <section id="lifecycle" class="lifecycle" hidden>
      <h2>Agentic Lifecycle</h2>
      <div id="lifecycleSteps" class="lifecycle-steps"></div>
    </section>
    <section class="composer">
      <textarea id="prompt" rows="6" placeholder="Describe an engineering task..."></textarea>
      <div id="estimate">Estimated input: 0 tokens</div>
      <div class="actions">
        <button data-action="plan">Plan</button>
        <button data-action="implement">Implement</button>
        <button data-action="review">Review</button>
        <button data-action="test">Test</button>
        <button data-action="document">Document</button>
      </div>
    </section>
    <section id="plan" hidden>
      <h2>Plan</h2>
      <pre id="planText"></pre>
      <div class="actions">
        <button id="approve" class="primary">Approve</button>
        <button id="reject">Reject</button>
        <button id="cancelPlan">Cancel</button>
      </div>
    </section>
    <section id="diff" hidden>
      <h2>Patch</h2>
      <div id="diffText" class="diff-view"></div>
      <div class="actions">
        <button id="previewPatch">Open Diff</button>
        <button id="applyPatch" class="primary">Apply Patch</button>
        <button id="undoPatch">Undo Last Patch</button>
        <button id="runTests">Run Tests</button>
      </div>
    </section>
    <section id="validation" hidden>
      <h2>Validation</h2>
      <pre id="validationText"></pre>
      <div class="actions">
        <button id="runTestsStandalone">Run Tests</button>
        <button id="fixFromError" hidden>Generate Fix</button>
      </div>
    </section>
    <section id="final" hidden>
      <h2>Technical Summary</h2>
      <pre id="finalSummary"></pre>
      <h2>Suggested Commit</h2>
      <pre id="commitSuggestion"></pre>
      <pre id="taskCost"></pre>
    </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}




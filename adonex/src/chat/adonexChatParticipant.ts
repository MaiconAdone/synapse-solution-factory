import * as vscode from "vscode";
import { AgentOrchestrator } from "../agent/agentOrchestrator";
import type { AgentAction, AgentMode, TaskPlan, WorkspaceSnapshot } from "../llm/types";
import {
  isIgnoredContextPath,
  isSensitivePath,
  scanAndRedactSecrets
} from "../security/secretScanner";
import type { AdoneXPanel } from "../webview/AdoneXPanel";
import { MEMORY_COMMANDS } from "../memory/memoryCommands";
import { ProjectMemory } from "../memory/projectMemory";
import {
  ADONEX_CHAT_PARTICIPANT_ID,
  checkSolutionFactoryDialog,
  isCreationRoute,
  parseChatInput,
  renderSolutionFactoryMissingInfo,
  resolveChatPrompt,
  routeChatCommand
} from "./chatRouting";
import { createLocalFallbackResponse } from "./fallbackResponse";
import { formatTaskResult } from "./taskResultFormatter";
import { sanitizeAdoneXResponse } from "./responseSanitizer";
import { evidenceFromSnapshot, guardAgainstLocalHallucinations } from "./hallucinationGuard";

const GOVERNED_TASK_COMMAND = "adonex.chat.openGovernedTask";

export function registerAdoneXChatParticipant(
  context: vscode.ExtensionContext,
  panel: AdoneXPanel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      GOVERNED_TASK_COMMAND,
      async (task: string, action: AgentAction, mode: AgentMode) => {
        await panel.queueTask(task, action, mode);
      }
    )
  );

  const orchestrator = new AgentOrchestrator(context);
  const handler: vscode.ChatRequestHandler = async (
    request,
    chatContext,
    stream,
    token
  ) => {
    const parsed = parseChatInput(request.command, request.prompt);
    if (await handleMemoryCommand(parsed.command, parsed.prompt, stream)) {
      return { metadata: { action: parsed.command, memory: true } };
    }
    const route = routeChatCommand(parsed.command, parsed.prompt);
    const rawPrompt = resolveChatPrompt(parsed.prompt, route);
    if (!rawPrompt) {
      stream.markdown(
        isCreationRoute(route)
          ? "Descreva o objetivo, entradas, saidas e limites da solucao."
          : "Descreva a tarefa de engenharia que deseja analisar."
      );
      return { metadata: { action: route.action, missingPrompt: true } };
    }

    const task = scanAndRedactSecrets(
      appendBoundedContext(rawPrompt, request.references, chatContext)
    ).redacted;
    await recordSharedChatMemory(rawPrompt, "received", [
      `route=${route.action}`,
      `mode=${route.mode}`
    ]);
    const briefingCheck = checkSolutionFactoryDialog(rawPrompt, route);
    if (briefingCheck.missingFields.length) {
      await recordSharedChatMemory(rawPrompt, "waiting-for-user", [
        `missing=${briefingCheck.missingFields.join(",")}`,
        ...briefingCheck.questions
      ]);
      stream.markdown(renderSolutionFactoryMissingInfo(briefingCheck));
      return {
        metadata: {
          action: route.action,
          solutionFactoryBriefing: true,
          missingFields: briefingCheck.missingFields
        }
      };
    }

    let currentPlan: TaskPlan | undefined;
    let currentSnapshot: WorkspaceSnapshot | undefined;
    try {
      stream.progress("Selecionando arquivos relevantes...");
      const { plan, snapshot } = await orchestrator.createPlan(
        task,
        route.action,
        route.mode
      );
      currentPlan = plan;
      currentSnapshot = snapshot;
      if (token.isCancellationRequested) return;

      addFileReferences(stream, snapshot.root, plan);
      stream.markdown(planSummary(route.title, plan, snapshot.synapseDetected));

      if (route.governed) {
        if (
          plan.recommendedExecution === "codex-recommended" &&
          vscode.workspace
            .getConfiguration("adonex")
            .get<boolean>("router.codexRecommendedForComplexTasks", true)
        ) {
          stream.markdown(
            "\nEsta tarefa foi classificada como complexa. Codex e recomendado para a implementacao multi-arquivo ou transversal."
          );
          stream.button({
            command: MEMORY_COMMANDS.generateCodexPrompt,
            title: "Gerar handoff para Codex",
            arguments: [task]
          });
        }
        stream.markdown(
          snapshot.synapseDetected
            ? "\nExecutando automaticamente no Synapse. O resultado sera publicado nesta conversa."
            : "\nA tarefa foi preparada no AdoneX e permanece sujeita as configuracoes de aprovacao."
        );
        stream.progress("Executando a tarefa pelo AdoneX...");
        const record = await panel.queueTask(task, route.action, route.mode, {
          reveal: !snapshot.synapseDetected
        });
        if (record) {
          stream.markdown(`\n\n${formatTaskResult(record)}`);
          await recordSharedChatMemory(rawPrompt, record.status, [
            `task=${record.id}`,
            `files=${record.selectedFiles.map((file) => file.path).slice(0, 5).join(", ")}`
          ]);
        }
        return {
          metadata: {
            action: route.action,
            governed: true,
            status: record?.status,
            estimatedCostUsd:
              record?.cost.actualEstimatedCostUsd ?? plan.estimatedCostUsd
          }
        };
      }

      stream.progress("Consultando o Ollama local...");
      const execution = await orchestrator.executeApproved(
        task,
        route.action,
        localMode(route.mode, snapshot.synapseDetected),
        plan,
        snapshot
      );
      if (token.isCancellationRequested) return;

      const responseText = guardAgainstLocalHallucinations(
        sanitizeAdoneXResponse(execution.response.text),
        evidenceFromSnapshot(snapshot, plan.commands)
      );
      stream.markdown(`\n\n${responseText}`);
      await recordSharedChatMemory(rawPrompt, "answered", [
        `provider=${execution.response.provider}`,
        `model=${execution.response.model}`
      ]);
      stream.markdown(
        `\n\n_Provider: ${execution.response.provider} | Modelo: ${execution.response.model} | Custo cloud estimado: $${execution.actualEstimatedCostUsd.toFixed(6)}_`
      );
      return {
        metadata: {
          action: route.action,
          governed: false,
          provider: execution.response.provider,
          model: execution.response.model,
          estimatedCostUsd: execution.actualEstimatedCostUsd
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        currentPlan &&
        currentSnapshot &&
        ["chat", "synapse_explain"].includes(route.action) &&
        /ollama|request exceeded|timeout|abort|fetch failed/i.test(message)
      ) {
        stream.markdown(
          sanitizeAdoneXResponse(createLocalFallbackResponse(rawPrompt, currentSnapshot, currentPlan, message))
        );
        return {
          metadata: {
            action: route.action,
            fallback: true,
            error: message
          }
        };
      }
      stream.markdown(`Nao foi possivel concluir pelo AdoneX local: ${message}`);
      stream.button({
        command: "adonex.ollama.testConnection",
        title: "Testar conexao AdoneX/Ollama"
      });
      return { errorDetails: { message } };
    }
  };

  const participant = vscode.chat.createChatParticipant(
    ADONEX_CHAT_PARTICIPANT_ID,
    handler
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "adonex.svg"
  );
  participant.followupProvider = {
    provideFollowups(result) {
      const action = String(result.metadata?.action ?? "");
      if (["implement", "synapse_agent", "synapse_mcp", "test"].includes(action)) {
        return [];
      }
      return [
        {
          prompt: "Transforme a recomendacao em um plano de implementacao.",
          label: "Criar plano",
          command: "plan"
        },
        {
          prompt: "Revise os riscos e testes necessarios.",
          label: "Revisar riscos",
          command: "review"
        }
      ];
    }
  };
  context.subscriptions.push(participant);
}

async function recordSharedChatMemory(
  objective: string,
  status: string,
  notes: string[] = []
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !objective.trim()) return;
  const configuration = vscode.workspace.getConfiguration("adonex");
  if (!configuration.get<boolean>("memory.enabled", true)) return;
  try {
    const memory = new ProjectMemory(
      root,
      configuration.get<number>("memory.maxDiffChars", 60_000),
      configuration.get<number>("memory.maxFileChars", 20_000)
    );
    await memory.initialize();
    await memory.writer.appendSharedDialogEntry({
      source: "vscode-chat",
      objective: objective.trim().slice(0, 2000),
      status,
      notes
    });
    await memory.writer.appendChatTask({
      source: "vscode-chat",
      objective: objective.trim().slice(0, 1000),
      status,
      notes: notes.join("; ").slice(0, 500)
    });
  } catch {
    // Shared memory must not block the chat response path.
  }
}

function localMode(mode: AgentMode, synapseDetected: boolean): AgentMode {
  return mode === "synapse" || synapseDetected ? "synapse" : "local";
}

function appendBoundedContext(
  prompt: string,
  references: readonly vscode.ChatPromptReference[],
  context: vscode.ChatContext
): string {
  const history = context.history
    .filter(
      (turn): turn is vscode.ChatRequestTurn =>
        "prompt" in turn && typeof turn.prompt === "string"
    )
    .slice(-2)
    .map((turn) => turn.prompt.trim().slice(0, 800))
    .filter(Boolean);
  const referencePaths = references
    .map(referencePath)
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isSensitivePath(value))
    .filter((value) => !isIgnoredContextPath(value))
    .slice(0, 8);
  return [
    prompt.trim(),
    history.length ? `Recent user context:\n${history.join("\n")}` : "",
    referencePaths.length
      ? `Attached workspace references:\n${referencePaths.join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function referencePath(reference: vscode.ChatPromptReference): string | undefined {
  const value = reference.value;
  const uri =
    value instanceof vscode.Uri
      ? value
      : value instanceof vscode.Location
        ? value.uri
        : undefined;
  return uri ? vscode.workspace.asRelativePath(uri, false) : undefined;
}

function addFileReferences(
  stream: vscode.ChatResponseStream,
  root: string,
  plan: TaskPlan
): void {
  for (const relativePath of plan.filesToRead.slice(0, 8)) {
    if (isSensitivePath(relativePath) || isIgnoredContextPath(relativePath)) continue;
    stream.reference(vscode.Uri.joinPath(vscode.Uri.file(root), relativePath));
  }
}

function planSummary(
  title: string,
  plan: TaskPlan,
  synapseDetected: boolean
): string {
  const files = plan.filesToRead.slice(0, 8);
  return [
    `### ${title}`,
    "",
    `- Modo: \`${plan.mode}\``,
    `- Synapse detectado: ${synapseDetected ? "sim" : "nao"}`,
    `- Contexto estimado: ${plan.estimatedInputTokens} tokens`,
    `- Custo cloud estimado: $${plan.estimatedCostUsd.toFixed(6)}`,
    `- Rota recomendada: \`${plan.recommendedExecution ?? "adonex-local"}\``,
    `- Arquivos selecionados: ${files.length}`,
    files.length ? files.map((file) => `  - \`${file}\``).join("\n") : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleMemoryCommand(
  requestedCommand: string | undefined,
  prompt: string,
  stream: vscode.ChatResponseStream
): Promise<boolean> {
  const commands: Record<string, string> = {
    memoria: MEMORY_COMMANDS.summary,
    status: MEMORY_COMMANDS.readCurrentState,
    "sync-memoria": MEMORY_COMMANDS.sync,
    snapshot: MEMORY_COMMANDS.snapshot,
    "handoff-codex": MEMORY_COMMANDS.generateCodexPrompt,
    "importar-codex": MEMORY_COMMANDS.importCodexResult,
    "registrar-tarefa": MEMORY_COMMANDS.registerTask,
    decisao: MEMORY_COMMANDS.addDecision,
    pendencia: MEMORY_COMMANDS.addIssue,
    "resolver-pendencia": MEMORY_COMMANDS.resolveIssue
  };
  const command = requestedCommand ? commands[requestedCommand] : undefined;
  if (!command) return false;
  stream.progress("Atualizando a memoria compartilhada do projeto...");
  try {
    const result = await vscode.commands.executeCommand<unknown>(
      command,
      prompt.trim() || undefined
    );
    stream.markdown(
      typeof result === "string"
        ? result
        : "Operacao de memoria concluida."
    );
  } catch (error) {
    stream.markdown(
      `Operacao de memoria nao concluida: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return true;
}

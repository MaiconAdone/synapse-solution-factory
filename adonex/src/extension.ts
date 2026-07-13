import * as vscode from "vscode";
import { registerAdoneXChatParticipant } from "./chat/adonexChatParticipant";
import { WorkspaceContext } from "./context/workspaceContext";
import { CostGuard } from "./cost/costGuard";
import { OllamaClient } from "./llm/ollamaClient";
import { normalizeOllamaBaseUrl } from "./llm/ollamaEndpoint";
import { ADONEX_FAST_LOCAL_MODEL, normalizeLocalModel } from "./llm/localModels";
import type { AgentAction, AgentMode } from "./llm/types";
import {
  ensureSynapsePeersMcp,
  peerMessagingDocsPath
} from "./synapse/peerMessagingConfig";
import { registerMemoryCommands } from "./memory/memoryCommands";
import { AdoneXPanel } from "./webview/AdoneXPanel";

export function activate(context: vscode.ExtensionContext): void {
  const panel = new AdoneXPanel(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AdoneXPanel.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  registerAdoneXChatParticipant(context, panel);
  registerMemoryCommands(context);

  const register = (
    command: string,
    callback: (...args: unknown[]) => unknown
  ): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register("adonex.openChat", () => panel.reveal());
  register("adonex.voice.vick.start", () => panel.startVickVoice());
  register("adonex.voice.vick.stop", () => panel.stopVickVoice());
  register("adonex.voice.vick.toggleMute", () => panel.toggleVickMute());
  register("adonex.voice.vick.simulateCommand", () => panel.simulateVickCommand());
  register("adonex.ollama.testConnection", async () => {
    const configuration = vscode.workspace.getConfiguration("adonex");
    const baseUrl = normalizeOllamaBaseUrl(
      configuration.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")
    );
    const model = configuration.get<string>(
      "ollama.model",
      ADONEX_FAST_LOCAL_MODEL
    );
    const selectedModel = normalizeLocalModel(model, ADONEX_FAST_LOCAL_MODEL);
    try {
      const response = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `AdoneX: testing ${selectedModel} at ${baseUrl}`,
          cancellable: false
        },
        () =>
          new OllamaClient({
            baseUrl,
            model: selectedModel,
            apiStyle: configuration.get<"chat" | "generate">(
              "ollama.apiStyle",
              "chat"
            ),
            timeoutMs: configuration.get<number>(
              "ollama.timeoutSeconds",
              600
            ) * 1000,
            keepAlive: configuration.get<string>("ollama.keepAlive", "10m"),
            maxRetries: configuration.get<number>("ollama.maxRetries", 2),
            retryDelayMs: configuration.get<number>("ollama.retryDelayMs", 250)
          }).generate({
            systemPrompt: "Reply with exactly OK.",
            userPrompt: "AdoneX VS Code Extension Host connectivity test.",
            maxOutputTokens: 8
          })
      );
      void vscode.window.showInformationMessage(
        `AdoneX connected to Ollama (${response.model}).`
      );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      throw error;
    }
  });
  register("adonex.analyzeWorkspace", async () => {
    const task =
      (await vscode.window.showInputBox({
        title: "AdoneX workspace analysis",
        prompt: "Optional focus for file selection",
        placeHolder: "Architecture, authentication, RAG, tests..."
      })) ?? "Analyze the workspace architecture";
    const engine = new WorkspaceContext();
    const snapshot = await engine.collect(task);
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: [
        "# AdoneX Workspace Analysis",
        "",
        `- Root: ${snapshot.root}`,
        `- Stack: ${snapshot.stack.join(", ") || "unknown"}`,
        `- Synapse detected: ${snapshot.synapseDetected}`,
        `- Estimated context tokens: ${snapshot.estimatedTokens}`,
        "",
        "## Selected Files",
        "",
        ...snapshot.relevantFiles.map(
          (file) => `- ${file.path}${file.redacted ? " (redacted)" : ""}`
        ),
        "",
        "## Structure",
        "",
        "```text",
        ...snapshot.structure,
        "```"
      ].join("\n")
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  registerTaskCommand(register, panel, "adonex.planTask", "plan");
  registerTaskCommand(register, panel, "adonex.implementTask", "implement");
  registerTaskCommand(register, panel, "adonex.reviewCode", "review");
  registerTaskCommand(register, panel, "adonex.runTests", "test");
  registerTaskCommand(register, panel, "adonex.generateDocs", "document");
  registerSynapseCommands(register, panel);
  registerPeerMessagingCommands(register);

  register("adonex.explainSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open an editor and select code before asking AdoneX.");
      return;
    }
    const selection = editor.document.getText(editor.selection).trim();
    if (!selection) {
      void vscode.window.showInformationMessage("Select code before asking AdoneX.");
      return;
    }
    await panel.queueTask(
      `Explain this selection from ${vscode.workspace.asRelativePath(
        editor.document.uri
      )}:\n\n${selection}`,
      "explain"
    );
  });

  register("adonex.fixTerminalError", async () => {
    const error = await vscode.window.showInputBox({
      title: "AdoneX: Fix Terminal Error",
      prompt: "Paste the terminal error or failing command",
      ignoreFocusOut: true
    });
    if (error) await panel.queueTask(error, "fix");
  });

  register("adonex.createCommitMessage", async () => {
    await panel.queueTask(
      "Create a commit message for the current workspace changes. Use only available context and ask for missing diff details.",
      "commit"
    );
  });

  register("adonex.configureApiKey", async () => {
    const apiKey = await vscode.window.showInputBox({
      title: "Configure OpenAI API Key",
      prompt: "Stored securely in VS Code SecretStorage",
      password: true,
      ignoreFocusOut: true
    });
    if (!apiKey?.trim()) return;
    await context.secrets.store("adonex.openai.apiKey", apiKey.trim());
    void vscode.window.showInformationMessage(
      "AdoneX OpenAI API key stored in SecretStorage."
    );
  });

  register("adonex.resetCostUsage", async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a workspace before resetting usage.");
    const configuration = vscode.workspace.getConfiguration("adonex");
    const guard = new CostGuard(
      root,
      configuration.get<number>("cost.dailyBudgetUsd", 2),
      configuration.get<number>("cost.monthlyBudgetUsd", 20)
    );
    await guard.reset();
    void vscode.window.showInformationMessage("AdoneX cost usage was reset.");
  });

  register("adonex.runEvalSuite", async () => {
    const {
      createDefaultAdoneXEvalSuite,
      runEvalSuite,
      summarizeEvalResults
    } = await import("./evals/evalHarness.js");
    const suite = createDefaultAdoneXEvalSuite();
    const responses = Object.fromEntries(
      suite.map((entry: { id: string; prompt: string }) => [entry.id, `${entry.prompt}: sample response`])
    );
    const results = runEvalSuite(suite, responses);
    const summary = summarizeEvalResults(results);
    const details = results
      .map(
        (result: { id: string; passed: boolean; missingKeywords: string[] }) =>
          `${result.id}: ${result.passed ? "PASS" : "FAIL"} (${result.missingKeywords.join(", ") || "all keywords present"})`
      )
      .join("\n");
    void vscode.window.showInformationMessage(
      `AdoneX eval suite: ${summary.passed}/${suite.length} passed`
    );
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: [
        "# AdoneX Eval Suite",
        "",
        `- Passed: ${summary.passed}`,
        `- Failed: ${summary.failed}`,
        `- Score: ${(summary.score * 100).toFixed(0)}%`,
        "",
        "## Results",
        "",
        details
      ].join("\n")
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });

  startVickOnVsCodeStartup(panel);
}

export function deactivate(): void {}

function startVickOnVsCodeStartup(panel: AdoneXPanel): void {
  const configuration = vscode.workspace.getConfiguration("adonex");
  if (!configuration.get<boolean>("voice.startWithVSCode", true)) return;
  const autoOpenCockpit = configuration.get<boolean>(
    "voice.autoOpenCockpit",
    true
  );
  void panel.startVickVoice(autoOpenCockpit);
}

function registerTaskCommand(
  register: (
    command: string,
    callback: (...args: unknown[]) => unknown
  ) => void,
  panel: AdoneXPanel,
  command: string,
  action: AgentAction
): void {
  register(command, async () => {
    const task = await vscode.window.showInputBox({
      title: command.replace("adonex.", "AdoneX: "),
      prompt: "Describe the task",
      ignoreFocusOut: true
    });
    if (!task?.trim()) return;
    const mode = vscode.workspace
      .getConfiguration("adonex")
      .get<AgentMode>("agent.defaultMode", "local");
    await panel.queueTask(task.trim(), action, mode);
  });
}

function registerSynapseCommands(
  register: (
    command: string,
    callback: (...args: unknown[]) => unknown
  ) => void,
  panel: AdoneXPanel
): void {
  register("adonex.synapse.analyzeArchitecture", async () => {
    await panel.queueTask(
      "Analyze the complete Synapse architecture and prioritize concrete improvements for quality, modularity, security, observability, scalability, and low-cost AI operation.",
      "synapse_architecture",
      "synapse"
    );
  });
  register("adonex.synapse.createAgent", async () => {
    const objective = await vscode.window.showInputBox({
      title: "AdoneX Synapse Create Agent",
      prompt: "Describe the agent objective and business outcome",
      ignoreFocusOut: true
    });
    if (objective?.trim()) {
      await panel.queueTask(
        `Create a governed Synapse agent for this objective: ${objective.trim()}`,
        "synapse_agent",
        "synapse"
      );
    }
  });
  register("adonex.synapse.createMcpTool", async () => {
    const objective = await vscode.window.showInputBox({
      title: "AdoneX Synapse Create MCP Tool",
      prompt: "Describe the MCP tool, inputs, output, and allowed side effects",
      ignoreFocusOut: true
    });
    if (objective?.trim()) {
      await panel.queueTask(
        `Create a production-ready Synapse MCP tool: ${objective.trim()}`,
        "synapse_mcp",
        "synapse"
      );
    }
  });
  register("adonex.synapse.reviewPipeline", async () => {
    const focus =
      (await vscode.window.showInputBox({
        title: "AdoneX Synapse Review Pipeline",
        prompt: "Optional pipeline focus: RAG, ML, data, release, or full pipeline",
        placeHolder: "full pipeline",
        ignoreFocusOut: true
      })) ?? "full pipeline";
    await panel.queueTask(
      `Review the Synapse ${focus} pipeline and identify production, quality, cost, security, lineage, and observability gaps.`,
      "synapse_pipeline",
      "synapse"
    );
  });
  register("adonex.synapse.generateRoadmap", async () => {
    await panel.queueTask(
      "Generate a pragmatic Synapse product and engineering roadmap focused on AI quality, multi-agent governance, Ruflo, MCP, FastAPI, React, Postgres, MLflow, Jupyter, Ollama/OpenAI routing, automation, and cost reduction.",
      "synapse_roadmap",
      "synapse"
    );
  });
}

function registerPeerMessagingCommands(
  register: (
    command: string,
    callback: (...args: unknown[]) => unknown
  ) => void
): void {
  register("adonex.synapse.configurePeerMessaging", async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a workspace before configuring Synapse Peers.");
    const configuration = vscode.workspace.getConfiguration("adonex");
    const result = await ensureSynapsePeersMcp(root, {
      peerType: configuration.get<
        "codex" | "claude" | "adonex" | "ruflo" | "ollama" | "human" | "other"
      >("synapse.peerMessaging.peerType", "adonex"),
      dbPath: configuration.get<string>(
        "synapse.peerMessaging.dbPath",
        "./artifacts/peers/synapse-peers.db"
      ),
      maxMessageChars: configuration.get<number>(
        "synapse.peerMessaging.maxMessageChars",
        1200
      ),
      maxSummaryChars: configuration.get<number>(
        "synapse.peerMessaging.maxSummaryChars",
        360
      )
    });
    const action = result.created
      ? "created"
      : result.changed
        ? "updated"
        : "already configured";
    void vscode.window.showInformationMessage(
      `AdoneX Synapse Peers ${action}: ${result.serverName}`
    );
    return `Synapse Peers ${action}: ${result.path}`;
  });

  register("adonex.synapse.openPeerMessagingDocs", async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a workspace before opening Synapse Peers docs.");
    const uri = vscode.Uri.file(peerMessagingDocsPath(root));
    await vscode.commands.executeCommand("vscode.open", uri);
    return uri.fsPath;
  });
}

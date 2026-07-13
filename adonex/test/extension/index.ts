import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("synapse-ai.adonex");
  assert.ok(extension, "AdoneX was not discovered by the Extension Host.");
  await extension.activate();

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root, "Extension Host test workspace was not opened.");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "adonex.memory.init",
    "adonex.memory.summary",
    "adonex.memory.readCurrentState",
    "adonex.handoff.generateCodexPrompt",
    "adonex.handoff.importCodexResult",
    "adonex.ollama.testConnection",
    "adonex.synapse.configurePeerMessaging",
    "adonex.synapse.openPeerMessagingDocs"
  ]) {
    assert.ok(commands.includes(command), `Command is not registered: ${command}`);
  }

  const initialized = await vscode.commands.executeCommand<string>(
    "adonex.memory.init"
  );
  assert.match(initialized, /Shared memory initialized/);

  for (const relativePath of [
    "AGENTS.md",
    ".adonex/memory/PROJECT_MEMORY.md",
    ".adonex/memory/CURRENT_STATE.md",
    ".adonex/memory/CODING_STANDARDS.md"
  ]) {
    await fs.access(path.join(root, relativePath));
  }

  const summary = await vscode.commands.executeCommand<string>(
    "adonex.memory.summary"
  );
  const status = await vscode.commands.executeCommand<string>(
    "adonex.memory.readCurrentState"
  );
  assert.match(summary, /Project Memory/);
  assert.match(status, /Current State/);

  const ollama = await vscode.commands.executeCommand<{
    provider: string;
    model: string;
    text: string;
  }>("adonex.ollama.testConnection");
  assert.equal(ollama.provider, "ollama");
  assert.ok(ollama.model);
  assert.ok(ollama.text);

  const handoff = await vscode.commands.executeCommand<string>(
    "adonex.handoff.generateCodexPrompt",
    "Create a safe read-only MCP workspace tool"
  );
  assert.match(handoff, /Codex handoff generated/);
  const prompt = await fs.readFile(
    path.join(root, ".adonex/handoff/CODEX_PROMPT.md"),
    "utf8"
  );
  assert.match(prompt, /Create a safe read-only MCP workspace tool/);
  assert.match(prompt, /Post-Execution Instructions/);

  const packageJson = extension.packageJSON as {
    contributes?: {
      chatParticipants?: Array<{
        name?: string;
        commands?: Array<{ name?: string }>;
      }>;
    };
  };
  const participant = packageJson.contributes?.chatParticipants?.find(
    (item) => item.name === "adonex"
  );
  assert.ok(participant, "The @adonex Chat participant is not contributed.");
  const chatCommands = participant.commands?.map((command) => command.name) ?? [];
  for (const command of ["memoria", "status", "handoff-codex", "importar-codex"]) {
    assert.ok(chatCommands.includes(command), `Chat command missing: /${command}`);
  }
}

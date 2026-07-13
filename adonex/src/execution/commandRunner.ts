import * as vscode from "vscode";
import type { CommandResult } from "../llm/types";
import { requestApproval } from "../security/approvalGate";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { executeCapturedCommand } from "./capturedCommand";
import { assessCommand } from "./commandPolicy";

export class CommandRunner {
  public async run(command: string, name = "AdoneX"): Promise<void> {
    await this.approve(command);
    const terminal = vscode.window.createTerminal(name);
    terminal.show();
    terminal.sendText(command, true);
  }

  public async runCaptured(
    command: string,
    workspaceRoot: string,
    timeoutMs = 180_000,
    requireApproval = true
  ): Promise<CommandResult> {
    await this.approve(command, requireApproval);
    const output = vscode.window.createOutputChannel("AdoneX Tests");
    output.show(true);
    output.appendLine(`> ${command}`);
    const captured = await executeCapturedCommand(command, workspaceRoot, timeoutMs);
    const result = {
      ...captured,
      stdout: scanAndRedactSecrets(captured.stdout).redacted,
      stderr: scanAndRedactSecrets(captured.stderr).redacted
    };
    output.append(result.stdout);
    output.append(result.stderr);
    output.appendLine(`\n[AdoneX exit code: ${result.exitCode}]`);
    return result;
  }

  private async approve(command: string, requireApproval = true): Promise<void> {
    if (!scanAndRedactSecrets(command).safe) {
      throw new Error("AdoneX refuses to execute a command containing a possible secret.");
    }
    const assessment = assessCommand(command);
    if (!assessment.allowed) {
      throw new Error(assessment.reason);
    }
    if (
      requireApproval &&
      !(await requestApproval(
        `Run command with AdoneX?`,
        `${command}\n\n${assessment.reason}`,
        "Run Command"
      ))
    ) {
      throw new Error("Command execution was rejected.");
    }
  }
}

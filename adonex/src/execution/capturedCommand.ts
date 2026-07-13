import { exec } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { CommandResult } from "../llm/types";

const defaultExec = promisify(exec);

export type CapturedExec = (
  command: string,
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    shell: string;
  }
) => Promise<{ stdout: string; stderr: string }>;

export async function executeCapturedCommand(
  command: string,
  workspaceRoot: string,
  timeoutMs = 180_000,
  executor: CapturedExec = defaultExec
): Promise<CommandResult> {
  const started = performance.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let timedOut = false;
  try {
    const result = await executor(command, {
      cwd: workspaceRoot,
      timeout: timeoutMs,
      maxBuffer: 1_500_000,
      windowsHide: true,
      shell: process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh"
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const captured = error as Error & {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    stdout = captured.stdout ?? "";
    stderr = captured.stderr ?? captured.message;
    exitCode =
      typeof captured.code === "number"
        ? captured.code
        : captured.killed
          ? 124
          : 1;
    timedOut = Boolean(captured.killed) || /timed out/i.test(captured.message);
  }
  return {
    command,
    exitCode,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    durationMs: Math.round(performance.now() - started),
    timedOut
  };
}

function truncate(value: string, maxChars = 80_000): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[output truncated by AdoneX]`;
}

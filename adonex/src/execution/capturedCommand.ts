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
    signal?: AbortSignal;
  }
) => Promise<{ stdout: string; stderr: string }>;

export async function executeCapturedCommand(
  command: string,
  workspaceRoot: string,
  timeoutMs = 180_000,
  executor: CapturedExec = defaultExec,
  signal?: AbortSignal
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
      shell: process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh",
      ...(signal ? { signal } : {})
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    if (signal?.aborted) {
      // Cancelado pelo usuario (botao Parar): propaga como rejeicao, no mesmo
      // formato de uma chamada ao Ollama cancelada, para o dispatcher central
      // de AdoneXPanel.ts reconhecer via isUserCancellation() sem logica nova.
      throw Object.assign(new Error("Comando cancelado pelo usuario."), {
        name: "AbortError"
      });
    }
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

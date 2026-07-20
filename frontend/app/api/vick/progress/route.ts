import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProgressProvider = "codex" | "claude-code" | "adonex";
type ProgressStage = "started" | "analyzing" | "reading" | "editing" | "validating" | "waiting" | "completed" | "interrupted";

type ProgressEvent = {
  id: string;
  provider: ProgressProvider;
  stage: ProgressStage;
  message: string;
  timestamp: number;
};

type JsonObject = Record<string, unknown>;

const SAFE_TOOL_STAGES: Record<string, { stage: ProgressStage; message: string }> = {
  read: { stage: "reading", message: "está consultando os arquivos relevantes." },
  grep: { stage: "reading", message: "está pesquisando o contexto do projeto." },
  glob: { stage: "reading", message: "está localizando os arquivos necessários." },
  edit: { stage: "editing", message: "está preparando os ajustes solicitados." },
  write: { stage: "editing", message: "está preparando os ajustes solicitados." },
  apply_patch: { stage: "editing", message: "está aplicando uma alteração controlada." },
  shell_command: { stage: "validating", message: "está executando uma etapa de validação." },
  powershell: { stage: "validating", message: "está executando uma etapa de validação." },
  bash: { stage: "validating", message: "está executando uma etapa de validação." },
};

function workspaceRoot() {
  return path.resolve(process.cwd(), "..");
}

function sameWorkspace(candidate: unknown): boolean {
  return typeof candidate === "string" && path.resolve(candidate).toLowerCase() === workspaceRoot().toLowerCase();
}

function safeSince(raw: string | null): number {
  const now = Date.now();
  const parsed = Number(raw ?? now);
  if (!Number.isFinite(parsed)) return now;
  return Math.max(now - 10 * 60_000, Math.min(parsed, now));
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function event(provider: ProgressProvider, stage: ProgressStage, suffix: string, timestamp: number, identity: string): ProgressEvent {
  const label = provider === "claude-code" ? "Claude Code" : provider === "codex" ? "Codex" : "AdoneX";
  return {
    id: `${provider}:${identity}:${stage}`,
    provider,
    stage,
    message: `${label} ${suffix}`,
    timestamp,
  };
}

function toolProgress(provider: ProgressProvider, toolName: unknown, timestamp: number, identity: string) {
  if (typeof toolName !== "string") return null;
  const mapped = SAFE_TOOL_STAGES[toolName.toLowerCase()];
  return mapped ? event(provider, mapped.stage, mapped.message, timestamp, identity) : null;
}

async function recentFiles(
  directory: string,
  pattern: (name: string) => boolean,
  limit = 12,
  modifiedAfter = 0,
): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.filter((entry) => entry.isFile() && pattern(entry.name)).map(async (entry) => {
        const file = path.join(directory, entry.name);
        const stat = await fs.stat(file);
        return { file, mtime: stat.mtimeMs };
      }),
    );
    return files
      .filter(({ mtime }) => mtime > modifiedAfter)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(({ file }) => file);
  } catch {
    return [];
  }
}

async function readCodexProgress(since: number): Promise<ProgressEvent[]> {
  const dateCandidates = [new Date(), new Date(Date.now() - 86_400_000)];
  const files: string[] = [];
  for (const date of dateCandidates) {
    const directory = path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "sessions",
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    );
    files.push(...(await recentFiles(directory, (name) => name.endsWith(".jsonl"), 6, since)));
  }

  const result: ProgressEvent[] = [];
  for (const file of files) {
    let lines: string[];
    try {
      lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
      const meta = JSON.parse(lines[0]) as JsonObject;
      if (!sameWorkspace(asObject(meta.payload).cwd)) continue;
    } catch {
      continue;
    }
    for (const [index, line] of lines.entries()) {
      if (!line || (!line.includes('"task_') && !line.includes('"function_call"') && !line.includes('"custom_tool_call"') && !line.includes('"turn_aborted"'))) continue;
      try {
        const entry = JSON.parse(line) as JsonObject;
        const timestamp = Date.parse(String(entry.timestamp ?? ""));
        if (!Number.isFinite(timestamp) || timestamp <= since) continue;
        const payload = asObject(entry.payload);
        const type = String(payload.type ?? "");
        const identity = `${path.basename(file)}:${index}`;
        if (type === "task_started") result.push(event("codex", "started", "iniciou a análise da solicitação.", timestamp, identity));
        else if (type === "task_complete") result.push(event("codex", "completed", "concluiu a etapa atual.", timestamp, identity));
        else if (type === "turn_aborted") result.push(event("codex", "interrupted", "interrompeu a etapa atual.", timestamp, identity));
        else if (type === "function_call" || type === "custom_tool_call") {
          const mapped = toolProgress("codex", payload.name, timestamp, identity);
          if (mapped) result.push(mapped);
        }
      } catch {
        // Eventos desconhecidos ou corrompidos nunca sao narrados.
      }
    }
  }
  return result;
}

async function readClaudeProgress(since: number): Promise<ProgressEvent[]> {
  const projectsRoot = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const encodedWorkspace = workspaceRoot().replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  let projectDirectory = "";
  try {
    const directories = await fs.readdir(projectsRoot, { withFileTypes: true });
    const match = directories.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === encodedWorkspace);
    if (!match) return [];
    projectDirectory = path.join(projectsRoot, match.name);
  } catch {
    return [];
  }

  const files = await recentFiles(projectDirectory, (name) => name.endsWith(".jsonl"), 6, since);
  const result: ProgressEvent[] = [];
  for (const file of files) {
    let lines: string[];
    try {
      lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    } catch {
      continue;
    }
    for (const [index, line] of lines.entries()) {
      if (!line || (!line.includes('"tool_use"') && !line.includes('"last-prompt"'))) continue;
      try {
        const entry = JSON.parse(line) as JsonObject;
        const timestamp = Date.parse(String(entry.timestamp ?? ""));
        if (!Number.isFinite(timestamp) || timestamp <= since || !sameWorkspace(entry.cwd)) continue;
        const identity = `${path.basename(file)}:${index}`;
        if (entry.type === "last-prompt") {
          result.push(event("claude-code", "started", "iniciou a análise da solicitação.", timestamp, identity));
          continue;
        }
        if (entry.type !== "assistant") continue;
        const content = asObject(entry.message).content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          const item = asObject(block);
          if (item.type !== "tool_use") continue;
          const mapped = toolProgress("claude-code", item.name, timestamp, identity);
          if (mapped) {
            result.push(mapped);
            break;
          }
        }
      } catch {
        // Conteudo livre do transcript nunca e exposto.
      }
    }
  }
  return result;
}

async function readAdonexProgress(since: number): Promise<ProgressEvent[]> {
  const directory = path.join(workspaceRoot(), ".adonex", "tasks");
  const files = await recentFiles(directory, (name) => name.endsWith(".json"), 20, since);
  const statusMap: Record<string, { stage: ProgressStage; message: string }> = {
    planned: { stage: "analyzing", message: "preparou o plano e aguarda a próxima etapa." },
    pending: { stage: "waiting", message: "aguarda confirmação para continuar." },
    approved: { stage: "validating", message: "recebeu a confirmação e está validando a execução." },
    completed: { stage: "completed", message: "concluiu a solicitação." },
    failed: { stage: "interrupted", message: "encontrou um problema e interrompeu a execução." },
    cancelled: { stage: "interrupted", message: "cancelou a execução." },
  };
  const result: ProgressEvent[] = [];
  for (const file of files) {
    try {
      const task = JSON.parse(await fs.readFile(file, "utf8")) as JsonObject;
      const timestamp = Date.parse(String(task.updatedAt ?? task.createdAt ?? ""));
      const status = String(task.status ?? "").toLowerCase();
      const mapped = statusMap[status];
      if (!mapped || !Number.isFinite(timestamp) || timestamp <= since) continue;
      result.push(event("adonex", mapped.stage, mapped.message, timestamp, path.basename(file)));
    } catch {
      // Tasks incompletas nao sao narradas.
    }
  }
  return result;
}

function compact(events: ProgressEvent[]): ProgressEvent[] {
  const sorted = events.sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const bucket = Math.floor(item.timestamp / 2500);
    const key = `${item.provider}:${item.stage}:${bucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-24);
}

export async function GET(request: NextRequest) {
  const since = safeSince(request.nextUrl.searchParams.get("since"));
  const [codex, claude, adonex] = await Promise.all([
    readCodexProgress(since),
    readClaudeProgress(since),
    readAdonexProgress(since),
  ]);
  return NextResponse.json(
    { events: compact([...codex, ...claude, ...adonex]), cursor: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

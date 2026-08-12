import { promises as fs } from "node:fs";
import path from "node:path";

export interface PeerMessagingOptions {
  peerType?: "codex" | "claude" | "adonex" | "ruflo" | "ollama" | "human" | "other";
  dbPath?: string;
  maxMessageChars?: number;
  maxSummaryChars?: number;
  role?: string;
  capabilities?: string[];
  modelProfile?: string;
  activeAgents?: number;
}

export interface PeerMessagingInstallResult {
  path: string;
  created: boolean;
  changed: boolean;
  serverName: "synapse-peers";
  command: "python";
  args: string[];
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

const SERVER_NAME = "synapse-peers" as const;

export function buildSynapsePeersServer(
  options: PeerMessagingOptions = {}
): Record<string, unknown> {
  return {
    command: "python",
    args: ["scripts/synapse_peers_mcp.py"],
    env: {
      SYNAPSE_PEER_TYPE: options.peerType ?? "adonex",
      SYNAPSE_PEER_ROLE: options.role ?? "AdoneX local engineering assistant",
      SYNAPSE_PEER_CAPABILITIES: (
        options.capabilities ?? [
          "synapse-system-questions",
          "ruflo-60-agent-routing",
          "ollama-local-models",
          "code-intelligence"
        ]
      ).join(","),
      SYNAPSE_PEER_MODEL_PROFILE:
        options.modelProfile ?? "ollama:qwen3-coder-14b-team",
      SYNAPSE_PEER_ACTIVE_AGENTS: String(options.activeAgents ?? 60),
      PEER_MESSAGING_DB_PATH:
        options.dbPath ?? "./artifacts/peers/synapse-peers.db",
      PEER_MESSAGING_MAX_MESSAGE_CHARS: String(
        options.maxMessageChars ?? 1200
      ),
      PEER_MESSAGING_MAX_SUMMARY_CHARS: String(
        options.maxSummaryChars ?? 360
      )
    },
    autoStart: false
  };
}

export async function ensureSynapsePeersMcp(
  workspaceRoot: string,
  options: PeerMessagingOptions = {}
): Promise<PeerMessagingInstallResult> {
  const configPath = path.join(workspaceRoot, ".mcp.json");
  const existing = await readMcpConfig(configPath);
  const next: McpConfig = {
    ...existing.config,
    mcpServers: {
      ...(existing.config.mcpServers ?? {}),
      [SERVER_NAME]: buildSynapsePeersServer(options)
    }
  };
  const previous = existing.exists
    ? stableJson(existing.config)
    : "";
  const serialized = stableJson(next);
  const changed = previous !== serialized;
  if (changed) {
    await fs.writeFile(configPath, `${serialized}\n`, "utf8");
  }
  return {
    path: configPath,
    created: !existing.exists,
    changed,
    serverName: SERVER_NAME,
    command: "python",
    args: ["scripts/synapse_peers_mcp.py"]
  };
}

export function peerMessagingDocsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "docs", "architecture", "peer-messaging.md");
}

async function readMcpConfig(
  configPath: string
): Promise<{ exists: boolean; config: McpConfig }> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as McpConfig;
    return { exists: true, config: parsed };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { exists: false, config: {} };
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid .mcp.json: ${error.message}`);
    }
    throw error;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSynapsePeersServer,
  ensureSynapsePeersMcp
} from "../src/synapse/peerMessagingConfig";

test("peer messaging config builds a local manual MCP server", () => {
  const server = buildSynapsePeersServer({
    peerType: "claude",
    maxMessageChars: 900,
    maxSummaryChars: 240
  });

  assert.equal(server.command, "python");
  assert.deepEqual(server.args, ["scripts/synapse_peers_mcp.py"]);
  assert.equal(server.autoStart, false);
  assert.deepEqual(server.env, {
    SYNAPSE_PEER_TYPE: "claude",
    SYNAPSE_PEER_ROLE: "AdoneX local engineering assistant",
    SYNAPSE_PEER_CAPABILITIES:
      "synapse-system-questions,ruflo-60-agent-routing,ollama-local-models,code-intelligence",
    SYNAPSE_PEER_MODEL_PROFILE: "ollama:qwen2.5-coder:3b+qwen3:8b",
    SYNAPSE_PEER_ACTIVE_AGENTS: "60",
    PEER_MESSAGING_DB_PATH: "./artifacts/peers/synapse-peers.db",
    PEER_MESSAGING_MAX_MESSAGE_CHARS: "900",
    PEER_MESSAGING_MAX_SUMMARY_CHARS: "240"
  });
});

test("peer messaging config registers AdoneX as the default peer", () => {
  const server = buildSynapsePeersServer();

  assert.equal(
    (server.env as Record<string, string>).SYNAPSE_PEER_TYPE,
    "adonex"
  );
  assert.equal(
    (server.env as Record<string, string>).SYNAPSE_PEER_ACTIVE_AGENTS,
    "60"
  );
});

test("peer messaging config preserves existing mcp servers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-peers-"));
  await fs.writeFile(
    path.join(root, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          ruflo: {
            command: "cmd",
            args: ["/c", "npm", "exec", "--", "ruflo", "mcp", "start"],
            autoStart: false
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await ensureSynapsePeersMcp(root, { peerType: "codex" });
  const config = JSON.parse(
    await fs.readFile(path.join(root, ".mcp.json"), "utf8")
  );

  assert.equal(result.created, false);
  assert.equal(result.changed, true);
  assert.ok(config.mcpServers.ruflo);
  assert.equal(config.mcpServers["synapse-peers"].autoStart, false);
  assert.equal(
    config.mcpServers["synapse-peers"].env.PEER_MESSAGING_MAX_MESSAGE_CHARS,
    "1200"
  );

  const second = await ensureSynapsePeersMcp(root, { peerType: "codex" });
  assert.equal(second.changed, false);
  await fs.rm(root, { recursive: true, force: true });
});

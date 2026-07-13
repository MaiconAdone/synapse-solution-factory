# MCP Integration

Ruflo, Synapse Peers, and Claude Peers are configured in `.mcp.json` as local
MCP servers.

The expected server command is:

```powershell
cmd /c npm exec -- ruflo mcp start
```

The current enterprise defaults are:

- `CLAUDE_FLOW_MODE=v3`
- `CLAUDE_FLOW_TOPOLOGY=hierarchical-mesh`
- `CLAUDE_FLOW_MAX_AGENTS=60`
- `CLAUDE_FLOW_MEMORY_BACKEND=hybrid`
- `CODEX_MODEL=gpt-5.5`

## Backend Adapter

The backend adapter in `backend/app/adapters/ruflo_mcp.py` starts the configured
MCP server over `stdio`, performs the MCP initialize handshake, and calls Ruflo
tools through `tools/call`.

Runtime endpoints:

- `GET /swarm/status` calls `swarm_status`
- `GET /agents/runtime` calls `agent_list`
- `GET /memory/stats` calls `memory_stats`
- `POST /workflows/{workflow_id}/execute` calls `daa_workflow_execute`

## Claude Peers

`claude-peers` is installed at:

```powershell
C:\Users\malves\.claude\mcp\claude-peers-mcp
```

The MCP entry uses Bun directly:

```powershell
C:\Users\malves\.bun\bin\bun.exe C:\Users\malves\.claude\mcp\claude-peers-mcp\server.ts
```

Use it for Claude Code to Claude Code peer discovery and messaging:

- `list_peers`
- `send_message`
- `set_summary`
- `check_messages`

For immediate inbound messages, Claude Code must be launched with the
development channel enabled:

```powershell
claude --dangerously-load-development-channels server:claude-peers
```

The `.mcp.json` entry sets `OPENAI_API_KEY` to an empty value so the upstream
auto-summary path does not call an external provider by default.

Use `synapse-peers` for cross-tool coordination between Codex, AdoneX, Ruflo,
Ollama, Claude, and human operator sessions.

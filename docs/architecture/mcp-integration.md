# MCP Integration

Synapse Peers and Claude Peers are configured in `.mcp.json` as local MCP
servers. There is no external swarm-execution MCP server; the swarm runtime
tracked in `config/runtime_manifest.json` is descriptive governance data read
directly by the project-factory scripts and by `scripts/synapse_lib/`, not
served over an API.

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

Use `synapse-peers` for cross-tool coordination between Codex, Claude,
and human operator sessions.

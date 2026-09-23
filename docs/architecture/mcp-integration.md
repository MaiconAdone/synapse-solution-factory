# MCP Integration

`.mcp.json` declares no MCP servers, so Claude Code opens in this project
without external dependencies. Synapse Peers (`scripts/synapse_peers_mcp.py`) is
an optional local MCP server that can be registered on demand. There is no external execution MCP server; the governance data
tracked in `config/runtime_manifest.json` is read
directly by the project-factory scripts and by `scripts/synapse_lib/`, not
served over an API.

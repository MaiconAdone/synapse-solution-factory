# SYNAPSE Peer Messaging

SYNAPSE Peers is a local MCP mailbox for Codex, Claude, AdoneX, Ruflo, Ollama, and human
operator sessions. It adapts the useful part of peer-to-peer Claude session
coordination while staying compatible with Codex and the SYNAPSE local-first
contract.

## Purpose

- Let sessions discover nearby peers by machine, directory, or git repository.
- Share short status summaries before asking another model to reload context.
- Persist task continuity across VS Code Chat, Codex, Claude Code and AdoneX
  through `.adonex/memory/SHARED_DIALOG_MEMORY.md` and
  `.adonex/memory/CHAT_TASKS.md`.
- Send targeted local messages instead of repeating large prompts, manifests,
  catalogs, diffs, or memory blocks.
- Let AdoneX publish its local capabilities and route Synapse system questions
  through Ruflo/Ollama without calling an external LLM.
- Keep coordination local in SQLite with no cloud summary generation.

## MCP Tools

- `my_peer`: show the local peer identity and cost policy.
- `list_peers`: list local peers by `repo`, `directory`, or `machine`.
- `set_summary`: publish a short current-work summary.
- `publish_context`: publish structured role, capabilities, model profile,
  active agent budget, and status.
- `send_message`: send a short local message to another peer.
- `check_messages`: read pending local messages.
- `announce_task`: publish a local task message to a peer type such as `ruflo`.
- `route_to_ruflo_agents`: prepare an AdoneX -> Ruflo local route for up to 60
  agents while keeping Ollama calls consolidated.

## Claude and Codex

Claude can use the MCP tools directly. This implementation does not depend on
Claude-only channel push, so Codex can use the same tools through normal MCP
calls. Claude-specific push channels may be added later as an optional adapter,
but the portable path is polling with `check_messages`.

## Persistent Dialog Memory

Peer messaging is for active local sessions. Durable continuity lives in:

- `.adonex/memory/SHARED_DIALOG_MEMORY.md`: short summaries, decisions,
  pending questions and outcomes from chat;
- `.adonex/memory/CHAT_TASKS.md`: append-only task index requested through
  VS Code Chat, Codex, Claude Code or AdoneX;
- `.adonex/memory/CURRENT_STATE.md`: consolidated current state.

AdoneX writes incoming VS Code chat requests automatically. Codex and Claude
Code must read these files before asking the user to repeat context, and should
append a concise result when they complete or block a task.

## Cost Controls

- Summaries are limited by `PEER_MESSAGING_MAX_SUMMARY_CHARS`.
- Messages are limited by `PEER_MESSAGING_MAX_MESSAGE_CHARS`.
- Long messages are rejected with guidance to summarize first.
- `list_peers` returns summaries and estimated token impact.
- No `OPENAI_API_KEY` or cloud provider is used for auto-summary or routing.
- Scoping defaults to `repo` to avoid broad cross-project chatter.
- Ruflo 60-agent routing is a coordination budget, not 60 parallel LLM calls.

## Governance

- The MCP server is declared in `.mcp.json` with `autoStart=false`.
- Peer messaging does not activate Ruflo, agents, cloud, or external tools.
- Messages are local coordination artifacts, not approval records.
- Secrets, credentials, full files, large diffs, and private data should not be
  sent through peer messages.
- Persistent dialog memory follows the same rule: summaries and references only.

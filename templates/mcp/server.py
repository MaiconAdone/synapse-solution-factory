"""MCP server template for a generated solution (requires: pip install mcp).

Exposes only the tools of config/tool_registry.json that (1) the agent's
blueprint in config/solution_agents.json allows and (2) have a handler, and
routes every call through ToolGateway -> AgentRunGuard
(scripts/synapse_lib/mcp_gateway.py, scripts/synapse_lib/agent_harness.py).

Configuration (environment):
- SYNAPSE_AGENT_ID: blueprint whose tools this server exposes (default: solution-orchestrator).
- SYNAPSE_TOOL_HANDLERS: "package.module" exposing HANDLERS = {"tool_name": handler}, where
  handler(args: dict, dry_run: bool) -> result. Without it only the internal
  ask_user / request_human_approval handlers below exist.
- SYNAPSE_TRACE_PATH: JSONL trace file (default: artifacts/traces/mcp_gateway.jsonl).

Human approval is deliberately NOT an MCP tool: an operator-owned interface of
the project calls ``ToolGateway.approve(tool, args, approver)``; the agent can
only open a request with ``request_human_approval``.

Register it in .mcp.json only after the tool inventory is confirmed with the user
(see templates/mcp/mcp.example.json).
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.mcp_gateway import ToolGateway  # noqa: E402


def _internal_handlers() -> dict[str, Any]:
    return {
        "ask_user": lambda args, dry_run: {"question": args["question"], "delivered": not dry_run},
    }


def load_handlers() -> dict[str, Any]:
    handlers = _internal_handlers()
    module_name = os.getenv("SYNAPSE_TOOL_HANDLERS", "").strip()
    if module_name:
        handlers.update(getattr(importlib.import_module(module_name), "HANDLERS"))
    return handlers


def build_gateway() -> ToolGateway:
    agent_id = os.getenv("SYNAPSE_AGENT_ID", "solution-orchestrator")
    return ToolGateway.for_agent(agent_id, load_handlers(), root=ROOT)


def build_server(gateway: ToolGateway | None = None):
    from mcp.server.fastmcp import FastMCP  # noqa: PLC0415 - optional dependency of generated projects

    gateway = gateway or build_gateway()
    trace_path = ROOT / os.getenv("SYNAPSE_TRACE_PATH", "artifacts/traces/mcp_gateway.jsonl")
    server = FastMCP(
        "solution-tools",
        instructions=(
            "Governed tool gateway. Call list_tools first. Side effects need an idempotency_key; "
            "irreversible tools must be called with simulate=true before the real call and then wait "
            "for human approval. Refused or stopped calls must be reported to the user, never retried blindly."
        ),
    )

    def _flush() -> None:
        gateway.guard.export_trace(trace_path)
        gateway.guard.trace.clear()

    @server.tool()
    def list_tools() -> list[dict[str, Any]]:
        """Tools this agent may call, with their approval/simulation/idempotency rules."""
        return gateway.list_tools()

    @server.tool()
    def call_tool(tool: str, args_json: str = "{}", idempotency_key: str = "", simulate: bool = False) -> dict[str, Any]:
        """Call a registered tool through the runtime guard."""
        try:
            args = json.loads(args_json or "{}")
        except json.JSONDecodeError:
            return {"status": "refused", "reason": "args_json must be a JSON object"}
        if not isinstance(args, dict):
            return {"status": "refused", "reason": "args_json must be a JSON object"}
        result = gateway.call(tool, args, idempotency_key=idempotency_key or None, simulate=simulate)
        _flush()
        return result

    @server.tool()
    def request_human_approval(tool: str, args_json: str = "{}", reason: str = "") -> dict[str, Any]:
        """Open an approval request; a human operator decides outside the agent."""
        result = gateway.request_approval(tool, json.loads(args_json or "{}"), reason)
        _flush()
        return result

    return server


if __name__ == "__main__":
    build_server().run(transport="stdio")

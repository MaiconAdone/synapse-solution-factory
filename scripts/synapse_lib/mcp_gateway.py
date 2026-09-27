"""MCP tool gateway: exposes config/tool_registry.json through the runtime guard.

``ToolGateway`` is the protocol-independent core of templates/mcp/server.py, so
the rules are testable without the MCP SDK. Every call goes through
``AgentRunGuard`` (least privilege, required args, idempotency, loop limits,
trace). The gateway adds what only an execution boundary can guarantee:

- simulation is real: ``simulate=True`` runs the handler in dry-run mode and
  records the exact call; only then is the side effect allowed;
- approval is out-of-band: MCP clients can *request* approval, but only a
  human operator calls ``approve`` (never exposed as an MCP tool);
- idempotency is real: replaying an idempotency key returns the stored result
  without executing again;
- tools without a registered handler are refused (no invented tools).

Standard library only.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from scripts.synapse_lib.agent_harness import ALLOWED, NEEDS_APPROVAL, NEEDS_SIMULATION, REFUSED, AgentRunGuard

Handler = Callable[[dict[str, Any], bool], Any]  # (args, dry_run) -> result


def _signature(tool: str, args: dict[str, Any]) -> str:
    return json.dumps([tool, args], sort_keys=True, default=str)


@dataclass
class ToolGateway:
    guard: AgentRunGuard
    handlers: dict[str, Handler]
    pending_approvals: dict[str, dict[str, Any]] = field(default_factory=dict)
    _approved: set[str] = field(default_factory=set)
    _simulated: set[str] = field(default_factory=set)
    _idempotent_results: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def for_agent(cls, agent_id: str, handlers: dict[str, Handler], root: Path | None = None) -> "ToolGateway":
        return cls(guard=AgentRunGuard.from_policy(agent_id, root=root), handlers=dict(handlers))

    def list_tools(self) -> list[dict[str, Any]]:
        """Only tools that are registered, allowed for this agent and backed by a handler."""
        return [
            {
                "name": spec.name,
                "side_effect": spec.side_effect,
                "approval_required": spec.approval_required,
                "simulation_first": spec.simulation_first,
                "idempotency_key_required": spec.idempotency_key_required,
                "required_args": list(spec.required_args),
            }
            for name, spec in sorted(self.guard.registry.items())
            if name in self.guard.allowed_tools and name in self.handlers
        ]

    def call(
        self,
        tool: str,
        args: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        simulate: bool = False,
    ) -> dict[str, Any]:
        args = dict(args or {})
        if idempotency_key and idempotency_key in self._idempotent_results:
            return {"status": "replayed", "tool": tool, "result": self._idempotent_results[idempotency_key]}
        if tool not in self.handlers:
            return {"status": REFUSED, "tool": tool, "reason": "no handler registered for this tool"}
        screened = self.guard.check_input(json.dumps(args, ensure_ascii=False, default=str))
        if not screened.allowed:
            return {"status": screened.status, "tool": tool, "reason": screened.reason}

        signature = _signature(tool, args)
        spec = self.guard.registry.get(tool)
        if simulate:
            if spec is None or tool not in self.guard.allowed_tools:
                decision = self.guard.authorize(tool, args, idempotency_key=idempotency_key)
                return {"status": decision.status, "tool": tool, "reason": decision.reason}
            preview = self.handlers[tool](args, True)
            self._simulated.add(signature)
            return {"status": "simulated", "tool": tool, "preview": preview}

        decision = self.guard.authorize(
            tool,
            args,
            idempotency_key=idempotency_key,
            approved=signature in self._approved,
            simulated=signature in self._simulated,
        )
        if decision.status == NEEDS_APPROVAL:
            self.pending_approvals[signature] = {"tool": tool, "args": args, "reason": decision.reason}
        if decision.status != ALLOWED:
            hint = {NEEDS_SIMULATION: "call again with simulate=true", NEEDS_APPROVAL: "wait for human approval"}
            return {"status": decision.status, "tool": tool, "reason": decision.reason, "next": hint.get(decision.status)}
        try:
            result = self.handlers[tool](args, False)
        except Exception as error:  # noqa: BLE001 - tool failures are reported, never hidden
            outcome = self.guard.record_result(tool, ok=False)
            return {"status": "error", "tool": tool, "error": str(error), "guard": outcome.status}
        self.guard.record_result(tool, ok=True)
        if idempotency_key:
            self._idempotent_results[idempotency_key] = result
        return {"status": "executed", "tool": tool, "result": result}

    def request_approval(self, tool: str, args: dict[str, Any] | None = None, reason: str = "") -> dict[str, Any]:
        signature = _signature(tool, dict(args or {}))
        self.pending_approvals[signature] = {"tool": tool, "args": dict(args or {}), "reason": reason}
        return {"status": "pending_human_approval", "tool": tool}

    def approve(self, tool: str, args: dict[str, Any] | None, approver: str) -> dict[str, Any]:
        """Operator-only: never register this as an MCP tool."""
        if not approver.strip():
            raise ValueError("a named human approver is required")
        signature = _signature(tool, dict(args or {}))
        self._approved.add(signature)
        self.pending_approvals.pop(signature, None)
        self.guard._record("approval", tool, "approved", f"approved by {approver}", dict(args or {}))  # noqa: SLF001
        return {"status": "approved", "tool": tool, "approver": approver}

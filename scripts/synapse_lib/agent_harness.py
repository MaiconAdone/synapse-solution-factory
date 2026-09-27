"""Agent runtime harness: the executable side of config/harness_engineering_policy.json.

``AgentRunGuard`` wraps every run of a solution agent and enforces, outside the
model: input screening, least-privilege tools (blueprint + config/tool_registry.json),
required arguments, idempotency keys, simulation-first and human approval for
side effects, loop limits (steps, tool calls, retries, repeated identical calls,
wall clock) and a redacted trace with the observability fields.

``run_agent_eval`` is the eval harness for evals/tool_workflow_cases.jsonl: it
runs every case ``trials_per_agent_case`` times through a runner and reports
pass@k (capability) and pass^k (reliability). The reference runner proposes the
labeled tool so the suite proves the guard; a generated project plugs its real
agent with ``python scripts/run_evals.py agent --runner module:function``.

Standard library only: the project factory runs it with the ``python`` on PATH.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from scripts.synapse_lib.harness_service import summarize_trials
from scripts.synapse_lib.text_utils import normalize_text

ALLOWED = "allowed"
NEEDS_APPROVAL = "needs_approval"
NEEDS_SIMULATION = "needs_simulation"
REFUSED = "refused"
STOPPED = "stopped"

REDACTIONS = (
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b"), "<secret>"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]+"), "Bearer <secret>"),
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "<cpf>"),
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_json(root: Path, relative_path: str) -> dict[str, Any]:
    path = root / relative_path
    if not path.exists():
        path = _repo_root() / relative_path
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}


def redact(value: Any) -> Any:
    """Mask PII and secrets before anything reaches a trace (llm_ops/observability.yaml)."""
    if isinstance(value, str):
        for pattern, replacement in REDACTIONS:
            value = pattern.sub(replacement, value)
        return value
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


@dataclass(frozen=True)
class ToolSpec:
    name: str
    side_effect: bool = False
    reversible: bool = True
    approval_required: bool = False
    idempotency_key_required: bool = False
    simulation_first: bool = False
    required_args: tuple[str, ...] = ()
    status: str = "internal"


def load_tool_registry(root: Path | None = None) -> dict[str, ToolSpec]:
    data = _load_json(root or _repo_root(), "config/tool_registry.json")
    return {
        item["name"]: ToolSpec(
            name=item["name"],
            side_effect=bool(item.get("side_effect", False)),
            reversible=bool(item.get("reversible", True)),
            approval_required=bool(item.get("approval_required", False)),
            idempotency_key_required=bool(item.get("idempotency_key_required", False)),
            simulation_first=bool(item.get("simulation_first", False)),
            required_args=tuple(item.get("required_args", [])),
            status=item.get("status", "internal"),
        )
        for item in data.get("tools", [])
    }


@dataclass(frozen=True)
class LoopLimits:
    max_steps: int = 25
    max_tool_calls: int = 40
    max_retries_per_tool: int = 2
    repeat_call_loop_threshold: int = 3
    wall_clock_timeout_seconds: float = 600

    @classmethod
    def from_policy(cls, policy: dict[str, Any]) -> "LoopLimits":
        for component in policy.get("components", []):
            if component.get("id") == "control_loop":
                limits = component.get("loop_limits", {})
                return cls(
                    max_steps=int(limits.get("max_steps", cls.max_steps)),
                    max_tool_calls=int(limits.get("max_tool_calls", cls.max_tool_calls)),
                    max_retries_per_tool=int(limits.get("max_retries_per_tool", cls.max_retries_per_tool)),
                    repeat_call_loop_threshold=int(limits.get("repeat_call_loop_threshold", cls.repeat_call_loop_threshold)),
                    wall_clock_timeout_seconds=float(limits.get("wall_clock_timeout_seconds", cls.wall_clock_timeout_seconds)),
                )
        return cls()


@dataclass
class Decision:
    status: str
    tool: str | None
    reason: str

    @property
    def allowed(self) -> bool:
        return self.status == ALLOWED


@dataclass
class AgentRunGuard:
    agent_id: str
    allowed_tools: set[str]
    registry: dict[str, ToolSpec]
    limits: LoopLimits = field(default_factory=LoopLimits)
    input_block_patterns: tuple[str, ...] = ()
    clock: Callable[[], float] = time.monotonic
    trace: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.started_at = self.clock()
        self.steps = 0
        self.tool_calls = 0
        self.stop_reason: str | None = None
        self._signatures: dict[str, int] = {}
        self._failures: dict[str, int] = {}

    @classmethod
    def from_policy(
        cls,
        agent_id: str,
        root: Path | None = None,
        allowed_tools: set[str] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> "AgentRunGuard":
        """Build a guard from the harness policy, the tool registry and the agent blueprint."""
        base = root or _repo_root()
        policy = _load_json(base, "config/harness_engineering_policy.json")
        if allowed_tools is None:
            blueprints = _load_json(base, "config/solution_agents.json").get("agents", [])
            agent = next((item for item in blueprints if item.get("agent_id") == agent_id), None)
            if agent is None:
                raise ValueError(f"agent {agent_id} not found in config/solution_agents.json")
            allowed_tools = set(agent.get("tools", []))
        runtime = policy.get("runtime_guard", {})
        return cls(
            agent_id=agent_id,
            allowed_tools=set(allowed_tools),
            registry=load_tool_registry(base),
            limits=LoopLimits.from_policy(policy),
            input_block_patterns=tuple(runtime.get("input_block_patterns", [])),
            clock=clock,
        )

    # --- lifecycle ------------------------------------------------------------
    def check_input(self, text: str) -> Decision:
        normalized = normalize_text(text)
        hits = [pattern for pattern in self.input_block_patterns if normalize_text(pattern) in normalized]
        if hits:
            return self._record("input", None, REFUSED, f"blocked input pattern: {', '.join(hits)}", {"input": text})
        return self._record("input", None, ALLOWED, "input screened", {"input": text})

    def step(self) -> Decision:
        if self.stop_reason:
            return self._record("step", None, STOPPED, self.stop_reason, {})
        self.steps += 1
        if self.steps > self.limits.max_steps:
            return self._stop("step", None, f"max_steps {self.limits.max_steps} exceeded")
        if self._timed_out():
            return self._stop("step", None, f"wall clock {self.limits.wall_clock_timeout_seconds}s exceeded")
        return self._record("step", None, ALLOWED, f"step {self.steps}", {})

    def authorize(
        self,
        tool: str,
        args: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        approved: bool = False,
        simulated: bool = False,
    ) -> Decision:
        args = dict(args or {})
        if self.stop_reason:
            return self._record("tool", tool, STOPPED, self.stop_reason, args)
        if self._timed_out():
            return self._stop("tool", tool, f"wall clock {self.limits.wall_clock_timeout_seconds}s exceeded")
        if self.tool_calls >= self.limits.max_tool_calls:
            return self._stop("tool", tool, f"max_tool_calls {self.limits.max_tool_calls} reached")
        spec = self.registry.get(tool)
        if spec is None:
            return self._record("tool", tool, REFUSED, "tool not in config/tool_registry.json", args)
        if tool not in self.allowed_tools:
            return self._record("tool", tool, REFUSED, f"least privilege: {self.agent_id} may not call {tool}", args)
        missing = [name for name in spec.required_args if name not in args]
        if missing:
            return self._record("tool", tool, REFUSED, f"missing required args: {', '.join(missing)}", args)
        if spec.idempotency_key_required and not idempotency_key:
            return self._record("tool", tool, REFUSED, "side effect without idempotency key", args)
        signature = json.dumps([tool, args], sort_keys=True, default=str)
        if self._signatures.get(signature, 0) >= self.limits.repeat_call_loop_threshold:
            return self._stop("tool", tool, "loop detected: same tool and arguments repeated; stop and escalate")
        if spec.simulation_first and not simulated:
            return self._record("tool", tool, NEEDS_SIMULATION, "irreversible side effect: simulate first", args)
        if spec.approval_required and not approved:
            return self._record("tool", tool, NEEDS_APPROVAL, "human approval required (autonomy matrix)", args)
        self._signatures[signature] = self._signatures.get(signature, 0) + 1
        self.tool_calls += 1
        return self._record("tool", tool, ALLOWED, "authorized", args)

    def record_result(self, tool: str, ok: bool, tokens: int = 0, latency_ms: float = 0.0) -> Decision:
        """Track outcomes; consecutive failures beyond max_retries_per_tool stop the run."""
        self._failures[tool] = 0 if ok else self._failures.get(tool, 0) + 1
        extra = {"tokens": tokens, "latency_ms": latency_ms, "ok": ok}
        if self._failures[tool] > self.limits.max_retries_per_tool:
            return self._stop("result", tool, f"{tool} failed more than {self.limits.max_retries_per_tool} retries", extra)
        return self._record("result", tool, ALLOWED, "ok" if ok else "failed; retry with backoff", extra)

    def summary(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "steps": self.steps,
            "tool_calls": self.tool_calls,
            "stopped": self.stop_reason is not None,
            "stop_reason": self.stop_reason,
            "events": len(self.trace),
        }

    def export_trace(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for event in self.trace:
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    # --- internals ------------------------------------------------------------
    def _timed_out(self) -> bool:
        return self.clock() - self.started_at > self.limits.wall_clock_timeout_seconds

    def _stop(self, event: str, tool: str | None, reason: str, extra: dict[str, Any] | None = None) -> Decision:
        self.stop_reason = reason
        return self._record(event, tool, STOPPED, reason, extra or {})

    def _record(self, event: str, tool: str | None, status: str, reason: str, payload: dict[str, Any]) -> Decision:
        self.trace.append(
            {
                "agent_id": self.agent_id,
                "event": event,
                "tool": tool,
                "status": status,
                "reason": reason,
                "payload": redact(payload),
                "step": self.steps,
                "tool_calls": self.tool_calls,
                "elapsed_ms": round((self.clock() - self.started_at) * 1000, 3),
            }
        )
        return Decision(status, tool, reason)


# --- eval harness for evals/tool_workflow_cases.jsonl ------------------------------

Runner = Callable[[dict[str, Any], dict[str, ToolSpec]], list[dict[str, Any]]]


def reference_runner(case: dict[str, Any], registry: dict[str, ToolSpec]) -> list[dict[str, Any]]:
    """Propose the labeled tool with well-formed arguments (proves the guard, not a model)."""
    expected = case.get("expected", {})
    tool = expected.get("tool")
    if not tool or tool not in registry:
        return []
    spec = registry[tool]
    action = {
        "tool": tool,
        "args": {name: f"<{name}>" for name in spec.required_args},
        "idempotency_key": f"{case.get('id', 'case')}-1" if spec.idempotency_key_required else None,
    }
    repeats = int(expected.get("max_repeat_calls", 0))
    return [dict(action) for _ in range(repeats + 1)] if repeats else [action]


def evaluate_case(
    case: dict[str, Any],
    guard_factory: Callable[[dict[str, Any]], AgentRunGuard],
    runner: Runner,
    registry: dict[str, ToolSpec],
) -> tuple[bool, dict[str, bool]]:
    expected = case.get("expected", {})
    guard = guard_factory(case)
    screened = guard.check_input(str(case.get("input", "")))
    if expected.get("refuse"):
        actions = runner(case, registry) if screened.allowed else []
        allowed = [action for action in actions if guard.authorize(**_call(action)).allowed]
        checks = {"input_refused": screened.status == REFUSED, "no_tool_executed": not allowed}
        return all(checks.values()), checks

    actions = runner(case, registry)
    checks: dict[str, bool] = {"input_screened": screened.allowed, "right_tool": bool(actions) and actions[0].get("tool") == expected.get("tool")}
    if not checks["right_tool"]:
        return False, checks
    first = _call(actions[0])
    spec = registry[first["tool"]]
    if expected.get("refuse_by_least_privilege"):
        checks["least_privilege_enforced"] = guard.authorize(**first).status == REFUSED
        return all(checks.values()), checks
    if expected.get("max_repeat_calls"):
        statuses = [guard.authorize(**_call(action)).status for action in actions]
        limit = int(expected["max_repeat_calls"])
        checks["loop_stopped_after_limit"] = statuses[:limit] == [ALLOWED] * limit and statuses[limit] == STOPPED
        checks["escalation_recorded"] = guard.stop_reason is not None and "escalate" in guard.stop_reason
        return all(checks.values()), checks

    # Enforcement probes use fresh guards so each rule is checked in isolation.
    if expected.get("idempotency_key_required"):
        checks["idempotency_enforced"] = guard_factory(case).authorize(**{**first, "idempotency_key": None}).status == REFUSED
    if expected.get("simulation_first"):
        checks["simulation_enforced"] = guard_factory(case).authorize(**{**first, "approved": True}).status == NEEDS_SIMULATION
    if expected.get("approval_required"):
        checks["approval_enforced"] = guard_factory(case).authorize(**{**first, "simulated": True}).status == NEEDS_APPROVAL
        checks["runs_after_simulation_and_approval"] = guard.authorize(**{**first, "simulated": True, "approved": True}).allowed
    else:
        checks["runs_without_approval"] = guard.authorize(**first).allowed
    checks["side_effect_classified"] = spec.side_effect == bool(expected.get("side_effect", spec.side_effect))
    return all(checks.values()), checks


def _call(action: dict[str, Any]) -> dict[str, Any]:
    return {
        "tool": action.get("tool"),
        "args": action.get("args", {}),
        "idempotency_key": action.get("idempotency_key"),
        "approved": bool(action.get("approved", False)),
        "simulated": bool(action.get("simulated", False)),
    }


def run_agent_eval(
    root: Path,
    cases: list[dict[str, Any]],
    runner: Runner | None = None,
    trials: int | None = None,
) -> dict[str, Any]:
    policy = _load_json(root, "config/harness_engineering_policy.json")
    eval_policy = policy.get("eval_harness", {})
    trials = int(trials or eval_policy.get("trials_per_agent_case", 3))
    registry = load_tool_registry(root)
    runner = runner or reference_runner

    def guard_factory(case: dict[str, Any]) -> AgentRunGuard:
        allowed = case.get("allowed_tools")
        return AgentRunGuard.from_policy(
            case.get("agent_id", "eval-agent"),
            root=root,
            allowed_tools=set(allowed) if allowed is not None else set(registry),
        )

    outcomes: dict[str, list[bool]] = {}
    details: dict[str, dict[str, bool]] = {}
    for case in cases:
        case_id = str(case.get("id", "unknown"))
        outcomes[case_id] = []
        for _ in range(trials):
            passed, checks = evaluate_case(case, guard_factory, runner, registry)
            outcomes[case_id].append(passed)
            details[case_id] = checks
    summary = summarize_trials(outcomes, k=trials)
    return {
        "trials": trials,
        "runner": getattr(runner, "__name__", "custom"),
        "summary": summary,
        "checks": details,
        "reliability_gate_pass_hat_k_min": float(eval_policy.get("reliability_gate_pass_hat_k_min", 0.8)),
    }

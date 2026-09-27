"""Runners for evals that need real measurements: voice agent and agentic coding.

Audio recognition and coding-agent runs cannot be reproduced offline, so each
runner has two levels:

- contract check (always): cases are well formed and every gate they reference
  exists in the gate file;
- measured check (with ``results``): observed values from a real run are
  compared with each case's expectations and with the release gates.

``release_ready`` is true only when measurements exist and every gate passes
(voice_agent_quality_gates.json: "Do not claim the target is achieved until
measured eval results satisfy every gate").

Results files:
- voice: {"metrics": {"<gate>": value}, "cases": {"<case id>": {"<expected key>": value}}}
- agentic coding: {"metrics": {"task_success_rate": value},
  "cases": {"<case id>": {"observed_steps": [...]}}}

Standard library only.
"""

from __future__ import annotations

from typing import Any

OPERATORS = {
    "<": lambda value, target: value < target,
    "<=": lambda value, target: value <= target,
    ">=": lambda value, target: value >= target,
    ">": lambda value, target: value > target,
    "=": lambda value, target: value == target,
}


def apply_gate(value: Any, operator: str, target: Any) -> bool:
    if value is None or operator not in OPERATORS:
        return False
    return bool(OPERATORS[operator](value, target))


def _expectation_met(key: str, expected: Any, observed: dict[str, Any]) -> bool:
    if key not in observed:
        return False
    value = observed[key]
    if key.endswith("_max"):
        return value <= expected
    if key.endswith("_min"):
        return value >= expected
    return value == expected


def run_voice_eval(cases: list[dict[str, Any]], gates: dict[str, Any], results: dict[str, Any] | None = None) -> dict[str, Any]:
    release_gates = gates.get("release_gates", {})
    measured = results is not None
    observed_cases = (results or {}).get("cases", {})
    case_results = []
    for case in cases:
        checks = {
            "has_id": bool(case.get("id")),
            "gate_defined": case.get("gate") in release_gates,
            "has_expectations": bool(case.get("expected")),
        }
        if measured:
            observed = observed_cases.get(case.get("id"), {})
            checks["measured"] = bool(observed)
            checks["expectations_met"] = all(
                _expectation_met(key, value, observed) for key, value in case.get("expected", {}).items()
            )
        case_results.append({"id": case.get("id", "unknown"), "passed": all(checks.values()), "checks": checks})

    gate_results = {}
    if measured:
        metrics = results.get("metrics", {})
        gate_results = {
            name: apply_gate(metrics.get(name), spec["operator"], spec["target"]) for name, spec in release_gates.items()
        }
    contract_keys = {"has_id", "gate_defined", "has_expectations"}
    contract_ok = all(all(value for key, value in item["checks"].items() if key in contract_keys) for item in case_results)
    release_ready = measured and all(item["passed"] for item in case_results) and bool(gate_results) and all(gate_results.values())
    return {
        "measured": measured,
        "contract_ok": contract_ok,
        "release_ready": release_ready,
        "gates": gate_results,
        "cases": case_results,
    }


def run_agentic_coding_eval(cases: list[dict[str, Any]], results: dict[str, Any] | None = None) -> dict[str, Any]:
    measured = results is not None
    observed_cases = (results or {}).get("cases", {})
    ids = [case.get("id") for case in cases]
    case_results = []
    thresholds = []
    for case in cases:
        expected = set(case.get("expected", []))
        forbidden = set(case.get("forbidden", []))
        checks = {
            "has_id": bool(case.get("id")) and ids.count(case.get("id")) == 1,
            "has_expected_steps": bool(expected),
            "expected_and_forbidden_disjoint": not (expected & forbidden),
        }
        if measured:
            steps = set(observed_cases.get(case.get("id"), {}).get("observed_steps", []))
            checks["measured"] = bool(steps)
            checks["expected_steps_observed"] = expected <= steps
            checks["no_forbidden_steps"] = not (forbidden & steps)
        minimum = case.get("metrics", {}).get("task_success_rate_min")
        if minimum is not None:
            thresholds.append(float(minimum))
        case_results.append({"id": case.get("id", "unknown"), "passed": all(checks.values()), "checks": checks})

    gate_results = {}
    if measured and thresholds:
        rate = results.get("metrics", {}).get("task_success_rate")
        gate_results["task_success_rate"] = apply_gate(rate, ">=", max(thresholds))
    contract_keys = {"has_id", "has_expected_steps", "expected_and_forbidden_disjoint"}
    contract_ok = all(all(value for key, value in item["checks"].items() if key in contract_keys) for item in case_results)
    release_ready = measured and all(item["passed"] for item in case_results) and all(gate_results.values())
    return {
        "measured": measured,
        "contract_ok": contract_ok,
        "release_ready": release_ready,
        "gates": gate_results,
        "cases": case_results,
    }

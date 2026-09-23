"""Typed, deterministic state machine for agentic business transformation.

Runs the stages of config/business_transformation.json, one functional agent
profile per stage, over a user-provided brief. It never calls a model and never
touches an external system: tools are simulated, risk follows explicit rules,
autonomy is enforced per level and every step leaves an audit record.
Missing business inputs become ``pending_user_decisions`` instead of guesses.

Standard library only, so it runs with any ``python`` on PATH.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
SCORE_FIELDS = ("value", "complexity", "data_readiness")


def load_contract(root: Path | None = None) -> dict[str, Any]:
    base = root or Path(__file__).resolve().parents[2]
    path = base / "config" / "business_transformation.json"
    if not path.exists():
        path = Path(__file__).resolve().parents[2] / "config" / "business_transformation.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


@dataclass
class TransformationState:
    brief: dict[str, Any]
    stage_results: list[dict[str, Any]] = field(default_factory=list)
    audit_log: list[dict[str, Any]] = field(default_factory=list)
    pending_user_decisions: list[str] = field(default_factory=list)
    opportunities: list[dict[str, Any]] = field(default_factory=list)

    def ask(self, decision: str) -> None:
        if decision not in self.pending_user_decisions:
            self.pending_user_decisions.append(decision)


def classify_risk(factors: dict[str, Any] | None, rules: dict[str, Any]) -> tuple[str, list[str]]:
    """Apply the explicit risk rules; unknown factors are treated conservatively as HIGH."""
    factors = factors or {}
    missing = [name for name in rules["factors"] if name not in factors]
    financial = float(factors.get("financial_impact") or 0)
    cases = float(factors.get("affected_cases_per_month") or 0)
    reasons: list[str] = []
    if factors.get("regulated_decision"):
        reasons.append("regulated_decision")
    if factors.get("irreversible") and factors.get("external_side_effect"):
        reasons.append("irreversible_and_external_side_effect")
    if financial >= 1_000_000:
        reasons.append("financial_impact >= 1000000")
    if reasons:
        return "CRITICAL", reasons
    reasons = [name for name in ("external_side_effect", "irreversible", "personal_data", "customer_facing") if factors.get(name)]
    if financial >= 100_000:
        reasons.append("financial_impact >= 100000")
    if reasons:
        return "HIGH", reasons
    if missing:
        return "HIGH", [f"missing risk factors: {', '.join(missing)}"]
    if factors.get("writes_internal_systems"):
        reasons.append("writes_internal_systems")
    if cases >= 1000:
        reasons.append("affected_cases_per_month >= 1000")
    if reasons:
        return "MEDIUM", reasons
    return "LOW", ["no risk factor present"]


class BusinessTransformationWorkflow:
    def __init__(self, contract: dict[str, Any] | None = None, root: Path | None = None) -> None:
        self.contract = contract or load_contract(root)
        self.profiles = {profile["id"]: profile for profile in self.contract["functional_agents"]}
        self.handlers: dict[str, Callable[[TransformationState], dict[str, Any]]] = {
            "intake": self._intake,
            "diagnosis": self._diagnosis,
            "process_mapping": self._process_mapping,
            "data_readiness": self._data_readiness,
            "opportunity_identification": self._opportunity_identification,
            "prioritization": self._prioritization,
            "automation_architecture": self._automation_architecture,
            "kpi_design": self._kpi_design,
            "execution_planning": self._execution_planning,
            "risk_governance": self._risk_governance,
            "human_approval": self._human_approval,
            "simulation": self._simulation,
            "impact_evaluation": self._impact_evaluation,
            "final_report": self._final_report,
        }
        unknown = [stage["id"] for stage in self.contract["workflow"]["stages"] if stage["id"] not in self.handlers]
        if unknown:
            raise ValueError(f"no handler for stages: {unknown}")

    def run(self, brief: dict[str, Any]) -> dict[str, Any]:
        state = TransformationState(brief=brief)
        for stage in self.contract["workflow"]["stages"]:
            profile = self.profiles[stage["profile"]]
            output = self.handlers[stage["id"]](state)
            record = {
                "stage": stage["id"],
                "profile": profile["id"],
                "class": profile["class"],
                "role": profile["role"],
                "supporting_roles": stage.get("supporting_roles", []),
                "tools": profile["tools"],
                "output": output,
            }
            state.stage_results.append(record)
            state.audit_log.append({"stage": stage["id"], "role": profile["role"], "decision": output.get("decision", "recorded")})
        blocked = [item for item in state.opportunities if item.get("execution_status") in {"awaiting_human_approval", "blocked_external_action"}]
        if state.pending_user_decisions:
            status = "needs_user_decisions"
        elif blocked:
            status = "awaiting_human_approval"
        else:
            status = "completed_simulation"
        return {
            "schema": "synapse-business-transformation-run.v1",
            "status": status,
            "simulation_only": True,
            "pending_user_decisions": state.pending_user_decisions,
            "opportunities": state.opportunities,
            "stages": state.stage_results,
            "audit_log": state.audit_log,
        }

    # --- stages -----------------------------------------------------------------

    def _intake(self, state: TransformationState) -> dict[str, Any]:
        brief = state.brief
        for key in ("objective", "owner", "business_area"):
            if not brief.get(key):
                state.ask(key)
        area = brief.get("business_area")
        if area and area not in self.contract["initial_business_areas"]:
            state.ask(f"business_area '{area}' outside {self.contract['initial_business_areas']}")
        return {"objective": brief.get("objective", ""), "owner": brief.get("owner", ""), "business_area": area}

    def _diagnosis(self, state: TransformationState) -> dict[str, Any]:
        kpis = state.brief.get("kpis", {})
        missing = [metric for metric in self.contract["required_business_metrics"] if metric not in kpis]
        for metric in missing:
            state.ask(f"kpi baseline: {metric}")
        return {"systems": state.brief.get("systems", []), "missing_metrics": missing}

    def _process_mapping(self, state: TransformationState) -> dict[str, Any]:
        steps = state.brief.get("process", {}).get("steps", [])
        if not steps:
            state.ask("process steps (current process map)")
        return {
            "steps": len(steps),
            "human_steps": sum(1 for step in steps if step.get("actor") == "human"),
            "bottlenecks": [step.get("name") for step in steps if step.get("is_bottleneck")],
            "total_minutes": sum(float(step.get("duration_minutes") or 0) for step in steps),
        }

    def _data_readiness(self, state: TransformationState) -> dict[str, Any]:
        sources = state.brief.get("data_sources", [])
        if not sources:
            state.ask("data_sources")
        return {"data_sources": sources, "tool": "data_tool", "mode": "simulated"}

    def _opportunity_identification(self, state: TransformationState) -> dict[str, Any]:
        state.opportunities = [dict(item) for item in state.brief.get("opportunities", [])]
        if not state.opportunities:
            state.ask("opportunities to evaluate")
        return {"opportunities": [item.get("id") for item in state.opportunities]}

    def _prioritization(self, state: TransformationState) -> dict[str, Any]:
        weights = self.contract["prioritization"]["weights"]
        for item in state.opportunities:
            missing = [name for name in SCORE_FIELDS if not isinstance(item.get(name), (int, float))]
            if missing:
                state.ask(f"{item.get('id')}: scores {', '.join(missing)} (1-5)")
                item["priority_score"] = None
                continue
            item["_base_score"] = (
                weights["value"] * item["value"] / 5
                + weights["data_readiness"] * item["data_readiness"] / 5
                + weights["simplicity"] * (6 - item["complexity"]) / 5
            )
        return {"weights": weights}

    def _automation_architecture(self, state: TransformationState) -> dict[str, Any]:
        tools = self.contract["tools"]
        for item in state.opportunities:
            tool = item.get("tool", "automation_tool")
            if tool not in tools:
                state.ask(f"{item.get('id')}: tool '{tool}' is not registered")
                continue
            item["tool"] = tool
            item["tool_side_effect"] = tools[tool]["side_effect"]
            item["real_execution_requires"] = tools[tool].get("real_execution_requires", [])
        return {"mcp_required_for_external_tools": self.contract["framework_policy"]["mcp_required_for_external_tools"]}

    def _kpi_design(self, state: TransformationState) -> dict[str, Any]:
        invalid = [
            name
            for name, kpi in state.brief.get("kpis", {}).items()
            if not isinstance(kpi, dict) or "baseline" not in kpi or "target" not in kpi
        ]
        for name in invalid:
            state.ask(f"kpi {name}: baseline and target")
        return {"kpis": sorted(state.brief.get("kpis", {})), "invalid": invalid}

    def _execution_planning(self, state: TransformationState) -> dict[str, Any]:
        return {"planned": [item.get("id") for item in state.opportunities]}

    def _risk_governance(self, state: TransformationState) -> dict[str, Any]:
        rules = self.contract["risk_rules"]
        weight = self.contract["prioritization"]["weights"]["safety"]
        for item in state.opportunities:
            level, reasons = classify_risk(item.get("risk_factors"), rules)
            if reasons and reasons[0].startswith("missing risk factors"):
                state.ask(f"{item.get('id')}: {reasons[0]}")
            item["risk_level"] = level
            item["risk_reasons"] = reasons
            item["autonomy"] = self.contract["autonomy"][level]
            if "_base_score" in item:
                safety = (len(RISK_ORDER) - RISK_ORDER.index(level)) / len(RISK_ORDER)
                item["priority_score"] = round(item.pop("_base_score") + weight * safety, 4)
        state.opportunities.sort(key=lambda item: (item.get("priority_score") is None, -(item.get("priority_score") or 0)))
        return {"levels": {item.get("id"): item["risk_level"] for item in state.opportunities}}

    def _human_approval(self, state: TransformationState) -> dict[str, Any]:
        approvals = set(state.brief.get("approvals", []))
        for item in state.opportunities:
            level = item["risk_level"]
            if level == "CRITICAL":
                item["execution_status"] = "simulation_only_approved" if item.get("id") in approvals else "blocked_external_action"
            elif level == "HIGH":
                item["execution_status"] = "approved" if item.get("id") in approvals else "awaiting_human_approval"
            elif level == "MEDIUM":
                item["execution_status"] = "approved_with_validation" if state.brief.get("kpis") else "awaiting_validation"
            else:
                item["execution_status"] = "approved"
        return {"approvals_received": sorted(approvals)}

    def _simulation(self, state: TransformationState) -> dict[str, Any]:
        runnable = {"approved", "approved_with_validation", "simulation_only_approved"}
        simulated = []
        for item in state.opportunities:
            if item["execution_status"] in runnable:
                item["simulation"] = {"tool": item.get("tool"), "mode": "simulated", "external_call": False}
                simulated.append(item.get("id"))
        return {"simulated": simulated, "external_calls": 0}

    def _impact_evaluation(self, state: TransformationState) -> dict[str, Any]:
        impact = {}
        for name, kpi in state.brief.get("kpis", {}).items():
            if isinstance(kpi, dict) and kpi.get("baseline") not in (None, 0) and "target" in kpi:
                impact[name] = round((float(kpi["target"]) - float(kpi["baseline"])) / float(kpi["baseline"]), 4)
        return {"expected_relative_change": impact, "basis": "user-provided baseline and target, not measured results"}

    def _final_report(self, state: TransformationState) -> dict[str, Any]:
        return {
            "ranked_opportunities": [
                {key: item.get(key) for key in ("id", "priority_score", "risk_level", "execution_status")}
                for item in state.opportunities
            ],
            "pending_user_decisions": len(state.pending_user_decisions),
            "decision": "report_ready",
        }


def run_cases(cases_path: Path, root: Path | None = None) -> dict[str, Any]:
    """Run eval cases: each line has a brief and the expected risk/status per opportunity."""
    workflow = BusinessTransformationWorkflow(root=root)
    results = []
    for line in cases_path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        run = workflow.run(case["brief"])
        by_id = {item["id"]: item for item in run["opportunities"]}
        checks = {"status": run["status"] == case["expected"].get("status", run["status"])}
        for opportunity_id, expected in case["expected"].get("opportunities", {}).items():
            actual = by_id.get(opportunity_id, {})
            for key, value in expected.items():
                checks[f"{opportunity_id}.{key}"] = actual.get(key) == value
        results.append({"id": case["id"], "passed": all(checks.values()), "checks": checks})
    return {"passed": bool(results) and all(item["passed"] for item in results), "cases": results}

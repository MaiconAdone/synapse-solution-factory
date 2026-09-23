"""Agentic business transformation: contract coherence and the governed state machine."""

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer
from scripts.synapse_lib.business_transformation import BusinessTransformationWorkflow, classify_risk, run_cases

ROOT = Path(__file__).resolve().parents[1]


def load(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8-sig"))


def brief():
    return load("templates/business/transformation_brief.json")


def test_contract_workflow_profiles_and_catalog_agree():
    contract = load("config/business_transformation.json")
    workflow = load("config/workflows/synapse/business-transformation.json")
    profiles = {profile["id"]: profile for profile in contract["functional_agents"]}
    catalog = {role["id"] for role in load("config/roles.json")["roles"]}

    assert [step["name"] for step in workflow["steps"]] == [stage["id"] for stage in contract["workflow"]["stages"]]
    for step, stage in zip(workflow["steps"], contract["workflow"]["stages"]):
        assert step["role"] == profiles[stage["profile"]]["role"]
        assert set(stage.get("supporting_roles", [])) <= catalog
    assert {profile["role"] for profile in profiles.values()} <= catalog
    for profile in profiles.values():
        assert set(profile["tools"]) <= set(contract["tools"]), profile["id"]

    yaml_text = (ROOT / "agents/definitions/business_transformation_agents.yaml").read_text(encoding="utf-8-sig")
    assert re.findall(r"(?m)^  - id: ([a-z-]+)$", yaml_text) == list(profiles)
    for profile in profiles.values():
        assert f"role: {profile['role']}" in yaml_text


@pytest.mark.parametrize(
    ("factors", "expected"),
    [
        ({"regulated_decision": True}, "CRITICAL"),
        ({"irreversible": True, "external_side_effect": True}, "CRITICAL"),
        ({"financial_impact": 2_000_000}, "CRITICAL"),
        ({"personal_data": True}, "HIGH"),
        ({}, "HIGH"),  # unknown risk is never assumed low
    ],
)
def test_classify_risk_rules(factors, expected):
    assert classify_risk(factors, load("config/business_transformation.json")["risk_rules"])[0] == expected


def test_complete_factors_can_be_medium_or_low():
    rules = load("config/business_transformation.json")["risk_rules"]
    safe = {name: False for name in rules["factors"]} | {"financial_impact": 0, "affected_cases_per_month": 10}
    assert classify_risk(safe, rules)[0] == "LOW"
    assert classify_risk({**safe, "writes_internal_systems": True}, rules)[0] == "MEDIUM"
    assert classify_risk({**safe, "affected_cases_per_month": 5000}, rules)[0] == "MEDIUM"


def test_workflow_runs_every_stage_with_its_profile_and_audits():
    report = BusinessTransformationWorkflow(root=ROOT).run(brief())
    contract = load("config/business_transformation.json")

    assert [stage["stage"] for stage in report["stages"]] == [stage["id"] for stage in contract["workflow"]["stages"]]
    assert len(report["audit_log"]) == len(report["stages"])
    assert report["simulation_only"] is True
    assert report["status"] == "awaiting_human_approval"
    ranking = [item["id"] for item in report["opportunities"]]
    assert ranking == ["status-lookup", "auto-ticket"]
    simulation = next(stage for stage in report["stages"] if stage["stage"] == "simulation")
    assert simulation["output"]["external_calls"] == 0
    impact = next(stage for stage in report["stages"] if stage["stage"] == "impact_evaluation")
    assert impact["output"]["expected_relative_change"]["cycle_time"] == pytest.approx(-0.625)


def test_workflow_asks_instead_of_inventing_missing_inputs():
    data = brief()
    del data["owner"]
    data["opportunities"][0].pop("value")
    report = BusinessTransformationWorkflow(root=ROOT).run(data)

    assert report["status"] == "needs_user_decisions"
    assert "owner" in report["pending_user_decisions"]
    assert any("scores value" in item for item in report["pending_user_decisions"])


def test_critical_opportunity_never_runs_external_action_even_when_approved():
    data = brief()
    data["opportunities"] = [copy.deepcopy(data["opportunities"][1])]
    data["opportunities"][0]["risk_factors"]["regulated_decision"] = True
    data["approvals"] = [data["opportunities"][0]["id"]]
    item = BusinessTransformationWorkflow(root=ROOT).run(data)["opportunities"][0]

    assert item["risk_level"] == "CRITICAL"
    assert item["execution_status"] == "simulation_only_approved"
    assert item["simulation"]["external_call"] is False


def test_eval_cases_and_cli_pass():
    assert run_cases(ROOT / "evals/business_transformation_cases.jsonl", root=ROOT)["passed"]
    completed = subprocess.run(
        [sys.executable, "scripts/run_business_transformation.py", "--brief", "templates/business/transformation_brief.json"],
        cwd=ROOT, capture_output=True, text=True, timeout=60, check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout)["status"] == "awaiting_human_approval"


def test_analyzer_recognizes_transformation_requests_and_adds_business_roles():
    analyzer = BusinessSolutionAnalyzer(root=ROOT)
    transformation = analyzer.analyze(
        project_goal="Reduzir retrabalho",
        business_problem="Redesenhar o processo de backoffice financeiro e reduzir tempo de ciclo com agentes",
        requested_universe="IA",
    )
    assert transformation["business_transformation"]["active"] is True
    assert "business-value-analyst" in transformation["execution_strategy"]["roles"]

    churn = analyzer.analyze(project_goal="Modelo de churn", business_problem="Prever cancelamento de clientes", requested_universe="ML")
    assert churn["business_transformation"]["active"] is False
    assert "business-value-analyst" not in churn["execution_strategy"]["roles"]


def test_engine_is_stdlib_only():
    code = (
        "import sys; sys.modules['numpy'] = None; sys.path.insert(0, '.');"
        "from scripts.synapse_lib.business_transformation import BusinessTransformationWorkflow; print('ok')"
    )
    completed = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert completed.stdout.strip() == "ok", completed.stderr

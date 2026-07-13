import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agents.business_transformation import transformation_agents
from app.main import app
from app.orchestration.transformation_workflow import TransformationWorkflow
from app.schemas.business_transformation import (
    ApprovalDecision,
    BusinessObjective,
    WorkflowStatus,
)
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.business_transformation_service import BusinessTransformationService
from app.tools.business_transformation import default_transformation_tools


def objective(**updates) -> BusinessObjective:
    values = {
        "title": "Reduzir devolucao de materiais didaticos",
        "description": (
            "Prever demanda, identificar erros logisticos e melhorar a distribuicao "
            "de materiais em todo o Brasil."
        ),
        "business_area": "Logistica e Operacoes",
        "expected_outcome": "Reduzir devolucoes e aumentar eficiencia operacional",
        "constraints": ["execucao local", "simulacao antes de integracao"],
        "priority": "medium",
        "available_data": ["pedidos", "estoque", "devolucoes"],
        "involved_systems": [],
    }
    values.update(updates)
    return BusinessObjective(**values)


def test_agents_share_base_contract_and_map_to_ruflo_catalog():
    agents = transformation_agents(default_transformation_tools())

    assert len(agents) == 8
    assert len({agent.name for agent in agents}) == 8
    assert all(agent.ruflo_agent_id for agent in agents)
    assert all(agent.plan(objective()) for agent in agents)


def test_low_risk_transformation_completes_with_audit_and_impact():
    state = TransformationWorkflow().start(objective(priority="low"))

    assert state.status == WorkflowStatus.COMPLETED
    assert state.process_map is not None
    assert len(state.opportunities) == 3
    assert len(state.agent_tasks) == 8
    assert len(state.tool_results) == 4
    assert state.expected_business_impact is not None
    assert state.risk_assessment is not None
    assert state.risk_assessment.human_approval_required is False
    assert {event.event_type for event in state.audit} >= {
        "workflow_started",
        "governance_classified",
        "tool_called",
        "workflow_completed",
    }


def test_high_risk_transformation_waits_for_human_approval(tmp_path):
    service = BusinessTransformationService(store_path=tmp_path / "workflows")
    state = service.execute(
        objective(
            business_area="Financeiro",
            description="Analisar inadimplencia e preparar acoes no sistema financeiro.",
        )
    )

    assert state.status == WorkflowStatus.APPROVAL_REQUIRED
    assert state.approval is not None
    assert not state.tool_results

    completed = service.approve(
        state.workflow_id,
        ApprovalDecision(approved=True, approver="risk-owner", notes="Piloto autorizado."),
    )

    assert completed.status == WorkflowStatus.COMPLETED
    assert completed.approval is not None
    assert completed.approval.status == "approved"
    assert completed.tool_results


def test_rejected_transformation_does_not_execute_tools(tmp_path):
    service = BusinessTransformationService(store_path=tmp_path / "workflows")
    state = service.execute(
        objective(
            description="Transferir dinheiro automaticamente conforme previsao.",
            priority="critical",
        )
    )
    rejected = service.approve(
        state.workflow_id,
        ApprovalDecision(approved=False, approver="finance-owner", notes="Risco inaceitavel."),
    )

    assert rejected.status == WorkflowStatus.REJECTED
    assert not rejected.tool_results


def test_workflow_persists_and_rejects_another_owner(tmp_path):
    store = tmp_path / "workflows"
    created = BusinessTransformationService(store_path=store).execute(
        objective(priority="low"),
        owner_id="user-a",
        project_id="project-a",
    )
    reloaded = BusinessTransformationService(store_path=store)

    assert reloaded.get(created.workflow_id, requester_id="user-a", is_admin=False) == created
    with pytest.raises(PermissionError):
        reloaded.get(created.workflow_id, requester_id="user-b", is_admin=False)


def test_business_transformation_api_end_to_end(monkeypatch, tmp_path):
    from app.routes import business as business_routes

    monkeypatch.setattr(
        business_routes,
        "service",
        BusinessTransformationService(store_path=tmp_path / "workflows"),
    )
    client = TestClient(app)
    payload = objective(
        business_area="Financeiro",
        description="Analisar inadimplencia e recomendar acoes para aprovacao humana.",
    ).model_dump(mode="json")

    response = client.post("/business/transformation", json=payload)
    assert response.status_code == 200
    created = response.json()
    assert created["status"] == "approval_required"

    approval = client.post(
        f"/business/transformation/{created['workflow_id']}/approve",
        json={"approved": True, "approver": "controller", "notes": "Piloto aprovado."},
    )
    assert approval.status_code == 200
    assert approval.json()["status"] == "completed"

    audit = client.get(f"/business/transformation/{created['workflow_id']}/audit")
    assert audit.status_code == 200
    assert any(event["event_type"] == "approval_granted" for event in audit.json())


def test_business_transformation_routes_to_its_fleet():
    result = AgenticMeshGovernanceService().fleet_for_request(
        "Redesenhar processo empresarial e medir ROI da transformacao empresarial",
        "hybrid",
    )

    assert result["selected_fleet"]["id"] == "business_transformation_fleet"


def test_generated_project_inherits_business_transformation_assets(tmp_path):
    root = Path(__file__).resolve().parents[1]
    project_name = "agentic_transformation_test"
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(root / "scripts" / "create_ai_project.ps1"),
        "-NomeProjeto",
        project_name,
        "-TipoProjeto",
        "IA",
        "-DestinoBase",
        str(tmp_path),
        "-SkipActivation",
    ]
    completed = subprocess.run(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr

    project = tmp_path / project_name
    required = [
        "config/business_transformation.json",
        "config/workflows/ruflo/business-transformation.json",
        "agents/definitions/business_transformation_agents.yaml",
        "prompts/business_transformation.md",
        "docs/AGENTIC_AI_TRANSFORMATION.md",
    ]
    assert all((project / relative).exists() for relative in required)
    assert not (project / "backend").exists()
    assert not (project / "frontend").exists()

    manifest = json.loads((project / "config/runtime_manifest.json").read_text(encoding="utf-8-sig"))
    contract = json.loads(
        (project / "config/synapse_solution_contract.json").read_text(encoding="utf-8-sig")
    )
    assert manifest["business_transformation"]["enabled"] is True
    assert "business-transformation" in manifest["validation"]["required_workflows"]
    assert contract["capabilities"]["agentic_business_transformation"] is True

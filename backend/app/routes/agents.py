from fastapi import APIRouter

from app.services.agent_registry import AgentRegistryService

router = APIRouter()
service = AgentRegistryService()


@router.get("")
def list_agents() -> list[dict[str, object]]:
    return service.list_agents()


@router.get("/runtime")
def runtime_agent_list() -> dict[str, object]:
    return service.runtime_agents()


@router.get("/trust-framework")
def agent_trust_framework() -> dict[str, object]:
    return service.trust_framework()


@router.get("/fleets")
def agent_fleets(universe: str | None = None) -> list[dict[str, object]]:
    return service.fleets(universe)


@router.get("/governance")
def agentic_mesh_governance() -> dict[str, object]:
    return service.governance_summary()


@router.get("/fleets/route")
def route_agent_fleet(q: str, universe: str = "hybrid") -> dict[str, object]:
    return service.route_fleet(q, universe)


@router.get("/blueprint-contract")
def agent_blueprint_contract() -> dict[str, object]:
    return service.blueprint_contracts()


@router.get("/blueprints/build")
def build_agent_blueprint(q: str, universe: str = "hybrid") -> dict[str, object]:
    return service.build_blueprint(q, universe)

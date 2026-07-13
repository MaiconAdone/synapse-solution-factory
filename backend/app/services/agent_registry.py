from app.agents.catalog import AGENT_CATALOG
from app.services.agent_blueprint_service import AgentBlueprintService
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.ruflo_service import RufloService


class AgentRegistryService:
    def __init__(
        self,
        ruflo_service: RufloService | None = None,
        governance: AgenticMeshGovernanceService | None = None,
        blueprint_service: AgentBlueprintService | None = None,
    ) -> None:
        self.ruflo_service = ruflo_service or RufloService()
        self.governance = governance or AgenticMeshGovernanceService()
        self.blueprint_service = blueprint_service or AgentBlueprintService()

    def list_agents(self) -> list[dict[str, object]]:
        return AGENT_CATALOG

    def runtime_agents(self) -> dict[str, object]:
        runtime = self.ruflo_service.agent_list()
        if runtime["available"]:
            return runtime
        return {"runtime": runtime, "fallback": AGENT_CATALOG}

    def trust_framework(self) -> dict[str, object]:
        return self.governance.trust()

    def fleets(self, universe: str | None = None) -> list[dict[str, object]]:
        return self.governance.list_fleets(universe)

    def governance_summary(self) -> dict[str, object]:
        return self.governance.summary()

    def route_fleet(self, request: str, universe: str = "hybrid") -> dict[str, object]:
        return self.governance.fleet_for_request(request, universe)

    def blueprint_contracts(self) -> dict[str, object]:
        return self.blueprint_service.validate_contracts()

    def build_blueprint(self, request: str, universe: str = "hybrid") -> dict[str, object]:
        return self.blueprint_service.build_blueprint(request, universe)

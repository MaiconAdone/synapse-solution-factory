from app.repositories.runtime_manifest import load_runtime_manifest
from app.services.ruflo_service import RufloService


class SwarmService:
    def __init__(self, ruflo_service: RufloService | None = None) -> None:
        self.ruflo_service = ruflo_service or RufloService()

    def status(self) -> dict[str, object]:
        manifest = load_runtime_manifest()
        swarm = manifest["swarm"]
        return {
            "core": "Codex + Ruflo",
            "mcp": manifest["mcp"],
            "operational_state": "configured",
            "topology": swarm["topology"],
            "consensus": swarm["consensus"],
            "coordination": swarm["coordination"],
            "max_agents": swarm["max_agents"],
            "core_agent_count": swarm.get("core_agent_count", 15),
            "specialist_agent_count": swarm.get("specialist_agent_count", 0),
            "activation_policy": swarm.get("activation_policy", "activate_all_parallel"),
            "anti_drift": swarm["anti_drift"],
            "model_routing": {
                "mode": manifest["local_llm"].get("all_60_agents_model_access"),
                "strategy": manifest["local_llm"]["routing_strategy"],
                "local_provider": manifest["local_llm"]["provider"],
                "local_model": manifest["local_llm"]["default_model"],
                "governed_bridge": manifest["local_llm"].get("ruflo_governed_bridge"),
                "shared_memory_namespace": manifest["local_llm"].get("ruflo_shared_memory_namespace"),
                "sensitive_content_local_only": manifest["local_llm"]["sensitive_content_local_only"],
            },
        }

    def runtime_status(self) -> dict[str, object]:
        runtime = self.ruflo_service.swarm_status()
        if runtime["available"]:
            return runtime

        fallback = self.status()
        fallback["operational_state"] = "configured_mcp_unavailable"
        return {"runtime": runtime, "fallback": fallback}

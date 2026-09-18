from app.repositories.runtime_manifest import load_runtime_manifest


class SwarmService:
    def status(self) -> dict[str, object]:
        manifest = load_runtime_manifest()
        swarm = manifest["swarm"]
        return {
            "core": "Codex + Claude Code",
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
                "provider": manifest["local_llm"]["provider"],
                "default_model": manifest["local_llm"]["default_model"],
                "sensitive_content_blocked": manifest["local_llm"]["sensitive_content_blocked"],
            },
        }

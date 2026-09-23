"""Runtime agents of a generated IA/Chatbolt/Hybrid solution.

The 60 swarm agents in agents/definitions/enterprise_agents.yaml *build* the
solution. This module covers the agents the solution itself *runs* (e.g. an
order-status assistant with tools): initial blueprints derived from the
business solution analysis, validated against config/agent_blueprint_contract.json.

Standard library only: the project factory runs it with the ``python`` on PATH.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

AI_UNIVERSES = {"ia", "chatbolt", "hybrid"}
MODEL_TIERS = {"economy", "balanced", "strong"}
PENDING = "pending_user_confirmation"


def _load(root: Path, relative_path: str) -> dict[str, Any]:
    path = root / relative_path
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _base_blueprint(
    agent_id: str,
    objective: str,
    authority: str,
    tier: str,
    tools: list[str],
    fleet: str,
    evals: list[str],
    risk_level: str,
    token_budget: int,
) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "objective": objective,
        "model_strategy": {"tier": tier, "access": "via_llm_gateway_only"},
        "allowed_model_profiles": sorted({"economy", tier}),
        "tools": tools,
        "memory": {"scope": "project", "session_memory": True, "long_term": "retrieval_only"},
        "context": {"sources": ["config/business_solution_analysis.json"], "filter": "config/context_policy.json"},
        "boundaries": {
            "forbidden": ["secrets_in_prompts", "unapproved_external_actions", "cross_tenant_data"],
            "loop_limits": "config/harness_engineering_policy.json#control_loop",
        },
        "success_criteria": PENDING,
        "fleet": fleet,
        "evals": evals,
        "observability": ["model", "prompt_version", "tool_calls", "tokens", "latency_ms", "outcome"],
        "cost_budget": {"token_budget_per_task": token_budget},
        "risk_level": risk_level or PENDING,
        "authority_level": authority,
        "escalation_rule": "low confidence, blocked tool, or high risk -> ask user or escalate to orchestrator; external actions need human approval",
        "quality_gate": {"pass_hat_k_min": 0.8, "trials": 3},
    }


def build_solution_agents(analysis: dict[str, Any], root: Path) -> dict[str, Any]:
    """Derive single-agent-first blueprints from the analysis; never invents tools."""
    universe = analysis.get("effective_universe") or analysis.get("requested_universe", "hybrid")
    if universe not in AI_UNIVERSES:
        raise ValueError("solution agents apply only to ia, chatbolt and hybrid universes")
    stack = set(analysis.get("solution_stack", []))
    goal = analysis.get("dialog_context", {}).get("project_goal") or PENDING
    risk = analysis.get("dialog_context", {}).get("risk_level", "")
    success = analysis.get("dialog_context", {}).get("success_metric_or_acceptance_criteria") or PENDING
    fleets = analysis.get("swarm_strategy", {}).get("recommended_fleets", []) or ["rag_fleet"]
    profiles = _load(root, "config/cost_optimization_policy.json").get("activation_profiles", {})
    budget = int(profiles.get("standard", {}).get("token_budget", 4000))
    agent_evals = ["evals/tool_workflow_cases.jsonl", "evals/prompt_cases.jsonl"]
    if universe == "chatbolt":
        agent_evals.append("evals/chatbot_cases.jsonl")

    orchestrator = _base_blueprint(
        "solution-orchestrator",
        goal,
        "drafting",
        "balanced",
        ["delegate_to_specialist", "ask_user", "request_human_approval"],
        "mcp_fleet" if "mcp_fleet" in fleets else fleets[0],
        agent_evals,
        risk,
        budget,
    )
    orchestrator["success_criteria"] = success
    agents = [orchestrator]
    multiagent = "rag" in stack and "agents" in stack
    if multiagent:
        retriever = _base_blueprint(
            "knowledge-retriever",
            "Answer only from retrieved, permission-filtered sources and return citations.",
            "advisory",
            "economy",
            ["hybrid_retrieve"],
            "rag_fleet",
            ["evals/retrieval_cases.jsonl", "evals/rag_cases.jsonl"],
            risk,
            budget,
        )
        retriever["success_criteria"] = "retrieval and faithfulness gates in evals/quality_gates.yaml"
        executor = _base_blueprint(
            "action-executor",
            "Execute approved business actions through the tool gateway with idempotency keys.",
            "external_action",
            "balanced",
            [],
            "mcp_fleet",
            ["evals/tool_workflow_cases.jsonl"],
            risk,
            budget,
        )
        executor["human_approval_required"] = True
        executor["pending_user_decisions"] = ["tool_inventory", "tool_permissions", "approval_matrix"]
        agents.extend([retriever, executor])

    return {
        "schema": "synapse-solution-agents.v1",
        "universe": universe,
        "architecture": "orchestrator_with_specialists" if multiagent else "single_agent",
        "contract": "config/agent_blueprint_contract.json",
        "workflow": "config/workflows/synapse/agent-build.json",
        "status": "draft_requires_user_confirmation",
        "agents": agents,
    }


def validate_solution_agents(document: dict[str, Any], root: Path) -> list[str]:
    """Return contract violations; an empty list means the blueprints are valid."""
    contract = _load(root, "config/agent_blueprint_contract.json")
    fleets = {fleet["id"] for fleet in _load(root, "config/agent_fleets.json").get("fleets", [])}
    authority_levels = set(contract.get("agent_role_contract", {}).get("authority_levels", []))
    required = contract.get("required_fields", [])
    problems: list[str] = []
    agents = document.get("agents", [])
    if not agents:
        return ["no agents defined"]
    ids = [agent.get("agent_id") for agent in agents]
    if len(ids) != len(set(ids)):
        problems.append("duplicate agent_id")
    for agent in agents:
        name = agent.get("agent_id", "<missing id>")
        problems.extend(f"{name}: missing field {field}" for field in required if field not in agent)
        if agent.get("authority_level") not in authority_levels:
            problems.append(f"{name}: invalid authority_level {agent.get('authority_level')}")
        if agent.get("authority_level") == "external_action" and not agent.get("human_approval_required"):
            problems.append(f"{name}: external_action requires human_approval_required=true")
        if agent.get("model_strategy", {}).get("tier") not in MODEL_TIERS:
            problems.append(f"{name}: model tier must be one of {sorted(MODEL_TIERS)}")
        if fleets and agent.get("fleet") not in fleets:
            problems.append(f"{name}: fleet {agent.get('fleet')} not in config/agent_fleets.json")
        problems.extend(
            f"{name}: eval file missing {path}" for path in agent.get("evals", []) if not (root / path).exists()
        )
    if document.get("architecture") == "single_agent" and len(agents) != 1:
        problems.append("single_agent architecture must define exactly one agent")
    return problems

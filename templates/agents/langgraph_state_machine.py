"""LangGraph state machine template for a governed solution agent (requires: pip install langgraph).

Flow: screen -> route -> (retrieve) -> answer -> (act) -> END

- every model call goes through LlmGateway (scripts/synapse_lib/llm_gateway.py):
  tier routing, token budget, prompt caching layout, input/output guardrails, trace;
- every tool call goes through AgentRunGuard (scripts/synapse_lib/agent_harness.py)
  with the blueprint tools of config/solution_agents.json;
- the node functions are plain Python so tests run them without LangGraph;
  ``build_graph`` wires them into a LangGraph ``StateGraph`` when it is installed.

Replace the retriever and tool handlers with project code; never add tools that
are not in config/tool_registry.json.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, TypedDict

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.agent_harness import AgentRunGuard  # noqa: E402
from scripts.synapse_lib.llm_gateway import LlmGateway, LlmRequest  # noqa: E402

STABLE_SYSTEM_PROMPT = (
    "You answer only from the provided context, cite source ids in brackets, "
    "and say when the context is not enough."
)


class AgentState(TypedDict, total=False):
    question: str
    route: str
    context: list[str]
    sources: list[str]
    answer: str
    outcome: str
    proposed_tool: dict[str, Any] | None
    tool_decision: str
    trace: list[str]


class GovernedAgent:
    def __init__(
        self,
        gateway: LlmGateway,
        guard: AgentRunGuard,
        retrieve: Callable[[str], list[tuple[str, str]]] | None = None,
    ) -> None:
        self.gateway = gateway
        self.guard = guard
        self.retrieve_fn = retrieve or (lambda question: [])

    # --- nodes -----------------------------------------------------------------
    def screen(self, state: AgentState) -> AgentState:
        decision = self.guard.check_input(state["question"])
        return {"outcome": "" if decision.allowed else "blocked_input", "trace": [f"screen:{decision.status}"]}

    def route(self, state: AgentState) -> AgentState:
        if state.get("outcome") == "blocked_input":
            return {"route": "stop"}
        return {"route": "rag" if self.guard.registry.get("hybrid_retrieve") and "hybrid_retrieve" in self.guard.allowed_tools else "direct"}

    def retrieve(self, state: AgentState) -> AgentState:
        decision = self.guard.authorize("hybrid_retrieve", {"query": state["question"]})
        if not decision.allowed:
            return {"context": [], "sources": [], "trace": [*state.get("trace", []), f"retrieve:{decision.status}"]}
        hits = self.retrieve_fn(state["question"])
        return {"context": [text for _, text in hits], "sources": [source for source, _ in hits]}

    def answer(self, state: AgentState) -> AgentState:
        result = self.gateway.complete(
            LlmRequest(
                task_type="rag_answering" if state.get("context") else "summarization",
                user_message=state["question"],
                stable_context=STABLE_SYSTEM_PROMPT,
                dynamic_context=state.get("context", []),
                sources=state.get("sources", []),
                agent_id=self.guard.agent_id,
                prompt_id="solution_agent_answer",
                prompt_version="v1",
            )
        )
        return {"answer": result.get("text", ""), "outcome": result["outcome"]}

    def act(self, state: AgentState) -> AgentState:
        proposed = state.get("proposed_tool")
        if not proposed:
            return {}
        decision = self.guard.authorize(
            proposed["tool"], proposed.get("args", {}), idempotency_key=proposed.get("idempotency_key")
        )
        return {"tool_decision": decision.status}

    @staticmethod
    def after_route(state: AgentState) -> str:
        return state.get("route", "direct")

    def run(self, state: AgentState) -> AgentState:
        """Same flow as the graph, without LangGraph (tests, scripts)."""
        state = {**state, **self.screen(state)}
        state = {**state, **self.route(state)}
        if state["route"] == "stop":
            return state
        if state["route"] == "rag":
            state = {**state, **self.retrieve(state)}
        state = {**state, **self.answer(state)}
        return {**state, **self.act(state)}


def build_graph(agent: GovernedAgent):
    from langgraph.graph import END, START, StateGraph  # noqa: PLC0415 - optional dependency

    graph = StateGraph(AgentState)
    graph.add_node("screen", agent.screen)
    graph.add_node("route", agent.route)
    graph.add_node("retrieve", agent.retrieve)
    graph.add_node("answer", agent.answer)
    graph.add_node("act", agent.act)
    graph.add_edge(START, "screen")
    graph.add_edge("screen", "route")
    graph.add_conditional_edges("route", agent.after_route, {"rag": "retrieve", "direct": "answer", "stop": END})
    graph.add_edge("retrieve", "answer")
    graph.add_edge("answer", "act")
    graph.add_edge("act", END)
    return graph.compile()

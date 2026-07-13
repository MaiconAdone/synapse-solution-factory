# Agentic Coding Playbook

## Swarm Rules

- Use specialized agents for domain work.
- Route multi-step work through the orchestration manager.
- Persist decisions in memory when they affect future tasks.
- Prefer small, validated changes with explicit acceptance checks.
- Keep MCP, memory, workflows, and source code aligned.
- Start with one agent and escalate only when another domain is required.
- Keep all-60-agent activation as an explicit, justified, human-approved exception.
- Treat agent state signals such as confidence, uncertainty, risk, blocked state, and urgency as operational controls.
- Keep large catalogs, manifests, artifacts, and memory summaries out of prompts unless directly needed.

## Agent Review

- Backend changes require contract validation.
- RAG changes require retrieval evaluation.
- ML changes require metrics and model-card updates.
- Prompt changes require prompt eval updates.
- DevOps changes require rollback instructions.
- Tool or MCP changes require permission, idempotency, audit, and compensation review.
- Agent role changes require goal, tools, memory, evals, permissions, and stop conditions.

## Multiagent Control

- Represent tasks before routing them: objective, constraints, evidence, risk, and acceptance criteria.
- Use Ruflo as the local router for specialist selection and workflow execution.
- Resolve conflicting specialist outputs through the orchestration manager.
- Stop for human approval when evidence is weak, risk is high, an action is irreversible, or cloud/external execution is requested.
- Record feedback as memory or learning data only through the approved continual-learning path.

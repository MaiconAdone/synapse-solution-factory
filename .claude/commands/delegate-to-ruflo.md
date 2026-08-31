---
name: delegate-to-ruflo
description: Classify a user task with CostAwareRouter, route/track it via Ruflo MCP, and scale effort to what the task actually needs instead of treating everything as high-effort work in this session's own context. Full free-execution handoff needs a running local executor (see "Current limitation" in the file).
---

# Delegate to Ruflo

Reduces Anthropic token spend by scaling effort to the smallest sufficient
level for each task instead of doing all reasoning at this session's own
(billed) tier by default. Reuses the same classifier the Synapse backend
already uses — no duplicated heuristics here. As of 2026-08-31, actual
free/local execution of delegated tasks requires a running executor that
this project doesn't have wired up yet (see "Current limitation" below) —
routing, task-tracking, and shared memory work today regardless.

## When to use

- Explicitly: `/delegate-to-ruflo <pedido do usuario>`
- Proactively, before starting a multi-step task, when it looks like it could
  be economy or balanced tier work (routing, summarization, boilerplate,
  implementation, test generation) rather than architecture/security/
  conflict-resolution.

## Steps

1. **Classify the request** with the real router, not a guess:

   ```bash
   cd backend && python -c "
   from app.services.cost_aware_router import CostAwareRouter
   import json
   r = CostAwareRouter()
   print(json.dumps(r.route('<pedido do usuario>', universe='<ml|ia|chatbolt|hybrid>'), ensure_ascii=False, indent=2))
   "
   ```

   Read `profile`, `model_tier`, `active_agent_count`, `core_agents`,
   `specialist_agents`, and `token_budget` from the output.

2. **Decide who does the work**, based on `model_tier` — and on what can
   actually execute right now (see "Current limitation" below):
   - `economy`/`balanced` with a real local executor available → delegate,
     don't do the work yourself.
   - `economy`/`balanced` with no executor running → use Ruflo only for
     routing/memory (steps 3-4), then do the work yourself at the cheapest
     viable altitude (short, no exploration, no tangents) — still cheaper
     than treating it as a `strong` task.
   - `strong` → always keep it in this session (architecture review,
     security review, conflict resolution, high-risk changes).

3. **Route and track through Ruflo MCP tools**, not by re-explaining full
   context in a new prompt:
   - `mcp__ruflo__hooks_route` with `{task, context, topK}` — routing hint
     only. Cross-check its `swarmRecommendation` against
     `active_agent_count` from step 1 before trusting it; the semantic
     matcher has weak/no coverage for some task types (e.g. plain
     summarization) and can over-recommend a multi-agent swarm for a
     `simple` profile. Cap to what step 1 allows.
   - `mcp__ruflo__task_create` + `mcp__ruflo__task_assign` naming one of the
     `core_agents`/`specialist_agents` from step 1, capped at
     `active_agent_count`. This only registers the task in
     `.swarm/memory.db` — it does not execute it (see step 2).
   - Never exceed `active_agent_count` from the profile. Never touch all 60
     agents without the user's explicit request and approval
     (`activate_all_60_requires_explicit_high_complexity` in
     `config/cost_optimization_policy.json`).

4. **Bridge context through shared memory, not re-paste:**
   - `mcp__ruflo__memory_search` (task/project-scoped namespace) before
     writing a long prompt — pull only what's missing.
   - `mcp__ruflo__memory_store` after the task completes, so the next
     delegated task doesn't need the same context resent.

5. **Pull back a summary only:**
   - Poll `mcp__ruflo__task_status` / `mcp__ruflo__task_summary`, not the
     full agent transcript.
   - Record the outcome with `mcp__ruflo__hooks_post-task`
     (`taskId`, `task`, `agent`, `success`, `quality`) — mirrors
     `RufloService.record_task_outcome` and feeds
     `config/agent_improvement_loop.json`.

## Guardrails

From `config/cost_optimization_policy.json`:

- Default active agents: 1. Standard: 3. Advanced: 5. Enterprise: 8.
  Extreme: 15. All 60 only with explicit high-complexity justification.
- `token_budget` and `rag_mode` from step 1's profile cap what the delegated
  agent should attempt — don't let a delegated task balloon past its budget.

## Current limitation (verified 2026-08-31)

`task_create`/`task_assign`/`hooks_route` are coordination primitives, not
an execution trigger — nothing consumes the queue automatically in this
setup. Confirmed by testing: a created+assigned task stayed
`status: pending`, `result: null` until cancelled, and `agent_list`
returned zero running agents.

The one MCP tool that actually executes a task, `mcp__ruflo__agent_execute`,
runs it via the **Anthropic Messages API** (haiku/sonnet/opus) — not
Ollama — and requires `ANTHROPIC_API_KEY`. That key is deliberately absent
from the `ruflo` server's env in `.mcp.json` here, consistent with
`SYNAPSE_ALLOW_CLOUD_DEFAULT: false`. So in this project's current config,
economy-tier delegation cannot silently run for free through this tool —
either a separate local worker/swarm process would need to be running (not
just `ruflo mcp start`, which only serves the MCP tool surface), or someone
explicitly opts a scoped `ANTHROPIC_API_KEY` in for Haiku-tier execution
(a real, smaller cost, not zero).

## Why this still helps

- Steps 1, 4, and 5 (classification, shared memory, summary-only pull-back)
  work today and reduce this session's own context/token use regardless of
  who executes the task.
- Step 3's routing/task-tracking is real and reusable once an executor
  exists — no rework needed when one is wired up.
- Until then, treat "delegate" as "route + track + do it cheaply yourself,"
  not "hand off for free."

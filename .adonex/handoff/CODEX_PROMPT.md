# Codex Handoff: implementar autenticaÃ§Ã£o envolvendo React, FastAPI e Postgres

Generated: 2026-06-15T14:26:50.859Z

## Objective

implementar autenticaÃ§Ã£o envolvendo React, FastAPI e Postgres

## Shared Project Memory

--- AGENTS.md
# SYNAPSE Local-First

- Use Ollama para triagem, resumo, classificacao, planejamento inicial e revisao de codigo.
- Use `ask_ollama` para uma tarefa local direta.
- Use `execute_governed_swarm` com `allow_cloud=false` para fluxos Ruflo.
- Cloud exige pedido explicito do usuario e aprovacao humana.
- Comece com um agente; escale somente quando o problema exigir outros dominios.
- Nunca ative os 60 agentes por padrao.
- Envie apenas arquivos e trechos relevantes. Comprima contexto grande antes do modelo.
- Limite respostas locais normalmente a 512 tokens e contexto a 4096 tokens.
- O dialogo do Codex ainda usa o modelo configurado pela extensao; ferramentas locais reduzem
  delegacao e geracao cloud, mas nao tornam a conversa do Codex gratuita.


--- .adonex/memory/AGENT_CONTEXT.md
# Agent Context

## Quick Instructions
Read the core memory before planning. Work with focused context and preserve history.

## Project Summary

## How To Work
Plan before implementation, select only relevant files, validate changes, and record outcomes.

## Recording Changes
Append task history and decisions. Update current state without erasing historical logs.

## Tool Routing
- Use Codex for complex multi-file or cross-system implementation.
- Use AdoneX for governed workspace workflows.
- Use Ollama for local triage, summaries, classification, and initial review.


--- .adonex/memory/CURRENT_STATE.md
# Current State

## Current Project State

## Last Completed Task

## Ready Features

## Features In Development

## Open Problems

## Next Steps


--- .adonex/memory/CODING_STANDARDS.md
# Coding Standards

## Code Style

## Modular Architecture

## Naming

## Error Handling

## Structured Logs

## Tests

## Documentation

## Security


--- .adonex/memory/PROJECT_MEMORY.md
# Project Memory

## Project Goal

## Business Context

## General Architecture

## Main Stack

## Important Decisions

## Technical Standards

## Integrations

## Constraints

## Next Milestones


--- .adonex/memory/TECH_STACK.md
# Tech Stack

## Languages

## Frameworks

## Database

## AI And LLM

## Agents

## Infrastructure

## Tests

## Local Tools


--- .adonex/memory/OPEN_ISSUES.md
# Open Issues

## Open Bugs

## Technical Risks

## Technical Debt

## Blockers

## Pending Questions

## Resolved


--- .adonex/memory/DECISIONS_INDEX.md
# Decisions Index

| Date | Decision | Reason | Impact |
| --- | --- | --- | --- |


## Current State

# Current State

## Current Project State

## Last Completed Task

## Ready Features

## Features In Development

## Open Problems

## Next Steps


## Relevant Files

- backend/requirements.txt
- output/smoke-projects/codex-ruflo-smoke/backend/requirements.txt
- frontend/package.json
- frontend/tsconfig.json
- artifacts/mlflow/artifacts/1/models/m-e3f239fc65204d8aa5e26b49014b07e5/artifacts/requirements.txt
- artifacts/mlflow/artifacts/1/models/m-eb7b9d384a584bb19eda99eb5edd4358/artifacts/requirements.txt
- output/smoke-projects/codex-ruflo-smoke/frontend/package.json
- output/smoke-projects/codex-ruflo-smoke/frontend/tsconfig.json
- adonex/tsconfig.json
- frontend/lib/api.ts
- package.json
- adonex/test/taskRouter.test.ts
- backend/app/agents/required.py
- output/factory-validation/SYNAPSE_qwen32b_contract_test_v2/README.md
- .claude/agents/specialized/spec-mobile-react-native.md
- docker-compose.yml
- evals/README.md
- guardrails/README.md
- llm_ops/README.md
- memory/README.md

## Constraints

- Preserve existing project memory and unrelated user changes.
- Use focused context and the existing project architecture.
- Do not write or run commands without explicit approval.

## Coding Standards

# Coding Standards

## Code Style

## Modular Architecture

## Naming

## Error Handling

## Structured Logs

## Tests

## Documentation

## Security


## Safety Rules

- Never read, expose, or modify .env, credentials, API keys, tokens, passwords, or private keys.
- Redact suspected secrets.
- Do not delete memory history.
- Do not modify sensitive files.

## Expected Steps And Output

- Implement the requested change.
- Run the smallest relevant validation.
- Summarize files changed, commands, decisions, problems, and next steps.

## Memory Files To Read First

- AGENTS.md
- .adonex/memory/AGENT_CONTEXT.md
- .adonex/memory/CURRENT_STATE.md
- .adonex/memory/CODING_STANDARDS.md
- .adonex/memory/OPEN_ISSUES.md

## Post-Execution Instructions

- Write the technical result to .adonex/handoff/CODEX_RESULT.md.
- Do not erase or rewrite historical memory logs.
- Leave memory synchronization to AdoneX after execution.

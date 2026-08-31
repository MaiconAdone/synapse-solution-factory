# Capitulo 7 — Contrato Para Assistentes

## Codex

Leia `AGENTS.md`, esta especificacao e `config/llm_solution_factory_policy.json`.
Antes de criar projeto ou implementar solucao empresarial, consulte o
analisador e use a analise como plano de arquitetura.

## Claude Code

Leia `CLAUDE.md`, esta especificacao e a policy. Use a analise como ADR
operacional. Preserve prompt caching e contexto pequeno.

## AdoneX E VS Code Chat

Receba o pedido pela conversa, colete lacunas minimas, prefira Ollama local e
consulte o analisador antes de sugerir arquitetura ou gerar handoff para
Codex.

## Ruflo

Use a analise para escolher fleets e especialistas. O padrao e um
orquestrador; especialistas entram por dominio e 60 agentes exigem aprovacao
explicita.

# Capitulo 6 — Governanca De LLMs

- Preferir Ollama local para triagem, classificacao, resumo, planejamento e
  revisao inicial.
- Cloud e opt-in: exige pedido explicito e aprovacao humana.
- Comecar com um agente.
- Escalar Ruflo por dominio somente quando necessario.
- Nunca ativar 60 agentes por padrao.
- Usar `config/cost_optimization_policy.json` antes de ampliar agentes.
- Usar `synapse-peers` para handoff curto entre Codex, Claude, AdoneX, Ruflo
  e operadores humanos.

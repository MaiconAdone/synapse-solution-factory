# Cheatsheet

| Pergunta | Resposta rapida | Capitulo |
|---|---|---|
| Por onde comeco a coletar um pedido novo? | Pelo chat (VS Code Chat, AdoneX, Claude Code ou Codex) — nunca por task/script direto | [ch01](chapters/ch01-regra-principal.md) |
| Faltou objetivo/problema/metrica/dados/risco, o que faco? | Pergunte, no maximo 5 perguntas nesse turno | [ch02](chapters/ch02-protocolo-de-perguntas.md) |
| Onde confirmo uma regra de custo/agentes/fleet? | `config/cost_optimization_policy.json`, `config/agent_fleets.json`, `config/agent_trust_framework.json` | [ch03](chapters/ch03-fontes-de-verdade.md) |
| Qual o comando do analisador de solucao? | `python .\scripts\analyze_business_solution.py --project-root ... --universe ...` | [ch04](chapters/ch04-fluxo-obrigatorio.md) |
| Projeto e ML, o que aplicar? | MLOps: contrato de dados, baseline, features, registry, model card, drift | [ch05](chapters/ch05-arquitetura-por-universo.md) |
| Projeto e IA/RAG/Agentes, o que aplicar? | RAG + MCP + guardrails + memoria governada + roteamento local-first | [ch05](chapters/ch05-arquitetura-por-universo.md) |
| Quantos agentes ativar por padrao? | 1; escalar por dominio; 60 exige aprovacao explicita | [ch06](chapters/ch06-governanca-de-llms.md) |
| Posso usar cloud direto? | Nao — opt-in, exige pedido explicito + aprovacao humana | [ch06](chapters/ch06-governanca-de-llms.md) |
| O que muda para Claude Code especificamente? | Ler `CLAUDE.md` + esta spec + policy; usar analise como ADR; preservar prompt caching | [ch07](chapters/ch07-contrato-para-assistentes.md) |
| Como valido depois de implementar? | `pytest tests/test_backend_contracts.py` e `tests/test_business_transformation.py` | [ch08](chapters/ch08-validacao.md) |

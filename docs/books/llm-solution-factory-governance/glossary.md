# Glossario

- **Analisador de solucao de negocio** — `scripts/analyze_business_solution.py` /
  `backend/app/services/business_solution_analyzer.py`. Ponto de passagem
  obrigatorio antes de decidir arquitetura. Ver [ch01](chapters/ch01-regra-principal.md), [ch04](chapters/ch04-fluxo-obrigatorio.md).
- **Canais autorizados** — VS Code Chat, AdoneX, Claude Code, Codex. Unicos
  lugares onde objetivos/restricoes/aprovacoes podem ser coletados. Ver [ch01](chapters/ch01-regra-principal.md).
- **Fleet / Ruflo** — camada de orquestracao de agentes por dominio; padrao e
  um agente, escala so quando necessario. Ver [ch06](chapters/ch06-governanca-de-llms.md), [ch07](chapters/ch07-contrato-para-assistentes.md).
- **SDD gate** — sequencia obrigatoria antes de implementar: problema,
  arquitetura, dados, agentes/RAG, ferramentas, testes, evals, custos,
  governanca, plano. Ver [ch04](chapters/ch04-fluxo-obrigatorio.md).
- **Solution Factory** — conjunto compartilhado (memoria, policy, analisador,
  catalogo, governanca, testes, evals) acessado igualmente pelos 4 canais.
  Ver [ch01](chapters/ch01-regra-principal.md).
- **Universo** — classificacao do projeto: ML, IA/RAG/Agentes, Chatbolt ou
  Hibrido. Define a checklist de arquitetura a aplicar. Ver [ch05](chapters/ch05-arquitetura-por-universo.md).

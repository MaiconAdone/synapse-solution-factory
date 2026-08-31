# Padroes recorrentes

- **Dialogo antes de tooling.** Em todo canal, a conversa coleta o conteudo;
  tasks/scripts/MCP so executam depois. Repetido em [ch01](chapters/ch01-regra-principal.md) e [ch07](chapters/ch07-contrato-para-assistentes.md).
- **Perguntar em vez de inventar.** Sempre que faltar objetivo, problema,
  metrica, dados ou risco, o protocolo e perguntar (max. 5 perguntas por
  turno), nunca assumir. Ver [ch01](chapters/ch01-regra-principal.md), [ch02](chapters/ch02-protocolo-de-perguntas.md).
- **Analise como ADR.** `config/business_solution_analysis.json`, gerado pelo
  analisador, funciona como decisao arquitetural registrada — nao se
  reimplementa a arquitetura por conta propria. Ver [ch04](chapters/ch04-fluxo-obrigatorio.md).
- **Escala de agentes por necessidade.** Comecar com 1 agente; Ruflo/fleets
  entram por dominio; 60 agentes exige aprovacao explicita em qualquer
  contexto. Ver [ch06](chapters/ch06-governanca-de-llms.md).
- **Local-first, cloud opt-in.** Ollama e o default para triagem/resumo/
  revisao; cloud so com pedido explicito + aprovacao humana. Ver [ch06](chapters/ch06-governanca-de-llms.md).

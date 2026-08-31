# LLM Solution Factory Governance — Skill Index

Skill pack gerado por `/book-to-skill` a partir de
`docs/specifications/llm_solution_factory_governance.md`. Este e o contrato
operacional para Codex, Claude Code, AdoneX, VS Code Chat, Ruflo e modelos
Ollama ao criar ou implementar solucoes no Synapse.

Comece por `cheatsheet.md` — na maioria das perguntas ele basta. Abra um
capitulo especifico só quando precisar do texto completo de uma secao.

## Mental model

A dialogo (chat) e sempre o caminho de coleta de conteudo; tasks/scripts/MCP
so executam atalhos. Nenhuma arquitetura e decidida sem passar pelo
analisador de solucao de negocio primeiro.

## Indice de capitulos

| Capitulo | Cobre | Quando abrir |
|---|---|---|
| [ch01-regra-principal](chapters/ch01-regra-principal.md) | Regra principal, canais autorizados, o que nunca inventar | Duvida sobre por onde o pedido do usuario deve passar antes de implementar |
| [ch02-protocolo-de-perguntas](chapters/ch02-protocolo-de-perguntas.md) | As 5 perguntas de briefing e o protocolo de universo ambiguo | Falta objetivo/problema/metrica/dados/risco e voce precisa perguntar |
| [ch03-fontes-de-verdade](chapters/ch03-fontes-de-verdade.md) | Lista de arquivos-fonte (policy, catalogo, analisador, specs) | Precisa confirmar onde uma regra ou config especifica vive |
| [ch04-fluxo-obrigatorio](chapters/ch04-fluxo-obrigatorio.md) | Os 8 passos obrigatorios, incluindo o comando do analisador | Vai executar criacao/implementacao de projeto ponta a ponta |
| [ch05-arquitetura-por-universo](chapters/ch05-arquitetura-por-universo.md) | O que usar em ML, IA/RAG/Agentes, Chatbolt, Hibrido | Ja sabe o universo e precisa da checklist de arquitetura dele |
| [ch06-governanca-de-llms](chapters/ch06-governanca-de-llms.md) | Ollama local-first, cloud opt-in, escala de agentes | Duvida sobre qual modelo/quantos agentes usar |
| [ch07-contrato-para-assistentes](chapters/ch07-contrato-para-assistentes.md) | Contrato especifico por assistente (Codex, Claude Code, AdoneX, Ruflo) | Precisa saber o que MUDA de comportamento por canal |
| [ch08-validacao](chapters/ch08-validacao.md) | Comandos de teste/validacao pos-implementacao | Terminou de implementar e precisa validar |

Ver tambem: [glossary.md](glossary.md), [patterns.md](patterns.md),
[cheatsheet.md](cheatsheet.md).

# Contexto Compartilhado Codex + VS Code Chat

Este arquivo e a memoria operacional curta compartilhada entre Codex e o chat do
VS Code neste workspace.

## Como usar

- Antes de iniciar uma tarefa, leia `AGENTS.md` e este arquivo.
- Atualize este arquivo quando houver mudanca relevante de objetivo, decisao,
  restricao operacional ou estado atual do trabalho.
- Mantenha entradas curtas. Para logs longos, relatorios e artefatos, registre
  apenas o caminho e o resumo.
- Nao cole catalogos grandes de agentes, manifests longos, `.claude-flow`,
  `output/`, artifacts ou memoria completa sem necessidade direta.
- Use Ollama/Ruflo local-first conforme `AGENTS.md`; cloud somente com pedido
  explicito e aprovacao humana.

## Estado Atual

- Projeto: `synapse-ai`.
- Fluxo oficial: trabalhar pelo VS Code, sem depender de navegador.
- Memoria runtime: `memory/project_memory.runtime.json`.
- Memoria persistente/eventos: `memory/synapse_learning_memory.jsonl`.
- Documentacao de fluxo VS Code: `docs/vscode-workflow.md`.

## Protocolo De Atualizacao

Ao encerrar uma tarefa relevante, registre aqui:

```text
Data:
Objetivo:
Arquivos tocados:
Decisoes:
Proximo passo:
```

## Ultimas Notas

Data: 2026-06-17
Objetivo: compartilhar contexto de trabalho entre Codex e o chat do VS Code.
Arquivos tocados: `memory/codex-vscode-context.md`, `.github/copilot-instructions.md`, `memory/README.md`.
Decisoes: usar arquivo versionado no workspace como fonte de verdade curta; evitar depender de memoria interna/efemera de extensoes.
Proximo passo: ao usar o chat do VS Code, pedir explicitamente para considerar `.github/copilot-instructions.md`, `AGENTS.md` e este arquivo quando a extensao nao carregar instrucoes automaticamente.

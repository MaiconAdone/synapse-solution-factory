# AdoneX

O AdoneX é um agente local de engenharia de software e IA para o VS Code. Ele usa
exclusivamente modelos instalados no Ollama para analisar o workspace, planejar,
propor alterações, revisar código e apoiar validações sem enviar prompts para
provedores de LLM em nuvem.

Claude Code e Codex continuam integrados ao fluxo do Synapse como canais parceiros
de memória e handoff. Eles não são servidores nem provedores de LLM do AdoneX.

## Local por definição

- Todas as gerações do AdoneX usam Ollama e modelos locais aprovados pelo Synapse.
- Os perfis Econômico, Balanceado local, Forte local, Local/Ollama e Synapse não
  encaminham conteúdo para OpenAI, Anthropic ou outro provedor externo.
- O gateway local sempre envia `allow_cloud=false` e rejeita respostas originadas
  por provedores não locais.
- Prompts, contexto selecionado e memória permanecem no ambiente local.
- O custo estimado de nuvem para execuções do AdoneX é zero.

## Provedor exclusivo

O AdoneX usa exclusivamente o Ollama. OpenAI/Codex e Anthropic/Claude Code sao canais parceiros para memoria e handoff, mas nao sao provedores do AdoneX.

## Capacidades

- Participante nativo do VS Code Chat disponível como `@adonex`.
- Planejamento, implementação, revisão, testes, documentação e correção assistida.
- Patches governados com prévia, confirmação, backup e proteção de caminhos.
- Execução controlada de comandos e bloqueio de operações perigosas.
- Seleção contextual de arquivos com redação de segredos.
- Perfis locais do Ollama para tarefas rápidas, código, planejamento e raciocínio.
- Conselho Ruflo seletivo e comprimido para tarefas do Synapse.
- Ferramentas MCP e integração com o assistente de voz Vick.
- Memória compartilhada entre AdoneX, VS Code Chat, Claude Code e Codex.

## Editor pro local

O AdoneX funciona como editor de código profissional com modelos locais:

- **Composer agêntico multi-arquivo** (`AdoneX: Open Composer`): plano →
  proposta → revisão por arquivo (badge create/modify/delete, +/−, diff
  nativo) → aplicação seletiva com backup e rollback.
- **Edição inline** (`Ctrl+Alt+K`): reescreve somente a seleção via
  WorkspaceEdit, com undo nativo; bloqueia secrets e caminhos sensíveis.
- **Autocomplete inline** (ghost text): fill-in-middle 100% local via Ollama,
  com debounce, cancelamento e timeout. Configurável em
  `adonex.inlineCompletion.*` e `adonex.inlineEdit.*`.
- **Contexto rico por menções**: `@arquivo`, `@selection`, `@file` e `@editor`
  viram contexto no chat; botão `@` com QuickPick.
- **Painel de chat**: chat especialista Synapse, botão parar funcional e
  indicador de andamento das execuções.
- **Router agent e control center**: roteamento econômico entre perfis locais
  do Ollama e administração local das execuções.

## Modos locais

- **Econômico**: tarefas rápidas e respostas curtas em modelo local leve.
- **Balanceado local**: análise e revisão com perfil Ollama intermediário.
- **Forte local**: código, planejamento ou raciocínio com modelos locais maiores.
- **Local / Ollama**: execução local direta.
- **Synapse**: perfil local com governança, memória, Ruflo e MCP.

Todos os modos acima são locais. Selecionar Balanceado ou Forte não habilita nuvem.

## Fluxo governado

O AdoneX planeja antes de executar. Alterações podem ser preparadas para revisão,
aplicadas com backup e validadas por comandos relacionados. Segredos, caminhos
sensíveis, escapes do workspace e comandos perigosos permanecem bloqueados.

Em workspaces Synapse detectados, o modo autônomo pode planejar, preparar patches,
executar testes permitidos, capturar falhas e propor uma correção controlada. As
políticas de aprovação e segurança continuam valendo.

## Memória e canais parceiros

A continuidade entre ferramentas usa:

- `.adonex/memory/SHARED_DIALOG_MEMORY.md`
- `.adonex/memory/CHAT_TASKS.md`
- MCP local `synapse-peers`

Claude Code e Codex podem consumir ou registrar resumos e receber handoffs. Essa
integração não transforma esses canais em provedores do AdoneX.

## Vick e ponte local

A ponte HTTP opcional permite que a Vick web acione o fluxo governado do AdoneX.
Ela escuta apenas em `127.0.0.1`, exige token e permanece desativada por padrão.

Configurações principais:

- `adonex.bridge.enabled`
- `adonex.bridge.port`
- `adonex.bridge.token`
- `adonex.voice.requireConfirmationForPatch`
- `adonex.patch.applyMode`

## Uso no VS Code

Abra o Chat do VS Code e use `@adonex`:

```text
@adonex /plan planeje observabilidade para os agentes
@adonex /review revise o pipeline RAG
@adonex /implement adicione health check ao backend
@adonex /agent crie um agente de avaliação de respostas
@adonex /mcp crie uma ferramenta MCP somente leitura
```

Mantenha o Ollama em execução. Use `AdoneX: Test Ollama Connection` para verificar
a conexão local a partir do Extension Host.

## Desenvolvimento

```powershell
cd adonex
npm install
npm test
npm run package
```

O pacote de produção inclui o runtime compilado da extensão e não inclui clientes
ou SDKs da OpenAI e Anthropic.

## Recursos avancados locais

- `@adonex /search` pesquisa o workspace com indice local e contexto comprimido.
- `@adonex /improve` prepara melhorias governadas usando Ollama.
- `AdoneX: Improve Selected Code` reconhece o arquivo e a selecao ativos.
- Patches preservam previa, aprovacao humana, backup, validacao e rollback.

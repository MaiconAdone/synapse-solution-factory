# Synapse - recuperação de Codex e Claude Code

## Falhas confirmadas

1. `.codex/config.toml` tinha BOM UTF-8 (`EF BB BF`), que provoca erro de parsing TOML em leitores estritos.
2. `default_tools_approval_mode = "auto"` não é uma chave válida do Codex atual.
3. Essa chave estava depois de `[mcp_servers.SYNAPSE_ollama]`, portanto pertencia à tabela do servidor MCP, não à configuração raiz.
4. O Codex usa `approval_policy` (`untrusted`, `on-request` ou `never`) e `sandbox_mode` (`read-only`, `workspace-write` ou `danger-full-access`).
5. Os comandos dos hooks em `.claude/settings.json` têm aspas incompatíveis com `cmd /c`; o fechamento ocorre antes de `%CLAUDE_PROJECT_DIR%`, podendo falhar em SessionStart, UserPromptSubmit e em todas as ferramentas.
6. `permissions.defaultMode = "auto"` depende de versão, plano, modelo, provedor e habilitação administrativa. Quando os requisitos não são atendidos, o Claude Code informa que o modo não está disponível.

## Perfil aplicado

- Codex: `approval_policy = "never"` com `sandbox_mode = "workspace-write"`.
- Claude Code: `acceptEdits`, para restaurar edição automática dentro do workspace.
- Hooks do projeto removidos temporariamente para isolar o erro de inicialização.

## Instalação

Faça backup e substitua somente:

- `.codex/config.toml`
- `.claude/settings.json`

Depois feche todas as janelas do VS Code e encerre processos `codex`, `claude` e `node` relacionados ao Synapse antes de abrir novamente.

## Observação sobre AdoneX

O ZIP é parcial e não contém o código da extensão/bridge nem os scripts referenciados. As chaves em `.vscode/settings.json` estão sintaticamente válidas, mas não é possível confirmar se a versão instalada do AdoneX reconhece `adonex.security.requireApprovalBeforeWrite` e `adonex.security.requireApprovalBeforeCommand` sem o `package.json` da extensão ou os logs do Extension Host.

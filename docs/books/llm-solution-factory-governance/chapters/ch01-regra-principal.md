# Capitulo 1 — Regra Principal

Toda criacao ou implementacao de projeto deve partir da caixa de dialogo e
passar pelo analisador de solucao de negocio antes da arquitetura final.

Tasks do VS Code podem existir como atalho, mas nao sao o caminho obrigatorio.
Quando o usuario pedir pela conversa, o assistente deve coletar o minimo de
contexto, consultar o analisador e executar a implementacao.

## Canais autorizados

Conteudo solicitado pelo usuario (objetivos, restricoes, arquivos, decisoes,
aprovacoes, lacunas de briefing) so pode ser coletado ou confirmado por estes
canais de chat, antes de usar tasks, scripts, navegador ou ferramentas:

- VS Code Chat
- AdoneX
- Claude Code
- Codex

Tasks, scripts, MCP tools e browser UI podem executar atalhos, validacoes,
scaffolding ou integracoes, mas nao substituem a coleta de conteudo pelo
dialogo.

## Solution Factory compartilhada

Todos os quatro canais devem acessar a mesma Solution Factory: memoria
compartilhada, policy, analisador de solucao, catalogo de tecnologia,
governanca, testes e evals.

## O que nunca inventar

Se faltar qualquer informacao essencial, o assistente deve perguntar ao
usuario pela propria conversa antes de criar ou implementar. Nunca inventar:

- problema de negocio
- metrica de sucesso
- dados/fontes disponiveis
- nivel de risco
- aprovacao de cloud
- aprovacao para ativar todos os 60 agentes

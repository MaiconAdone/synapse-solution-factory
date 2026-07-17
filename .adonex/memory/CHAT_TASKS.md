# Chat Tasks

Tarefas solicitadas pela caixa de dialogo do VS Code, Codex, Claude Code ou
AdoneX. Cada assistente deve consultar esta tabela antes de pedir contexto que
ja foi fornecido.

| Date | Source | Status | Objective | Notes |
| --- | --- | --- | --- | --- |
| 2026-07-09 | Codex | done | Substituir Vick existente por assistente local de voz integral do AdoneX, mantendo layout da porta 3000 | Faster Whisper local na porta 8765, wake Vick, frontend e AdoneX no mesmo fluxo, comandos/patches governados; motor e microfone ativos, web/API 200, frontend TS passou e AdoneX 109/109 testes. |
| 2026-07-09 | Codex | analysis | Verificar VS Code, Cursor e hectorg2211/jarvis para criar Jarvis no AdoneX/Synapse | Jarvis externo e launcher por aplauso, nao agente; integrar apenas ideia/detector em processo local, preservar Vick/AdoneX como cerebro e VS Code como host principal; Cursor opcional; sem copia de codigo enquanto nao houver licenca. |
| 2026-07-08 | Codex | done | Transformar navegador em interface futurista da Vick digital | Home do frontend agora usa avatar Vick, saudacao inicial falada, comando de voz, caixa de dialogo e respostas por voz; fallback local se backend/proxy Ollama nao responder; `npm run lint` passou e Next esta em `http://localhost:3000`. |
| 2026-07-08 | Codex | done | Melhorar AdoneX para uso como motor de edicao do assistente de voz | Implementados prepare/apply, resumo falado de diff, cancelamento, undo, estados de voz, sandbox de comandos com categoria/risco e testes; AdoneX 103 testes e backend 104 testes passaram; Extension Host bloqueado por update do VS Code. |
| 2026-07-07 | Codex | done | Testar AdoneX para edicao de codigo | Smoke test temporario confirmou rota `implement` governada e patch `Jerico` -> `Synapse`; `npm test -- --runInBand` no AdoneX passou com 101 testes. |
| 2026-07-07 | Codex | done | Explicar e corrigir por que Ollama/AdoneX nao editou pedido com corrija + Ollama | Causa: prioridade do roteador avaliava inventario/modelos antes de correcao; pedido caiu em chat `synapse_explain`; regra invertida e teste adicionado; AdoneX 101 testes e backend 104 testes passaram. |
| 2026-07-07 | Codex | done | Corrigir AdoneX trocando Synapse por Jerico e resposta generica do Ollama | `responseSanitizer` troca nomes incorretos por Synapse e substitui checklist generico; prompts reforcam nome canonico e resposta concreta; `npm test -- --runInBand` passou com 100 testes. |
| 2026-07-07 | Codex | done | Verificar e corrigir timeouts frequentes do Ollama | Causa: roteamento para modelos lentos/cold start e `qwen3:8b` competindo em CPU; descarregado 8B, AdoneX/MCP agora preferem `qwen2.5-coder:3b`, saida curta e escalam modelos grandes so por pedido explicito; AdoneX 98 testes e backend 104 testes passaram. |
| 2026-07-07 | Codex | done | Verificar se o livro `machine learning.pdf` melhora o Synapse ML | PDF usado como referencia conceitual sem copiar texto; adicionados gates de fundamentos de ML, analyzer/briefing, heranca em projetos ML/hibridos e testes; `python -m pytest tests/test_backend_contracts.py -q` passou com 104 testes. |
| 2026-07-07 | Codex | done | Usar AdoneX como agente de codificacao para editar/programar alteracoes no Synapse | Roteamento natural para implementacao governada; implementacao em contexto Synapse preferindo `adonex-local`; `npm test` em `adonex` passou. |
| 2026-07-07 | Codex | done | Evoluir AdoneX com modelo externo LLM para agentic coding profissional | Explicit external LLM route usa `strong` governado; prompt compiler e base prompt reforcam ciclo profissional; Synapse autonomo nao executa `balanced/strong`; `npm test` em `adonex` passou com 89 testes. |
| 2026-07-07 | Codex | done | Ajustar fluxo Ollama para nao cair em deterministico | Removido retorno fixo de inventario Synapse; Ollama passa a analisar intencao/tarefa/comandos antes de responder; chat local usa temperatura minima 0.15; `npm test` em `adonex` passou com 90 testes. |
| 2026-07-07 | Codex | done | Conectar modelos locais disponiveis ao AdoneX | Criado catalogo de perfis locais com parametros de chamada, configs por perfil no manifesto, roteamento de gateway/Ollama por perfil e testes; `npm test` em `adonex` passou com 93 testes. |
| 2026-07-07 | Codex | done | Ajustar Ruflo 60 agents para melhorar AdoneX com modelos locais | Ruflo agora usa conselho seletivo comprimido por tarefa/perfil local, default `maxAgents=8`, 60 so por pedido explicito, gates de qualidade para patch/testes; `npm test` em `adonex` passou com 94 testes. |
| 2026-07-07 | Codex | done | Aproximar AdoneX do Codex em edicoes de codigo | Implementado patch incremental seguro (`operations`), conflito por anchor/expected, prompts atualizados, diagnostico estruturado de falhas e testes; `npm test` em `adonex` passou com 97 testes. |
| 2026-07-07 | Codex | done | Garantir que todo projeto criado pelo Synapse herde AdoneX completo | `create_ai_project.ps1` copia `adonex/` completo sem build/deps pesados; manifests local/gerenciado declaram runtime completo; contratos pytest focados passaram. |
| 2026-07-07 | Codex | done | Criar camada de tecnologia para transformar problema de negocio em solucao tecnica | Catalogo inclui CrewAI, Swarms, LangChain, LangGraph, LangFlow, Flowise, Dify, n8n, Firecrawl, Deep Research, Awesome Lists, Vector DBs, RAG, KAG, MLflow, FastAPI, Ollama e MCP; analyzer/briefing/scaffold atualizados; `python -m pytest tests/test_backend_contracts.py` passou com 102 testes. |
| 2026-07-07 | Codex | done | Integrar VS Code Chat, AdoneX, Claude Code e Codex na criacao de solucoes corporativas | Canais autorizados e regra de coleta por chat declarados em policy/runtime/instrucoes/templates/scaffold; todos compartilham memoria, analyzer, catalogo tecnologico, governanca, testes e evals; backend 102 testes e AdoneX 97 testes passaram. |
| 2026-07-07 | Codex | done | Verificar por que modelos locais caiam no deterministico ao perguntar no AdoneX | Causa: seed 42 fixa no cliente Ollama TS e no backend Ollama mesmo com temperatura positiva; corrigido para perguntas abertas sem seed e seed restrita a JSON/patch/test/commit; AdoneX 98 testes e backend 103 testes passaram. |
| 2026-07-07 | Codex | done | Remover fallback deterministico de emergencia no AdoneX | Timeout do Ollama agora cai em fallback analisado: classifica intencao, tipo de pedido, comandos, arquivos, lacunas de briefing e proximo passo; nao gera explicacao pronta nem finge resposta do modelo; `npm test` em `adonex` passou com 98 testes. |

- Vick browser | user: palavra | reply: Consigo preparar a solucao, mas ainda preciso completar o briefing minimo do Synapse.

Campos faltantes: objetivo do projeto, problema de negocio, universo, metrica de sucesso, dados/fontes disponiveis, nivel de risco.

Use este navegador p

- Vick browser | user: Olá Vick | reply: Consigo preparar a solucao, mas ainda preciso completar o briefing minimo do Synapse.

Campos faltantes: objetivo do projeto, problema de negocio, universo, metrica de sucesso, dados/fontes disponiveis, nivel de risco.

Use este navegador p
| 2026-07-08 | Codex | done | Configurar voz feminina para a Vick no navegador | Selecao prioriza vozes femininas pt-BR, trata `voiceschanged` e aplica fallback de timbre; lint TypeScript passou. |
| 2026-07-08 | Codex | done | Corrigir acentos da Vick no navegador | Textos visuais, falas, fallbacks e prompt em pt-BR foram acentuados; lint TypeScript passou. |
| 2026-07-08 | Codex | done | Ampliar dialogo da Vick, resumir fala e atualizar identidade do navegador | Painel maior e rolavel, voz limitada ao resumo relevante, favicon SYNAPSE.png e titulo Synapse AI; lint e smoke HTTP passaram. |
| 2026-07-08 | Codex | done | Criar rede neural animada para Vick e menu de voz | Rede muda de cor por estado; menu oferece velocidade e perfis femininos Natural, Suave e Clara; lint e smoke HTTP passaram. |
| 2026-07-08 | Codex | done | Fazer Vick responder com contexto real do Synapse | Nova rota local consulta projetos, memoria e Ollama; perguntas operacionais respondem em ~162 ms e deixam de cair no fallback generico; lint e HTTP passaram. |
| 2026-07-08 | Codex | done | Corrigir Vick sem ouvir o microfone | Permissao explicita, estados de deteccao, erros detalhados e protecao contra envio duplicado adicionados; lint e HTTP passaram. |
| 2026-07-08 | Codex | done | Ativar Vick por wake word e corrigir captura parcial/lentidao | Escuta continua por Vick/Vic/Vik, frase acumulada com debounce, pausa contra autoescuta e intents Synapse em 38-263 ms; lint e HTTP passaram. |
| 2026-07-08 | Codex | done | Corrigir comando nao capturado apos dizer Vick | Buffer incremental persistente, previa interina, janela de silencio de 2,2 s e estados claros adicionados; lint e resposta local em 386 ms passaram. |
| 2026-07-08 | Codex | done | Reduzir novamente a latencia de escuta da Vick | Espera fixa de 2,2 s substituida por 650 ms final/1,1 s interina; lint e HTTP passaram. |
| 2026-07-08 | Codex | done | Separar Vick como ativador e adicionar 10 saudacoes aleatorias | Wake e comando agora usam sessoes distintas; saudacao sorteada sem repetir a anterior; lint, contagem e HTTP passaram. |
| 2026-07-08 | Codex | done | Trocar jerico.png pela nova synapse.png e atualizar navegador | Imagem antiga removida, nova publicada como favicon com hashes iguais; lint passou e servidor permaneceu parado. |
| 2026-07-08 | Codex | done | Tornar respostas da Vick inteligentes e humanizadas | Intencao de criar/listar corrigida, briefing contextual em etapas e historico de 8 mensagens; testes locais em 39-234 ms e lint passaram. |
| 2026-07-08 | Codex | done | Reiniciar servidor e aplicar melhorias de voice coding agent | Next reiniciado na porta 3000; home retornou 200 com Synapse AI e API `/api/vick/chat` respondeu com contexto local. Gates/evals/spec do AdoneX/Vick registrados para wake, ASR e edicao de codigo governada. |
| 2026-07-08 | Codex | done | Corrigir Vick nao capturando resposta do problema de negocio | Depois de pergunta direta da Vick, escuta abre em modo resposta sem repetir wake word; TypeScript e smoke HTTP passaram. |
| 2026-07-08 | Codex | done | Fazer Vick criar projeto ao fechar briefing e adicionar rolagem | Historico completo com scrollbar; briefing preservado em 40 mensagens; risco final aciona `create_ai_project.ps1`; teste criou `projeto-vick` e Vick passou a lista-lo. |
| 2026-07-09 | Codex | done | Restaurar Vick ao estado de 08/07/2026 16h | Estado das 16h confirmado: home Vick na porta 3000, historico completo, `/api/vick/chat` com 40 mensagens, briefing conversacional e criacao local de projeto; TypeScript, HTTP e testes focados do analisador passaram. |

- [2026-07-10 11:44:38 -03:00] Codex: anti-alucina��o AdoneX/Vick implementado e validado com npm --prefix adonex test (117/117).

| 2026-07-17T16:16:12.416Z | vscode-chat | received | pode desfazer as alterções para clude code, codex e adonex editarem código sem necessidade de aprovação humana. volte para o estado sem essas implementações! | route=chat; mode=local |

| 2026-07-17 | Codex | done | Restaurar aprovacao humana para edicao de codigo | Codex voltou a on-request, Claude Code a default e AdoneX a preparar patches e exigir confirmacao/aprovacao antes de escrita e comandos. |

| 2026-07-17 | Codex | done | Corrigir inconsistencias de governanca Codex e AdoneX | Codex referencia a policy e usa o caminho MCP com capitalizacao real; AdoneX autonomia virou opt-in e aprovacoes de escrita/comando prevalecem mesmo quando habilitada. Testes AdoneX 117/117, contrato Codex e enterprise_stack_ok passaram. |

| 2026-07-17 | Codex/OpenAI | briefing | Evoluir AdoneX com capacidades inspiradas no Claude Code | Pedido explicito para usar Codex/OpenAI; escopo inclui busca em bases grandes, fluxo agentico governado, terminal, editor, subagentes, slash commands e MCP. Aguardando metrica, fontes, risco e decisao sobre integracao Anthropic. |

| 2026-07-17 | Codex/OpenAI | done | Evoluir AdoneX com capacidades de agentic coding e Anthropic opcional | Anthropic Messages API opt-in com chave por ambiente e aprovacao por chamada; /search, /improve, contexto do editor, Ruflo/MCP preservados; 122 testes AdoneX, 105 backend, enterprise_stack_ok e frontend build passaram. |

| 2026-07-17 | Codex/OpenAI | done | Separar provedores definitivamente | Codex/OpenAI e Claude/Anthropic editam diretamente sem Ollama; AdoneX ficou Ollama-only; gates humanos e rollback preservados. A integracao Anthropic anterior do AdoneX foi substituida. |

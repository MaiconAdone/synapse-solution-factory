# Shared Dialog Memory

Memoria persistente local compartilhada por VS Code Chat, Codex, Claude Code e
AdoneX neste workspace Synapse.

## Regras

- Registrar somente resumos curtos, decisoes, perguntas pendentes e resultados.
- Nao registrar secrets, credenciais, arquivos inteiros, datasets completos ou diffs longos.
- Usar referencias de arquivos e ids de tarefas quando possivel.
- Usar `synapse-peers` para mensagens curtas entre sessoes ativas.

## Recent Dialog Context

- 2026-08-12 | Claude Code | done | Duas melhorias no pipeline de edicao de codigo local do AdoneX (priorizadas pelo usuario entre 4 mapeadas): (1) escalada de perfil de modelo na correcao automatica — `escalateLocalModelProfile` em adonex/src/llm/localModels.ts sobe um degrau na ladder (fast/general->balanced, balanced/code_review->code_strong, code_strong->code_critical, planning_strong->reasoning_strong, reasoning_strong->code_critical) aplicado em `AgentOrchestrator.selectOllamaProfile` somente quando action==="fix" (repair apos falha de validacao), nunca em acao pedida direto pelo usuario; (2) `ComposerSession.refine()` deixa de recoletar o workspace inteiro (`WorkspaceContext.collect()`, que inclui reranking semantico via Ollama) quando o modo nao mudou e a instrucao nao cita arquivo novo — nova heuristica pura `refinementMentionsUnknownFile` em composerModel.ts decide isso; `generate()` continua sempre recoletando do zero. npm run compile limpo, 283/283 testes unitarios (6 novos) e test:extension (exit 0) passaram.

- 2026-08-11 | Claude Code | done | Metodologia do plugin fable-method (github.com/Sahir619/fable-method, Claude Code plugin, MIT) portada como conteudo para o AdoneX (nao instalavel como plugin: AdoneX e extensao VS Code local-only sobre Ollama, sem o mecanismo de plugin/skill do Claude Code). Adicionado: bloco FABLE_METHOD_POLICY (classificar->definir pronto->evidencia->decidir->agir->verificar->reportar) em adonex/src/agent/prompts.ts, injetado no system prompt do AgentOrchestrator; exigencia de linha "Criterio de pronto:" no summary de implement/fix; detector deterministico detectTestWeakening (validationLoop.ts) que acusa assertions/casos de teste reduzidos, novos skip/only/xit ou arquivo de teste apagado; judge adversarial local (adonex/src/agent/judgeAgent.ts + AgentOrchestrator.runTestWeakeningJudge, modelo fast/3B, fail-closed para "uncertain") acionado SO quando o detector acusa algo, chamado em ComposerSession.repair(); AdoneXPanel bloqueia auto-apply do modo autonomo Synapse quando o warning "fable-judge:" aparece, forcando revisao humana. fable-domain (adapters nao-codigo) ficou fora de escopo por decisao do usuario. npm run compile limpo, 277/277 testes unitarios e test:extension (VS Code real, exit 0) passaram; versao incrementada para 0.15.1, VSIX empacotada e instalada no VS Code (code --install-extension --force).

- 2026-08-03 | Codex | maintenance | Memoria compartilhada compactada para reduzir contexto carregado no VS Code/Codex/Claude/AdoneX: arquivo principal mantem 30 registros estruturados recentes; historico antigo e prompts brutos da Vick foram movidos para .adonex/memory/archive/SHARED_DIALOG_MEMORY_YYYY-MM_ARCHIVE.md. Tambem foram preparados excludes de watcher/search para caches e outputs pesados.

- 2026-07-31 | User/Codex | diagnostic | Claude Code corrigido localmente: logs do VS Code mostravam `No authentication found`, `spawn EINVAL` com `C:\tmp\claude-safe-wrapper.cmd` e timeout de inicializacao no binario 2.1.220. Codex desativou o plugin `codex@openai-codex` no Claude, removeu o pin global `model=claude-opus-4-8`, reinstalou/fixou CLI e extensao no canal estavel 2.1.212, moveu a extensao 2.1.220 para `_disabled` e configurou o VS Code para usar `C:\Users\malves\.local\bin\claude.exe`. Pendente: usuario recarregar o VS Code e refazer login no Claude Code, pois nao havia OAuth token local.

- 2026-07-31 | User/Codex | diagnostic | Seguimento Claude Code: botao de login ficava em `Signing in...`. Logs mostraram `claude auth status parse failed: Unexpected end of JSON input`; `~/.claude.json` tinha caminhos duplicados case-insensitive e foi normalizado com backup. `VaultSvc` estava parado e foi iniciado. Protocolo `claude-cli://` nao existia no registro e foi criado apontando para `C:\Users\malves\.local\bin\claude.exe`. Removido override `claudeCode.claudeProcessWrapper`; VS Code agora passa `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` e `DISABLE_TELEMETRY=1` para Claude Code. Aberta janela interativa nova com `claude auth login --claudeai` para concluir OAuth.

- 2026-07-29 | User/Codex | done | Criado catalogo local de respostas do AdoneX em `.adonex/cache/local-answer-catalog.json`: respostas boas geradas pelo Ollama sao salvas como `model_generated` e reutilizadas por match exato/semelhanca alta, com bloqueios para estado mutavel, anexos e falhas de timeout. O modelo continua sendo a fonte da primeira resposta; AdoneX 225/225 testes passou e VSIX 0.7.15 reinstalada.

- 2026-07-29 | User/Codex | done | Ajuste conceitual do AdoneX: removida a resposta deterministica para pergunta de latencia do modelo local. Perguntas simples continuam indo ao Ollama, mas agora usam contexto enxuto, budget curto e prompt anti-alucinacao para evitar memoria/fallback poluindo a geracao; AdoneX 223/223 testes passou e VSIX 0.7.15 reinstalada.

- 2026-07-29 | User/Codex | done | AdoneX ganhou modo automatico no dropdown: `Auto` classifica a solicitacao e escolhe Local, Balanced, Strong ou Synapse; modo `Economic` removido por nao fazer sentido no runtime local-only/Ollama. Custos cloud de modos locais zerados, settings legadas `economic` normalizam para `auto`; AdoneX 221/221 testes passou e VSIX 0.7.15 reinstalada.

- 2026-07-29 | User/Codex | done | Corrigido startup da AdoneX Bridge quando a porta 127.0.0.1:8766 ja esta em uso: EADDRINUSE agora e tratado como instancia local ja ativa, sem popup de erro nem Promise pendente; teste unitario adicionado, AdoneX 217/217 testes passou, VSIX 0.7.15 reinstalada.

- 2026-07-29 | User/Codex | done | Corrigido painel AdoneX local para nao tratar timeout/falha do Ollama em perguntas simples como "Processo interrompido": cancelamento agora exige AbortController/AbortError real, chat local gera fallback analisado quando qwen2.5-coder:3b nao conclui, teste cobre a regressao; AdoneX 216/216 testes passou, VSIX 0.7.15 empacotada e instalada no VS Code.

- 2026-07-29 | User/Codex | done | Servico local de voz da Vick ajustado para ignorar `ConnectionResetError`/WinError 10054 durante `handle_one_request`, tratando fechamento de polling local como desconexao normal; testes especificos passaram.

- 2026-07-27 | User/Codex | done | Guia oficial de instalacao do Synapse reescrito em UTF-8 para Windows + VS Code do zero: requisitos, clone GitHub/GitLab privado, Python 3.12, Node 22, Ollama, AdoneX/VSIX, validacao, modos VS Code/web, atualizacao e troubleshooting. README passou a apontar ao guia e usar `PROJECT_FACTORY_BASE_PATH`.

- 2026-07-27 | User/Codex | done | Solution Factory ajustada para manter a Vick exclusiva do Synapse: novos projetos nao recebem scripts, autostart/task, configuracoes de voz, manifesto, quality gate, spec ou evals da Vick. Validacao da fabrica agora bloqueia vazamento desses artefatos; 5/5 testes focados passaram.

- 2026-07-27 | User/Codex | done | Projeto `especialista_banco` criado em `C:\Users\malves\Documents\Projetos\especialista_banco`, universo IA e risco alto, para agentes especialistas em tabelas corporativas SQL Server e relatorios automaticos. Inclui analise oficial, um agente inicial sem Ruflo/cloud, policy SQL somente leitura, aprovacao humana, bloqueio deterministico de mutacoes e auditoria JSONL; 16/16 testes passaram. Conexao real aguarda servidor/base e credenciais via secret store.

- 2026-07-27 | User/Codex | briefing | Solicitada criacao do projeto `Previsao de Compradores` no universo ML, com risco alto, para prever compradores de kits escolares. Aguardando problema de negocio, metrica de sucesso e dados/fontes disponiveis antes da analise e implementacao.

- 2026-07-27 | User/Codex | done | Projeto `Previsao de Compradores` criado em `C:\Users\malves\Documents\Projetos\Previsao de Compradores` para estimar compradores e demanda de kits escolares. Universo ML e risco alto; aceite de recall minimo de 80%; dados serao inseridos em `data/`. Analise oficial corrigida para remover falso positivo de chatbot. Scaffold validado e 9/9 testes passaram; ativacao automatica e Ruflo permaneceram desativados.

- 2026-07-27 | User/Codex | done | Interface de atividade do AdoneX redesenhada com fundo preto continuo, separadores principais removidos e estados Thinking/Processing inspirados nos prints de referencia; compilacao e suite AdoneX aprovadas com 215/215 testes.

- 2026-07-24 | User/Codex | done | Projeto `TalentOS` criado em `C:\Users\malves\Documents\Projetos\TalentOS` como solucao hibrida de recrutamento (ML + IA), risco alto. Analise oficial corrigida para classificacao/scoring/priorizacao + RAG/agentes, com LGPD, explicabilidade, auditoria e decisao humana. Scaffold validado; 11/11 testes passaram; Ruflo nao foi ativado.

- 2026-07-24 | Codex | done | Corrigidos matching fuzzy ambiguo e anchors com divergencia de indentacao no PatchEngine do AdoneX; suite completa aprovada com 215/215 testes.

- 2026-07-24 | Codex | done | Restaurada a hierarquia visual da caixa de texto do AdoneX: textarea em largura total e botoes de contexto/envio organizados abaixo; recursos preservados e suite 215/215 aprovada.

- 2026-07-24 | Codex | release | Auditoria final para publicaÃ§Ã£o no GitLab: removidos defaults presos ao usuÃ¡rio local, documentada instalaÃ§Ã£o reproduzÃ­vel em outra mÃ¡quina e ignorados logs/configuraÃ§Ã£o local. ValidaÃ§Ãµes: enterprise stack aprovado, backend 105/105, factory 7/7, frontend lint/build e AdoneX 215/215.

- 2026-07-23 | Codex | done | Respostas institucionais da Vick sobre Synapse, AdoneX e Vick passaram a ser determinÃ­sticas, detalhadas e separadas por intenÃ§Ã£o; pedidos combinados e perguntas sobre o que pode ser solicitado retornam tambÃ©m um catÃ¡logo de exemplos. Endpoint real validado em quatro formulaÃ§Ãµes e TypeScript focado passou; lint global segue bloqueado por referÃªncia preexistente da pasta `.next` Ã  rota removida `app/mlflow/page`.

- 2026-07-23 | Codex | done | Corrigida divergÃªncia da Vick em comandos de voz: eventos tardios do Web Speech nÃ£o podem mais falar â€œnÃ£o entendiâ€ depois que a transcriÃ§Ã£o foi despachada e o briefing comeÃ§ou. Contrato de voz 3/3 e TypeScript passaram.

- 2026-07-23 | Codex | done | CorreÃ§Ã£o reforÃ§ada apÃ³s reproduÃ§Ã£o real: `recognition.onend` nÃ£o infere mais falta de entendimento, pois pode chegar depois do envio. ConfirmaÃ§Ã£o e baixa confianÃ§a usam apenas a transcriÃ§Ã£o do `onresult`. Vick reiniciada na porta 3000; HTTP 200, contrato 3/3 e TypeScript aprovados.

- 2026-07-22 | Codex | done | AdoneX 0.7.14 unificou Chat e Composer em uma unica caixa de dialogo. O roteador identifica pedidos de implementacao e aciona o Composer internamente; a revisao aparece apenas quando existe proposta, mantendo selecao de arquivos, refinamento, aplicacao e undo. Perguntas seguem no chat local e escrita continua sob confirmacao humana. Suite 177/177 passou.

- [claude-code] 2026-07-22T11:27:59.5532498-03:00 chat AdoneX agora cria projetos ML/IA/Chatbolt/Hibrido pela mesma Solution Factory da Vick (briefing multi-turno -> analyzer gate -> create_ai_project.ps1); modulo novo adonex/src/chat/solutionFactory.ts; 186 testes ok

## 2026-07-22 - Claude Code
- Prefix cache do Ollama estabilizado no AdoneX: politicas estaticas movidas do user prompt (promptCompiler) para STATIC_POLICY_PROMPT no system prompt; ordem do system prompt reorganizada (estavel -> semi-estavel -> dinamico) no agentOrchestrator; synapseSystemContext agora usa faixa de confianca (high/medium/low) e linha volatil por ultimo. Objetivo: reduzir prompt-eval em CPU sem GPU. 188 testes ok.

## 2026-07-22 - Claude Code
- Ciclo editar->validar->corrigir fechado no Composer do AdoneX: apos Aplicar, o painel roda os comandos de validacao propostos (ate 3, com gate de aprovacao), e em falha gera UMA correcao automatica via proposeFix reutilizando plano/snapshot; correcao volta para revisao humana, exceto em modo autonomo Synapse (aplica e revalida so o comando que falhou, sem nova correcao). Novos: adonex/src/composer/validationLoop.ts (helpers puros), ComposerSession.repair(). 193 testes ok.

## 2026-07-22 - Claude Code
- Edits cirurgicos no AdoneX: PatchEngine.apply agora reaplica operations incrementais contra o disco ATUAL (edicoes manuais entre proposta e Apply sao preservadas; anchor ausente vira conflito explicito antes de escrever). ComposerSession.apply deixou de descartar operations (era operations: []) e passa as dos arquivos selecionados. Novo helper puro applyOperationsToContents em patch/patchUtils.ts. 195 testes ok.

## 2026-07-22 - Claude Code
- Router de modelos calibrado para CPU-only: feature/high-risk deixou de escalar para qwen2.5-coder:14b denso por padrao (agora deepseek-coder-v2:lite MoE via profile code_review; 14b/32b so por pedido explicito '14b/modelo forte/32b'); fallback de implement/fix saiu do 3b para o lite; analises synapse_architecture/pipeline/roadmap vao para balanced (lite). 3b segue para triagem/chat/resumo. Arquivos: context/codeIntelligence.ts, llm/localModels.ts. 197 testes ok.

- 2026-07-21 | Codex | done | Descricao publica da extensao AdoneX corrigida para UTF-8, removendo mojibake de memoria e integracao. Versao 0.7.5 empacotada e instalada no VS Code.

- 2026-07-21 | Codex | done | Servico local de voz da Vick passou a tratar BrokenPipeError, ConnectionAbortedError e ConnectionResetError como desconexoes normais do polling /events, evitando traceback WinError 10053 sem ocultar outros erros de socket. Teste focado 2/2 passou e py_compile validou o servico.

- 2026-07-21 | Codex | done | AdoneX 0.7.4 separado corretamente: Activity Bar contem somente o centro de Administracao (Configuracoes, APIs, MCP, Modelos Ollama, Memoria e Diagnostico), enquanto Chat/Composer voltou para a Secondary Sidebar junto de Codex e Claude Code. Credenciais usam SecretStorage; MCP permanece desativado por padrao e diagnostico nao executa stdio.

- 2026-07-21 | Codex | done | Nuvem do chat AdoneX evoluida para continuidade entre assistentes: abre painel interno com historico unificado de `SHARED_DIALOG_MEMORY.md` e `CHAT_TASKS.md`, identifica origem/estado, prioriza pending/received/briefing/blocked e permite selecionar `Continuar com AdoneX local`. Retomada consulta memoria/workspace e entra no fluxo governado, mantendo confirmacao humana para patches/comandos. AdoneX 0.6.19 recompilado, 118/118 testes passaram, VSIX reinstalado.

- 2026-07-20 | Codex | done | Painel direto do AdoneX corrigido: perguntas sobre modelos consultam o inventario real do Ollama via `/api/tags`; chat ganhou historico recente, memoria compartilhada e anexos textuais limitados/redigidos. Interface ganhou icone de clipe para ate 5 arquivos/imagens e icone de nuvem que abre `.adonex/memory/SHARED_DIALOG_MEMORY.md`. AdoneX 0.6.19 compilado, 118/118 testes passaram, VSIX empacotado e instalado no VS Code.

- 2026-07-20 | Codex | done | Autostart web da Vick desativado por padrao; adicionados toggle persistente, tasks manuais e intents locais para a propria Vick ativar/desativar a abertura automatica no VS Code.

- 2026-07-20 | Codex | done | Cabecalho web da Vick atualizado: marca textual V substituida por /synapse.png e nome Vick removido; frontend validado com tsc --noEmit.

- [vick] 2026-08-10T12:44:29.137Z sentimento=neutro confianca=low prompt="vamos criar um projeto 'previsao_compradores_2027'"
- [vick] 2026-08-10T12:44:44.595Z sentimento=neutro confianca=low prompt="blema de classficação"
- [vick] 2026-08-10T12:44:55.804Z sentimento=neutro confianca=low prompt="é ML"
- [vick] 2026-08-10T12:45:08.596Z sentimento=neutro confianca=low prompt="m realizar previsão de demanda"
- [vick] 2026-08-10T12:45:27.299Z sentimento=neutro confianca=low prompt="ou colocar após o projeto ser criado"
- [vick] 2026-08-10T12:45:39.282Z sentimento=neutro confianca=low prompt="Alto"
- [vick] 2026-08-10T12:45:39.680Z analyzer-gate projeto=previsao-compradores-2027 status=analyzed requisitado=ia recomendado=ml
- [vick] 2026-08-10T13:40:49.367Z sentimento=neutro confianca=low prompt="vamos criar um projeto 'Chatbolt'"
- [vick] 2026-08-10T13:41:37.982Z sentimento=neutro confianca=low prompt="chat inteligente"
- [vick] 2026-08-10T13:41:43.677Z sentimento=neutro confianca=low prompt="chatbolt"

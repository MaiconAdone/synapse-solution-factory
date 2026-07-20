# Voice Agentic Coding

## Objetivo

Transformar Vick e AdoneX em uma interface de voz para engenharia de software
com ativacao previsivel, transcricao de termos tecnicos, contexto de repositorio,
ferramentas governadas, validacao e rollback.

## Metas De Release

- p95 entre wake word e inicio da escuta menor que 500 ms
- acuracia de palavras maior ou igual a 90% em casos pt-BR representativos
- sucesso de tarefas de codigo maior ou igual a 85%
- rollback bem-sucedido em 100% dos patches reversiveis testados

Essas metas sao gates, nao alegacoes atuais. Resultados devem ser medidos e
registrados antes de declarar conformidade.

## Arquitetura

1. Wake word local e desacoplada do ASR.
2. Estados explicitos: standby, wake detectada, escutando, transcrevendo,
   confirmando, planejando, editando, validando, concluido e recuperacao.
3. ASR local com alternativas, confianca, VAD e vocabulario tecnico pt-BR.
4. Normalizacao limitada a termos canonicos observados, preservando o texto
   original para auditoria.
5. Gerenciador de dialogo combina intencao, historico curto e contexto do
   workspace; ambiguidade de escrita exige pergunta de esclarecimento.
6. Coding loop: entender, inspecionar, planejar, preparar patch, aprovar,
   aplicar, testar, reparar uma vez, registrar recibo e permitir rollback.
7. Telemetria local registra latencia, erro de palavras, conclusao da tarefa,
   aprovacoes, falhas de ferramenta e rollback, sem armazenar audio por padrao.

## Principios Aplicados

- *Speech and Language Processing*: ASR deve ser avaliado com casos
  representativos e erro/acuracia de palavras, incluindo vocabulario do dominio.
- *Designing Voice User Interfaces*: wake, reconhecimento, tratamento,
  confirmacao e recuperacao sao estados diferentes; erros nao devem culpar o
  usuario.
- *Effective Conversational AI*: entender a intencao, coletar somente o contexto
  necessario e concluir a tarefa; falhas observadas alimentam melhoria continua.
- *AI Engineering*: qualidade, custo, latencia e seguranca sao requisitos
  mensuraveis, com evals antes de escalar modelos.
- *LLM Engineer's Handbook*: prompts, contexto, modelo, latencia e resultado
  precisam de versao e observabilidade.
- *Agentic Coding with Claude Code*: contexto persistente, MCP, automacoes,
  subagentes limitados e hooks de validacao devem formar workflows controlados.
- *AI Agents and Applications*: estado, ferramentas, RAG e MCP devem ter
  fronteiras explicitas; multiagentes entram somente quando agregam um dominio.
- *Prompt Engineering for LLMs*: fala transcrita vira contrato com objetivo,
  restricoes, evidencias, ferramentas permitidas e formato de resposta.

## Fontes Legais

- Jurafsky e Martin, Speech and Language Processing:
  https://web.stanford.edu/~jurafsky/slp3/
- Cathy Pearl, Designing Voice User Interfaces:
  https://www.oreilly.com/library/view/designing-voice-user/9781491955406/
- Chip Huyen, AI Engineering:
  https://www.oreilly.com/library/view/ai-engineering/9781098166298/
- Freed, Jacobs e Rozsa, Effective Conversational AI:
  https://www.manning.com/books/effective-conversational-ai
- Roberto Infante, AI Agents and Applications:
  https://www.manning.com/books/ai-agents-and-applications
- Iusztin e Labonne, LLM Engineer's Handbook:
  https://www.packtpub.com/en-us/product/llm-engineers-handbook-9781836200079
- Packt, repositorio de Agentic Coding with Claude Code:
  https://github.com/PacktPublishing/Agentic-Coding-with-Claude-Code

## Validacao

- `config/voice_agent_quality_gates.json` define os limites.
- `evals/voice_agent_cases.jsonl` cobre wake, termos tecnicos e ambiguidade.
- `evals/agentic_coding_cases.jsonl` cobre patch, testes, aprovacao e rollback.
- testes deterministas validam roteamento e contratos; evals medem comportamento.

## Narracao Segura De Progresso

- A Vick confirma o recebimento e inicia a fala em ate 3 segundos.
- Confianca ASR abaixo de 0,6 exige aviso falado; transcricao apenas interina e
  fala sem comando recuperavel tambem geram esclarecimento por voz.
- Codex, Claude Code e AdoneX sao observados somente por eventos estruturados
  locais. A interface traduz esses eventos para estados fixos: inicio, analise,
  leitura, edicao, validacao, espera, conclusao ou interrupcao.
- Texto livre, raciocinio, argumentos de ferramenta, comandos, caminhos, prompts,
  codigo e segredos nunca entram no payload narravel.
- O endpoint e somente leitura, usa cursor temporal de no maximo dez minutos,
  deduplica eventos e nao interfere na execucao ou nas aprovacoes dos agentes.
- A fala de progresso pausa o reconhecimento para evitar autoescuta e preserva
  cancelamento, confirmacao humana, patch prepare e rollback.

### Criterios De Aceite

- `progress_narration_p95_ms <= 3000`
- `low_confidence_notice_rate = 1.0`
- `unsafe_spoken_content_rate = 0.0`
- nenhuma regressao nos gates existentes de wake, tarefa, aprovacao e rollback

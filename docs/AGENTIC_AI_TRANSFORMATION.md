# IA Agentica Aplicada a Transformacao Empresarial

## Objetivo

O SYNAPSE usa IA agentica para transformar objetivos empresariais em processos
mensuraveis, governados e executaveis. A abordagem combina agentes orientados a
objetivos, redesenho de processos, dados, ferramentas, aprovacao humana e
medicao de impacto.

Os principios foram sintetizados, sem reproducao literal, a partir das obras
indicadas sobre empresas orientadas por IA, agentes em operacao, LangGraph,
LangChain, MCP e transformacao empresarial.

## Arquitetura

O workflow `business-transformation` executa:

1. recebimento do objetivo empresarial;
2. diagnostico do contexto;
3. mapeamento do processo atual;
4. identificacao e priorizacao de oportunidades;
5. avaliacao de dados, automacao, risco e adocao;
6. criacao do plano de execucao;
7. aprovacao humana quando exigida;
8. execucao simulada e avaliacao de impacto.

O workflow e deterministico por padrao. Ruflo e o roteador governado de LLMs
podem enriquecer etapas, mas os testes e controles de risco nao dependem de
cloud.

## Agentes Funcionais

- `OrchestratorAgent`: coordena estado, handoffs e consolidacao.
- `BusinessTransformationAgent`: diagnostica e prioriza valor empresarial.
- `ProcessMappingAgent`: mapeia etapas, gargalos e decisoes.
- `DataAnalysisAgent`: avalia dados, evidencias e indicadores.
- `AutomationArchitectAgent`: projeta tools, MCP e integracoes.
- `KPIMonitorAgent`: define baseline, metas e monitoramento.
- `RiskGovernanceAgent`: classifica risco e autonomia.
- `HumanApprovalAgent`: bloqueia ou libera etapas controladas.

Essas capacidades sao perfis de execucao e usam os agentes governados ja
existentes no catalogo de 60 agentes. Nao aumentam artificialmente o tamanho do
swarm.

## Governanca

| Nivel | Regra |
| --- | --- |
| `LOW` | Execucao automatica com auditoria. |
| `MEDIUM` | Execucao com justificativa, validacao e auditoria. |
| `HIGH` | Exige aprovacao humana antes da simulacao. |
| `CRITICAL` | Bloqueado ate aprovacao explicita; nenhuma acao externa automatica. |

Toda execucao registra agente, plano, decisao, tool, risco, aprovacao e
resultado. Tools simuladas sao usadas quando nao existe integracao MCP real.

## API

- `POST /business/diagnosis`
- `POST /business/opportunities`
- `POST /business/transformation`
- `POST /business/transformation/{workflow_id}/approve`
- `GET /business/transformation/{workflow_id}`
- `GET /business/transformation/{workflow_id}/audit`

Endpoints de escrita usam a autenticacao ja adotada pelo SYNAPSE.

## Projetos Criados

Projetos IA, ML e Hibridos recebem:

- configuracao e politica de transformacao empresarial;
- prompt de orquestracao;
- perfis dos agentes funcionais;
- workflow Ruflo;
- documentacao operacional;
- declaracao no manifesto e no contrato de solucao.

Os projetos continuam sem backend, frontend ou fabrica propria. O SYNAPSE
permanece o plano de controle e os projetos executam sua inteligencia pelo
Ruflo, agentes, memoria, prompts, workflows e tools MCP autorizadas.

## Evolucao para LangGraph e MCP

A maquina de estados atual possui contratos independentes de framework. Quando
houver necessidade de checkpoints distribuidos, retomada duravel ou ciclos
complexos, cada etapa pode virar um no LangGraph. Integracoes reais devem ser
expostas como tools MCP com identidade, permissao, idempotencia, auditoria e
compensacao.

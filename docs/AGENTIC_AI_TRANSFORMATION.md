# IA Agentica Aplicada a Transformacao Empresarial

## Objetivo

O SYNAPSE usa IA agentica para transformar objetivos empresariais em processos
mensuraveis, governados e executaveis. A abordagem combina agentes orientados a
objetivos, redesenho de processos, dados, ferramentas, aprovacao humana e
medicao de impacto.

Os principios foram sintetizados, sem reproducao literal, a partir das obras
indicadas em `docs/books/implementation_map.md` (Agentic Artificial
Intelligence, Competing in the Age of AI, All-In on AI, AI Agents in Action,
AI Agents and Applications, Cybernetics, The Society of Mind).

## Fontes De Verdade

| Arquivo | Papel |
| --- | --- |
| `config/business_transformation.json` | Contrato: estagios, perfis, tools, regras de risco, autonomia, priorizacao, KPIs |
| `config/workflows/synapse/business-transformation.json` | Workflow do swarm (mesmos estagios e agentes do contrato) |
| `agents/definitions/business_transformation_agents.yaml` | Perfis funcionais (espelho do contrato) |
| `scripts/synapse_lib/business_transformation.py` | Motor: maquina de estados deterministica, so biblioteca padrao |
| `scripts/run_business_transformation.py` | CLI |
| `templates/business/transformation_brief.json` | Brief de exemplo |
| `evals/business_transformation_cases.jsonl` | Casos de avaliacao de risco, autonomia e aprovacao |
| `prompts/business_transformation.md` | Prompt de orquestracao |

Testes garantem que contrato, workflow e YAML concordam e que todos os agentes
existem no catalogo de 60 agentes.

## Estagios

Cada estagio e executado por um perfil funcional, que usa um agente governado
ja existente no catalogo (os perfis nao aumentam o tamanho do swarm):

| Estagio | Perfil | Agente |
| --- | --- | --- |
| intake | OrchestratorAgent | orchestration-manager |
| diagnosis | BusinessTransformationAgent | product-strategy |
| process_mapping | ProcessMappingAgent | business-value-analyst |
| data_readiness | DataAnalysisAgent | data-science |
| opportunity_identification | BusinessTransformationAgent | product-strategy (+ llm-engineering) |
| prioritization | BusinessTransformationAgent | product-strategy |
| automation_architecture | AutomationArchitectAgent | integration-automation |
| kpi_design | KPIMonitorAgent | metrics-instrumentation |
| execution_planning | OrchestratorAgent | orchestration-manager |
| risk_governance | RiskGovernanceAgent | security-compliance |
| human_approval | HumanApprovalAgent | policy-guardrails-engineer |
| simulation | AutomationArchitectAgent | integration-automation (+ testing-qa) |
| impact_evaluation | KPIMonitorAgent | metrics-instrumentation (+ business-value-analyst) |
| final_report | OrchestratorAgent | orchestration-manager (+ documentation) |

## O Que O Usuario Informa

O motor nunca inventa dados de negocio. Tudo que falta vira
`pending_user_decisions` para ser perguntado no chat:

- objetivo, owner e area (`sales`, `marketing`, `customer_service`,
  `logistics`, `finance`, `human_resources`, `management`);
- mapa do processo atual (etapas, ator humano/sistema, duracao, gargalos);
- fontes de dados e sistemas;
- baseline e meta dos KPIs obrigatorios: `cycle_time`, `rework_rate`,
  `cost_per_case`, `primary_business_outcome`, `adoption_rate`;
- por oportunidade: notas 1-5 de valor, complexidade e prontidao de dados,
  tool usada e fatores de risco.

## Classificacao De Risco

Regras explicitas e deterministicas (`risk_rules`):

| Nivel | Quando |
| --- | --- |
| `CRITICAL` | decisao regulada (credito, contratacao, demissao, saude, sinistros, resultado juridico), acao irreversivel com efeito externo, ou impacto financeiro >= 1.000.000 |
| `HIGH` | efeito externo, irreversivel, dados pessoais, voltado ao cliente, ou impacto financeiro >= 100.000; tambem quando faltam fatores de risco |
| `MEDIUM` | escreve em sistemas internos ou afeta >= 1000 casos/mes |
| `LOW` | nenhum fator presente |

Fator de risco ausente nunca e tratado como seguro: evidencia fraca aumenta a
autoridade humana.

## Autonomia E Aprovacao

| Nivel | Regra | Resultado sem aprovacao | Com aprovacao |
| --- | --- | --- | --- |
| `LOW` | automatica com auditoria | `approved` | - |
| `MEDIUM` | automatica com validacao e auditoria | `approved_with_validation` | - |
| `HIGH` | exige aprovacao humana | `awaiting_human_approval` | `approved` |
| `CRITICAL` | aprovacao explicita e nenhuma acao externa automatica | `blocked_external_action` | `simulation_only_approved` |

## Priorizacao

`score = 0.4*valor + 0.2*prontidao_de_dados + 0.2*simplicidade + 0.2*seguranca`
(tudo normalizado de 0 a 1; seguranca decresce de LOW para CRITICAL).
Oportunidades sem notas nao sao ranqueadas ate o usuario informa-las.

## Tools E Simulacao

`kpi_tool`, `process_tool` e `data_tool` sao somente leitura; `automation_tool`
tem efeito externo. Todas rodam em modo **simulado** (`external_calls = 0`).
Execucao real exige tool MCP com identidade, permissao, chave de
idempotencia, registro de auditoria, plano de compensacao e autorizacao humana
conforme o risco.

## Como Usar

```powershell
python .\scripts\run_business_transformation.py --brief templates\business\transformation_brief.json
python .\scripts\run_business_transformation.py --brief meu_brief.json --output output\transformation_report.json
python .\scripts\run_business_transformation.py --cases evals\business_transformation_cases.jsonl
```

O relatorio traz status (`needs_user_decisions`, `awaiting_human_approval` ou
`completed_simulation`), decisoes pendentes, oportunidades ranqueadas com
risco e status de execucao, a saida de cada estagio e o log de auditoria
(estagio, agente, decisao).

O analisador de solucao reconhece pedidos de transformacao (processo,
retrabalho, tempo de ciclo, backoffice, KPIs...) e adiciona a
`business_transformation_fleet` as fleets recomendadas.

## Projetos Criados

Todos os universos (ML, IA, Chatbolt e Hibrido) recebem contrato, workflow,
perfis, prompt, motor, CLI, brief de exemplo, casos de avaliacao e o teste
`tests/test_business_transformation_contract.py`. Os projetos continuam sem
backend, frontend ou fabrica propria.

## Evolucao Para LangGraph E MCP

A maquina de estados tem contratos independentes de framework. Quando houver
necessidade de checkpoints distribuidos, retomada duravel ou ciclos complexos,
cada estagio pode virar um no LangGraph mantendo os mesmos handlers e regras.
Integracoes reais entram como tools MCP com os controles listados acima.

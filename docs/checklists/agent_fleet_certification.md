# Checklist de Certificacao de Agent Fleet

Aplicavel a qualquer fleet definida em `config/agent_fleets.json` antes de
promover sua certificacao (`draft` -> `validated` -> `certified`), conforme
`config/agent_trust_framework.json`.

## 1. Identity and Authentication

- [ ] Cada agente tem `id` estavel no catalogo (`agents/definitions/enterprise_agents.yaml`).
- [ ] Versao, owner e identidade de runtime declarados.
- [ ] Binding de identidade MCP definido quando o agente usa ferramentas MCP.

## 2. Authorization and Tool Permissions

- [ ] Ferramentas permitidas e negadas listadas por agente (menor privilegio).
- [ ] Acoes destrutivas exigem aprovacao humana.
- [ ] Roteamento de modelos governado (`config/cost_optimization_policy.json`).

## 3. Purpose and Policy

- [ ] Proposito de negocio e fronteiras de dominio da fleet declarados.
- [ ] Guardrails de politica e regras de tratamento de dados definidos.

## 4. Planning and Explainability

- [ ] Plano antes da acao com rationale registravel.
- [ ] Contrato de handoff entre agentes definido.
- [ ] Caminho de escalonamento de conflito para o lead agent.

## 5. Observability and Agent SRE

- [ ] Logs estruturados, metricas de latencia, tokens e custo ativos.
- [ ] Health da fleet observavel e auditoria de provedor de modelo ligada.
- [ ] Trace de memoria Ruflo disponivel.

## 6. Certification and Compliance

- [ ] Evals de agente e regressao de prompts executados.
- [ ] Revisao de permissoes de ferramentas e revisao de seguranca concluidas.
- [ ] Status de certificacao registrado na fleet.

## 7. Lifecycle Governance

- [ ] Versionamento, politica de deprecacao e plano de rollback definidos.
- [ ] Owner review e release gate aprovados.

## Gate final

- [ ] Nenhuma acao proibida da autonomy matrix habilitada.
- [ ] Ativacao de todos os 60 agentes exige justificativa e aprovacao humana.
- [ ] Metricas de sucesso da fleet declaradas e mensuraveis.

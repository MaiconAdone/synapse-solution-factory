# Runbook - Agent SRE

Operacao e resposta a incidentes do mesh de agentes do Synapse, cobrindo a
camada Observability and Agent SRE do trust framework
(`config/agent_trust_framework.json`).

## Sinais monitorados

- Custo e tokens por execucao (`artifacts/governance/swarm-executions.jsonl`).
- Latencia por agente e por fleet.
- Health das fleets (`config/agent_fleets.json`).
- Auditoria de provedor de modelo (local-first vs cloud).
- Trace de memoria Ruflo por execucao.
- Eventos de aprendizado (`memory/synapse_learning_memory.jsonl`).

## Diagnostico rapido

```powershell
pytest -q
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate_enterprise_stack.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose_project.ps1 -ProjectName nome_do_projeto
```

## Incidentes comuns

### Custo acima do orcamento

1. Verifique agentes ativos versus perfil (simple=1, standard=3, enterprise=8).
2. Aplique `config/cost_optimization_policy.json` e o CostAwareRouter.
3. Reduza contexto com `scripts/context_filter.py` antes de reenviar.

### Roteamento indevido para cloud

1. Confirme `SYNAPSE_ALLOW_CLOUD_DEFAULT=false` no `.mcp.json`.
2. Verifique `human_approved` nos logs da execucao governada.
3. Pedidos simples sobre o Synapse devem forcar Ollama local.

### Fleet degradada ou agente sem resposta

1. Identifique o lead agent da fleet e o ponto de falha no plano.
2. Escale para o `orchestration-manager` e reduza ao core minimo.
3. Registre a falha no improvement loop (`config/agent_improvement_loop.json`).

### Poluicao de memoria de aprendizado

1. Testes devem sobrescrever `learning_events_path` para caminho temporario.
2. Entradas com `model: test-model` em `memory/synapse_learning_memory.jsonl`
   indicam vazamento de teste; reverta e corrija o teste.

## Escalonamento

- Acoes destrutivas, segredos, deploy e mudanca de permissao: aprovacao humana.
- Conflito entre agentes: decisao final via modelo de maior capacidade
  somente com justificativa (padrao Anthropic do CLAUDE.md).
- Incidente de seguranca: acionar `security_fleet` e registrar no runbook.

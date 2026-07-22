# Agentic Mesh Governance

O SYNAPSE usa uma camada de agentic mesh para organizar agentes em fleets
governadas. A ideia e manter a capacidade de 60 agentes, mas operar com
identidade, permissoes, autonomia controlada, observabilidade e lifecycle.

## Contratos

- `config/agent_trust_framework.json`
- `config/agent_fleets.json`
- `config/cost_optimization_policy.json`
- `agents/definitions/enterprise_agents.yaml`

## Trust Layers

1. Identity and Authentication
2. Authorization and Tool Permissions
3. Purpose and Policy
4. Planning and Explainability
5. Observability and Agent SRE
6. Certification and Compliance
7. Lifecycle Governance

## Fleets

- `project_factory_fleet`: cria projetos ML, IA e Hibridos.
- `ml_fleet`: treino, avaliacao, tracking de experimentos, model card e drift.
- `rag_fleet`: RAG, chunking, retrieval, reranking, citacoes e fidelidade.
- `mcp_fleet`: MCP, tool calling, function schemas e permissoes.
- `security_fleet`: LGPD, threat modeling, policies e red team.
- `cost_optimization_fleet`: tokens, cache, latencia e agentes ativos.
- `business_transformation_fleet`: processo, valor, automacao, risco, adocao e
  impacto empresarial.

## Regras Corporativas

- Nenhuma fleet deve ativar 60 agentes por padrao.
- Ativacao total de 60 agentes exige justificativa explicita e aprovacao humana.
- Cada fleet deve declarar objetivo, lead agent, agentes participantes,
  especialistas e metricas de sucesso.
- Cada agent deve respeitar menor privilegio de ferramentas.
- Acoes destrutivas, alteracao de segredos, deploy em producao e mudanca de
  permissoes exigem aprovacao humana.
- Resultados de agents e fleets devem ser observaveis por custo, tokens,
  latencia, qualidade e status de validacao.

## Criacao de Projetos

Ao criar um projeto novo:

1. Classifique o universo: ML, IA ou ML + IA.
2. Selecione a fleet governada pelo cenario.
3. Aplique a politica de custo antes de acionar LLMs ou muitos agentes.
4. Gere especificacao funcional, arquitetura tecnica, fluxo de dados,
   criterios de aceite e estrategia de testes.
5. Gere docs corporativos no projeto:
   - `docs/specifications/agentic_mesh_governance.md`
   - `docs/checklists/agent_fleet_certification.md`
   - `docs/runbooks/agent_sre.md`
6. Rode validacao enterprise e diagnostico do projeto.

---
id: codex-data-treatment-dialog
owner: orchestration-manager
version: 0.1.0
agents: 15 core agents, specialist pool up to 60
workflow: new-ai-project
---

# Codex Data Treatment Dialog

Fonte metodologica obrigatoria: `prompts/master_data_treatment.md`.
Politica executavel: `config/data_treatment_policy.json`.

Quando o usuario pedir tratamento de dados pela caixa de dialogo do Codex,
use o fluxo abaixo:

1. Confirmar arquivo em `data/raw/` ou caminho informado pelo usuario.
2. Rodar `Enterprise: Validar stack` quando a validacao ainda nao foi feita.
3. Acionar Ruflo com os 15 core agents em paralelo e registrar especialistas sob demanda se necessario.
4. Executar `scripts/codex_data_treatment_dialog.ps1`.
5. Ler o relatorio em `output/data_treatment/`.
6. Explicar ao usuario:
   - problemas encontrados;
   - tratamentos aplicados;
   - justificativas estatisticas;
   - riscos remanescentes;
   - se a base pode seguir para ML, RAG ou agentes.

## Papel Dos Agentes

- `orchestration-manager`: consolida contexto, decisoes e resposta final.
- `product-strategy`: valida objetivo de negocio e criterio de aceite.
- `data-engineering`: valida schema, tipos, contratos, paths e linhagem.
- `data-science`: conduz diagnostico estatistico, ausentes, outliers e distribuicoes.
- `machine-learning`: avalia prontidao para treino, baseline e model card.
- `llm-engineering`: prepara resumo estruturado e prompts de proxima etapa.
- `rag-engineering`: avalia se a base alimenta busca, chunks ou conhecimento.
- `backend-engineering`: preserva contratos de entrada/saida.
- `frontend-engineering`: ignora UI web; foco e terminal VS Code.
- `integration-automation`: conecta Codex, Ruflo, scripts e tasks.
- `security-compliance`: revisa privacidade, PII e riscos de dados sensiveis.
- `observability-ops`: registra artefatos, custo, tempo e rastreabilidade.
- `devops`: garante execucao local e reproducivel.
- `testing-qa`: verifica saidas, relatorio e regressao.
- `documentation`: atualiza runbook/checklist quando necessario.

Nunca remova outliers automaticamente sem instrucao explicita. Por padrao,
crie flags e recomende revisao de dominio.

## Cobertura Do Prompt Mestre

O script `scripts/treat_dataset.py` executa automaticamente a camada
deterministica do prompt mestre: perfil basico, ausentes, duplicatas, colunas
constantes, estatisticas numericas, outliers IQR, categorias raras, dataset
tratado e relatorio.

Etapas avancadas como MICE, testes de normalidade, QQ-plot, correlacoes,
multicolinearidade, testes de hipotese, intervalos de confianca e bootstrap
devem ser tratadas como recomendacoes ou tarefas assistidas ate existirem
implementacoes deterministicas e testes automatizados.

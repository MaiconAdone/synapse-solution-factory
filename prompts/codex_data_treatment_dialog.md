---
id: codex-data-treatment-dialog
owner: orchestration-manager
version: 0.1.0
agents: economic subset (orchestration-manager, data-engineering, data-science, testing-qa); specialists on demand
workflow: new-ai-project
---

# Codex Data Treatment Dialog

Fonte metodologica obrigatoria: `prompts/master_data_treatment.md`.
Politica executavel: `config/data_treatment_policy.json`.

Quando o usuario pedir tratamento de dados pela caixa de dialogo do Codex,
use o fluxo abaixo:

1. Confirmar arquivo em `data/raw/` ou caminho informado pelo usuario.
2. Rodar `Enterprise: Validar stack` quando a validacao ainda nao foi feita.
3. Ativar o subconjunto economico (`orchestration-manager`, `data-engineering`,
   `data-science`, `testing-qa`); so escale para outros especialistas se a
   tarefa realmente exigir (ex.: `machine-learning` quando o proximo passo for
   treino), nunca os 60 por padrao.
4. Executar `scripts/codex_data_treatment_dialog.ps1`.
5. Ler o relatorio em `output/data_treatment/`.
6. Explicar ao usuario:
   - problemas encontrados;
   - tratamentos aplicados;
   - justificativas estatisticas;
   - riscos remanescentes;
   - se a base pode seguir para ML, RAG ou agentes.

## Papel Dos Agentes

Subconjunto economico requerido para esta tarefa (definido em
`scripts/codex_data_treatment_dialog.ps1`):

- `orchestration-manager`: consolida contexto, decisoes e resposta final.
- `data-engineering`: valida schema, tipos, contratos, paths e linhagem.
- `data-science`: conduz diagnostico estatistico, ausentes, outliers e distribuicoes.
- `testing-qa`: verifica saidas, relatorio e regressao.

Especialistas sob demanda, apenas quando o cenario realmente exigir (nao
ativar por padrao):

- `machine-learning`: quando o proximo passo for treino/baseline/model card.
- `security-compliance`: quando houver indicio de PII ou dado sensivel.
- `rag-engineering`/`llm-engineering`: quando a base alimentar busca/RAG.

Nunca remova outliers automaticamente sem instrucao explicita. Por padrao,
crie flags e recomende revisao de dominio.

## Cobertura Do Prompt Mestre

O script `scripts/treat_dataset.py` executa automaticamente a camada
deterministica do prompt mestre: perfil basico, ausentes, duplicatas, colunas
constantes, estatisticas numericas, outliers por IQR e por z-score, testes de
normalidade, correlacoes (Pearson/Spearman), associacao qui-quadrado,
intervalos de confianca, bootstrap da media, categorias raras, dataset
tratado e relatorio.

Etapas avancadas como MICE, QQ-plot, transformacoes Box-Cox/Yeo-Johnson,
diagnostico de multicolinearidade e selecao formal de teste
parametrico/nao-parametrico ainda nao tem implementacao deterministica; trate
como recomendacao ou tarefa assistida ate existir implementacao e teste
automatizado (ver `config/data_treatment_policy.json`).

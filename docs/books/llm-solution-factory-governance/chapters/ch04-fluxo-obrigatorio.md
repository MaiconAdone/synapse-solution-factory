# Capitulo 4 — Fluxo Obrigatorio

1. Entender se o pedido e criacao de projeto, implementacao em projeto
   existente, tratamento de dados, ML/DL/series temporais, RAG, Chatbolt,
   agente ou hibrido.
2. Coletar objetivo, problema de negocio, universo desejado, dados/fontes
   disponiveis, metrica de sucesso e risco. Se faltar qualquer item,
   perguntar ao usuario antes de implementar (ver [[ch02-protocolo-de-perguntas]]).
3. Consultar o analisador:

```powershell
python .\scripts\analyze_business_solution.py `
  --project-root caminho\do\projeto `
  --project-name nome_do_projeto `
  --universe ML `
  --project-goal "objetivo" `
  --business-problem "problema de negocio" `
  --solution-focus ml
```

4. Usar `config/business_solution_analysis.json` como decisao arquitetural.
5. Aplicar SDD: problema, arquitetura, dados, agentes/RAG, ferramentas,
   testes, evals, custos, governanca e plano.
6. Implementar somente o escopo que respeita a analise.
7. Atualizar testes/evals e validar (ver [[ch08-validacao]]).
8. Registrar riscos, proximas acoes e resultados.

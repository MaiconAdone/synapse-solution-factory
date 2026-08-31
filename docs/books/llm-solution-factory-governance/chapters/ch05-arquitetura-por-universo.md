# Capitulo 5 — Arquitetura Por Universo

## ML, DL, Redes Neurais e Series Temporais

Use MLOps: contrato de dados, baseline, features, treino e avaliacao,
registry local/artifacts, model card, monitoramento e drift, testes
deterministicos em `tests/`, evals em `evals/`.

## IA, RAG, MCP e Agentes

Use AI Engineering: RAG para conhecimento confiavel, MCP/tool calling para
ferramentas, agentes somente quando houver execucao de tarefas, guardrails,
memoria governada, custo por token, roteamento local-first, testes de
contrato, evals de prompts, RAG e workflows.

## Chatbolt

Use arquitetura conversacional: persona e prompt versionado, RAG quando
resposta exigir fonte confiavel, handoff humano, memoria de sessao,
seguranca e privacidade, evals de conversa, testes especificos de chatbot.

## Hibrido

Use hibrido quando o problema exigir previsao/classificacao e tambem
conhecimento ou execucao. O projeto deve compartilhar contrato de dados,
governanca, testes, evals, observabilidade e custo.

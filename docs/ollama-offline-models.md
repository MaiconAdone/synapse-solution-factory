# Modelos Ollama Offline

O SYNAPSE usa apenas dois modelos locais no Ollama. Os perfis continuam
existindo para compatibilidade de API e roteamento, mas resolvem somente para
`qwen2.5-coder:3b` ou `deepseek-coder-v2:lite`.

| Perfil | Modelo | Uso recomendado |
| --- | --- | --- |
| `fast` | `qwen2.5-coder:3b` | Triagem, resumo, classificacao e tarefas simples |
| `balanced` | `deepseek-coder-v2:lite` | Arquitetura, implementacao, agentes e tarefas locais mais pesadas |
| `code_review` | `deepseek-coder-v2:lite` | Revisao textual, debugging, reparo e analise de codigo |
| `large` | `deepseek-coder-v2:lite` | Alias de compatibilidade para o modelo local mais forte permitido |

## Politica

- O modo offline seleciona `fast`, `balanced` ou `code_review` automaticamente.
- O perfil `large` nunca e escolhido automaticamente; ele existe apenas para
  chamadas explicitas legadas.
- Solicitacoes JSON usam o perfil `balanced` quando o pedido tambem parece
  revisao de codigo, preservando uma rota local unica para saidas estruturadas.
- Em maquinas com 16 GB de RAM, use contexto de ate 4096 tokens nos modelos medios.
- Execute somente um modelo medio ou grande por vez.
- Revise a licenca do DeepSeek antes de distribuicao comercial.

## Variaveis

```env
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_BALANCED_MODEL=deepseek-coder-v2:lite
OLLAMA_CODE_REVIEW_MODEL=deepseek-coder-v2:lite
OLLAMA_LARGE_MODEL=deepseek-coder-v2:lite
OLLAMA_TIMEOUT_SECONDS=600
```

Todos os modelos funcionam sem internet depois que seus blobs e manifests estao
disponiveis no diretorio de modelos do Ollama.

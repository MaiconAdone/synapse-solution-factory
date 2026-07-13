# Contrato de Interfaces do SYNAPSE

O SYNAPSE oferece duas interfaces independentes sobre o mesmo nucleo:

- navegador: Next.js + FastAPI;
- VS Code: tasks, terminal, Codex, PowerShell e Ruflo CLI.

Nenhuma interface depende da outra para executar suas funcoes principais.

## Capacidades equivalentes

| Capacidade | Navegador | VS Code |
|---|---|---|
| Criar projetos ML, IA e hibridos | Dialogo em `/ops` | Task AI Factory |
| Ativar Ruflo com limite economico | API de projetos/workflows | Scripts Ruflo |
| Consultar agentes, memoria e swarm | Painel web | Manifestos e tasks |
| Tratar dados | `/ops` | Task de tratamento |
| Filtrar contexto | `/ops` | Task de filtro |
| Executar market radar | `/ops` | Task market radar |
| Rodar evals ML e IA | `/ops` | Tasks locais de eval |
| Anexar fotos, documentos e datasets | `/projects` | Task de anexo |
| Baixar projeto | `/projects` | Acesso direto ao diretorio |
| Treinar e promover modelos | `/ops` | API/scripts Python |

## Modos de armazenamento

- Local: projetos e anexos ficam no filesystem. Funciona sem Supabase.
- Gerenciado: projetos usam banco e Supabase Storage com isolamento por membro.

## Inicializacao

Navegador independente:

```text
Tasks: Run Task -> SYNAPSE: Iniciar modo navegador independente
```

VS Code sem navegador:

```text
Tasks: Run Task -> SYNAPSE: Preparar runtime VS Code sem navegador
```

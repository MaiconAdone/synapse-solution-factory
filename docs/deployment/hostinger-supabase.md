# Deploy SYNAPSE: Hostinger + Backend + Supabase

Este roteiro prepara o SYNAPSE para operar como plataforma web: o site fica na
Hostinger, o backend cria e registra projetos no servidor, e o Supabase guarda
login, permissoes, metadados e storage.

## Arquitetura

```txt
Hostinger Next.js
  -> Backend FastAPI publicado
  -> Supabase Auth + Postgres + Storage
  -> GitHub privado por projeto (recomendado)
```

O navegador nao cria arquivos no computador do visitante. Em producao, use
`PROJECT_CREATION_MODE=managed`; nesse modo o SYNAPSE registra os projetos no
banco e prepara o prefixo de storage. O modo `local` continua disponivel para
desenvolvimento no seu computador.

## Hostinger

Configure o deploy do app Node.js/Next.js com:

```txt
Root directory: frontend
Install command: npm ci
Build command: npm run build
Start command: npm run start
Node version: 20.x
```

Variaveis do site:

```txt
API_BASE_URL=https://api.seu-dominio.com
NEXT_PUBLIC_API_BASE_URL=https://api.seu-dominio.com
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=chave_anon_publica
```

Nao configure `APP_API_KEY` na Hostinger quando o login via Supabase estiver
ativo. O frontend deve enviar o JWT do usuario; a chave administrativa fica
somente no backend.

Quando alterar variaveis na Hostinger, faca novo deploy.

## Backend

Publique o backend FastAPI em um runtime Python/Docker com acesso externo, como
Hostinger VPS, Railway, Render, Fly.io ou um servidor Docker proprio.

Variaveis do backend:

```txt
ENVIRONMENT=production
APP_API_KEY=gere-um-segredo-forte
CORS_ORIGINS=https://seu-dominio.com
DATABASE_URL=postgresql+psycopg://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=chave_anon_publica
SUPABASE_SERVICE_ROLE_KEY=chave_service_role_somente_no_backend
SUPABASE_JWT_SECRET=jwt_secret_do_supabase
PROJECT_CREATION_MODE=managed
PROJECT_STORAGE_BACKEND=supabase
PROJECT_STORAGE_BUCKET=SYNAPSE-projects
GITHUB_PROJECTS_OWNER=seu-usuario-ou-org
GITHUB_PROJECTS_VISIBILITY=private
```

Use a string do pooler do Supabase para ambientes publicados. A chave
`SUPABASE_SERVICE_ROLE_KEY` nunca deve ir para o frontend.

## Supabase

1. Crie um projeto no Supabase.
2. Rode `supabase/migrations/001_SYNAPSE_platform.sql` no SQL Editor.
3. Crie um bucket privado chamado `SYNAPSE-projects`.
4. Rode tambem `supabase/migrations/002_project_data_prefix.sql` se a primeira
migration ja havia sido aplicada antes desta versao.
5. Crie seu usuario no Supabase Auth.
6. Promova seu usuario a admin:

```sql
update public.profiles
set role = 'admin', approved = true
where email = 'seu-email@dominio.com';
```

7. Para liberar outra pessoa, altere `approved=true`. Somente admins devem fazer
isso.

## Modelo de Login Fechado

O schema cria `profiles.role` e `profiles.approved`. A regra operacional e:

- `admin`: gerencia contas, projetos e membros.
- `operator`: pode operar projetos liberados.
- `viewer`: somente leitura quando aprovado.
- `approved=false`: nao deve acessar o painel.

O frontend ja esta preparado para usar Supabase Auth e enviar o JWT para o
backend em chamadas protegidas:
`/login` autentica com Supabase, o painel exige sessao quando as variaveis
`NEXT_PUBLIC_SUPABASE_*` existem, e o proxy `/api/synapse/*` encaminha o bearer
token para o backend.

## Projetos

No modo `managed`, `POST /projects/create` nao grava em
`C:\Users\...\Documents\Projetos`. Ele registra o projeto em `public.projects`
e retorna um destino como:

```txt
supabase://SYNAPSE-projects/projects/nome_do_projeto
```

Cada projeto tambem recebe uma pasta de dados:

```txt
projects/nome_do_projeto/data/
```

O painel `/projects` carrega projetos ja criados e permite subir arquivos de
dados como CSV, TSV, Excel, JSON, JSONL e Parquet diretamente para essa pasta no
Supabase Storage. As policies de storage permitem upload somente para caminhos
`projects/%/data/%` e somente para usuarios aprovados.

Depois disso, a camada de geracao de artefatos pode salvar arquivos no Supabase
Storage e criar um repositorio privado no GitHub para versionamento.

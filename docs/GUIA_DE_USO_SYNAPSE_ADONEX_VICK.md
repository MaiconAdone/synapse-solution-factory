# Instalação do Synapse do zero no Windows com VS Code

Este é o guia oficial para preparar uma máquina nova e executar o Synapse pelo
VS Code. A Vick pertence exclusivamente ao Synapse e é usada apenas na
interface web da plataforma. Projetos criados pela Solution Factory não herdam
a Vick.

## 1. Requisitos

Instale:

- Windows 10 ou 11 de 64 bits;
- Git;
- Visual Studio Code 1.96 ou superior;
- PowerShell 7 ou superior;
- Python 3.12 de 64 bits;
- Node.js 22 LTS e npm;
- Ollama;
- Docker Desktop apenas se algum fluxo específico exigir contêineres.

Durante as instalações, permita que Git, Python, Node.js, PowerShell e Ollama
sejam adicionados ao `PATH`.

Feche e abra novamente o terminal após instalar os programas. Confirme:

```powershell
git --version
code --version
pwsh --version
python --version
node --version
npm --version
ollama --version
```

O Python deve ser 3.12 e o Node.js deve ser 22.x.

## 2. Obter o repositório

O repositório oficial é privado. A conta usada no Git deve ter acesso.

Pelo GitHub:

```powershell
Set-Location $HOME\Documents
New-Item -ItemType Directory -Force Projetos | Out-Null
Set-Location Projetos
git clone https://github.com/MaiconAdone/synapse.git
Set-Location synapse
```

Se a empresa usar o GitLab interno:

```powershell
git clone https://glp.netmoderna.com.br/projetos-bi/machine-learning/synapse.git
Set-Location synapse
```

Quando solicitado, autentique pelo navegador ou pelo Git Credential Manager.
Não coloque tokens diretamente no comando ou em arquivos versionados.

## 3. Abrir o workspace correto

Ainda no diretório `synapse`:

```powershell
code .
```

No VS Code, confirme que a pasta raiz aberta contém `README.md`, `backend`,
`frontend`, `adonex`, `scripts` e `.vscode`.

Se o VS Code perguntar se você confia nos autores do workspace, confirme
somente depois de verificar que o repositório clonado é o oficial.

## 4. Criar o ambiente local

Abra um terminal PowerShell no VS Code:

```text
Terminal → New Terminal
```

Execute:

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm ci
npm --prefix frontend ci
npm --prefix adonex ci
```

Selecione o interpretador Python do workspace:

```text
Ctrl+Shift+P → Python: Select Interpreter
```

Escolha:

```text
.\.venv\Scripts\python.exe
```

O arquivo `.env` é local e não deve ser enviado ao Git. Credenciais também
devem ficar apenas em mecanismos locais seguros, nunca em código-fonte.

## 5. Preparar o Ollama

Abra o Ollama e instale o modelo local mínimo:

```powershell
ollama pull qwen2.5-coder:3b
ollama list
```

Teste o serviço:

```powershell
ollama run qwen2.5-coder:3b "Responda apenas: Ollama funcionando"
```

Os modelos maiores são opcionais e devem ser instalados somente quando a
máquina tiver memória suficiente.

## 6. Instalar o AdoneX no VS Code

Compile, teste e gere o pacote da extensão:

```powershell
npm --prefix adonex run package
```

Instale o VSIX gerado:

```powershell
$vsix = Get-ChildItem .\adonex\*.vsix |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
code --install-extension $vsix.FullName --force
```

Recarregue o VS Code:

```text
Ctrl+Shift+P → Developer: Reload Window
```

O AdoneX usa Ollama local. Codex usa o provedor OpenAI configurado na extensão
do Codex, e Claude Code usa Anthropic diretamente. Um assistente não deve
redirecionar geração para o provedor do outro.

## 7. Validar a instalação

Execute a verificação completa:

```powershell
npm run check
```

Ela valida a stack corporativa, os contratos do backend e o frontend.

Para uma verificação mais rápida do ambiente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap_enterprise_stack.ps1 `
  -SkipRuflo

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\validate_enterprise_stack.ps1
```

A instalação só deve ser considerada concluída quando os comandos terminarem
sem falhas.

## 8. Executar somente no VS Code

Abra a paleta:

```text
Ctrl+Shift+P → Tasks: Run Task
```

Execute:

```text
Synapse: Preparar runtime VS Code sem navegador
```

Depois use um dos canais oficiais:

- Codex;
- Claude Code;
- VS Code Chat;
- `@adonex` no Chat do VS Code.

Todos compartilham a Solution Factory, a governança e a memória local do
workspace.

## 9. Executar a interface web do Synapse

No VS Code:

```text
Ctrl+Shift+P → Tasks: Run Task
```

Execute:

```text
Synapse: Iniciar modo navegador independente
```

Endereços locais:

- interface web e Vick: `http://127.0.0.1:3000`;
- backend FastAPI: `http://127.0.0.1:8000`.

A Vick é parte da interface do Synapse. Ela não é copiada para os projetos
criados.

## 10. Criar um projeto

O caminho principal é conversar com Codex, Claude Code, VS Code Chat ou AdoneX:

```text
Crie um projeto de IA para gerar relatórios a partir de um SQL Server.
```

Antes da criação, informe:

1. objetivo;
2. problema de negócio;
3. universo: ML, IA, Chatbolt ou híbrido;
4. métrica ou critério de aceite;
5. dados e fontes disponíveis;
6. risco: baixo, médio, alto ou crítico.

Por padrão, os projetos são criados na pasta irmã do Synapse. Para escolher
outra pasta, configure `PROJECT_FACTORY_BASE_PATH` no `.env` ou use
`-DestinoBase` no script da fábrica.

## 11. Atualizar uma instalação existente

Preserve alterações locais antes de atualizar:

```powershell
git status
git pull --ff-only
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm ci
npm --prefix frontend ci
npm --prefix adonex ci
npm run check
```

Nunca substitua `.env` durante uma atualização.

## 12. Solução de problemas

### `python` não é reconhecido

Reinstale o Python 3.12 marcando a opção para adicioná-lo ao `PATH`, ou use o
Python Launcher:

```powershell
py -3.12 -m venv .venv
```

### PowerShell bloqueia scripts

Use o processo atual, sem alterar a política global:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

### Ollama não responde

Abra o aplicativo Ollama e verifique:

```powershell
ollama list
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

### Porta 3000 ou 8000 ocupada

Identifique o processo:

```powershell
Get-NetTCPConnection -LocalPort 3000,8000 -ErrorAction SilentlyContinue
```

Encerre somente o processo conhecido que estiver usando a porta ou ajuste a
configuração local.

### Dependências inconsistentes

Restaure usando os arquivos de lock:

```powershell
npm ci
npm --prefix frontend ci
npm --prefix adonex ci
```

## Checklist final

- Repositório oficial aberto no VS Code.
- `.venv` criado com Python 3.12.
- Dependências Python e Node instaladas.
- Ollama ativo com `qwen2.5-coder:3b`.
- AdoneX instalado no VS Code.
- `npm run check` concluído sem falhas.
- Runtime do VS Code ou interface web iniciando corretamente.
- Segredos mantidos fora do Git.

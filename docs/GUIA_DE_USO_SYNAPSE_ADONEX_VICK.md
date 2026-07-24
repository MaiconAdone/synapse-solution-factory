# Guia de Uso: Synapse, AdoneX e Vick

Este guia explica como iniciar e usar os três componentes:

- **Synapse:** plataforma central e fábrica de soluções de IA e ML.
- **AdoneX:** agente local de programação integrado ao VS Code.
- **Vick:** interface web de voz e texto do Synapse.

## 1. Pré-requisitos

Antes de começar, instale:

- Git;
- Visual Studio Code;
- PowerShell 7 ou superior;
- Python 3.12;
- Node.js 22 e npm;
- Ollama;
- modelos locais usados pelo AdoneX.

O modelo local padrão é:

```powershell
ollama pull qwen2.5-coder:3b
```

Mantenha o Ollama aberto durante o uso do AdoneX e das funções locais da Vick.

## 2. Abrir o projeto

Clone e prepare o projeto:

```powershell
git clone https://glp.netmoderna.com.br/projetos-bi/machine-learning/synapse.git
Set-Location synapse
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm ci
npm --prefix frontend ci
npm --prefix adonex ci
ollama pull qwen2.5-coder:3b
npm run check
```

Abra no VS Code a pasta clonada, sem depender de um caminho absoluto.

As tarefas descritas neste guia ficam disponíveis em:

```text
Terminal → Run Task
```

Também é possível abrir a paleta de comandos com `Ctrl+Shift+P` e procurar por:

```text
Tasks: Run Task
```

## 3. Como usar o Synapse

O Synapse é o núcleo da plataforma. Ele administra projetos, agentes, memória,
dados, testes, avaliações e governança.

### Usar com navegador

No VS Code:

1. Abra `Tasks: Run Task`.
2. Execute `Synapse: Iniciar modo navegador independente`.
3. Aguarde o backend e o frontend iniciarem.
4. Acesse `http://127.0.0.1:3000`.

O backend do Synapse fica disponível em:

```text
http://127.0.0.1:8000
```

### Usar somente no VS Code

Para trabalhar sem abrir o navegador:

1. Abra `Tasks: Run Task`.
2. Execute `Synapse: Preparar runtime VS Code sem navegador`.
3. Use o Codex, Claude Code, VS Code Chat ou AdoneX para conversar com o projeto.

Exemplos de pedidos:

```text
Analise a arquitetura do Synapse.
```

```text
Verifique os testes e a documentação deste projeto.
```

```text
Trate o arquivo data/raw/clientes.csv.
```

### Criar uma solução pelo diálogo

O caminho recomendado é pedir a criação pelo chat:

```text
Crie um projeto de ML para prever cancelamento de clientes.
```

Ou pelo AdoneX:

```text
@adonex /projeto crie uma solução de IA/RAG para atendimento ao cliente
```

Antes de criar o projeto, o Synapse solicitará:

- objetivo;
- problema de negócio;
- universo: ML, IA ou híbrido;
- métrica ou critério de sucesso;
- dados e fontes disponíveis;
- nível de risco.

Os projetos são criados, por padrão, ao lado da pasta clonada do Synapse.
Defina `SYNAPSE_PROJECTS_DIR` ou use `-DestinoBase` para escolher outro local.

### Validar o Synapse

No terminal integrado:

```powershell
npm run check:enterprise
```

Para executar a validação completa:

```powershell
npm run check
```

## 4. Como usar o AdoneX

O AdoneX é o agente local de programação do Synapse. Ele utiliza exclusivamente
modelos instalados no Ollama.

### Verificar o Ollama

Confirme que o serviço está funcionando:

```powershell
ollama list
```

Na paleta de comandos do VS Code, execute:

```text
AdoneX: Test Ollama Connection
```

### Abrir o AdoneX

Há três formas principais:

1. Abra o Chat do VS Code e digite `@adonex`.
2. Execute `AdoneX: Open Chat` na paleta de comandos.
3. Abra o ícone do AdoneX na barra lateral.

### Comandos de chat

Planejar uma alteração:

```text
@adonex /plan planeje a criação de observabilidade para o backend
```

Implementar:

```text
@adonex /implement adicione um health check ao backend
```

Revisar código:

```text
@adonex /review revise o pipeline RAG
```

Pesquisar no projeto:

```text
@adonex /search localize onde a autenticação é validada
```

Melhorar uma implementação:

```text
@adonex /improve melhore o tratamento de erros desta função
```

Criar um agente:

```text
@adonex /agent crie um agente para avaliar respostas
```

Criar uma ferramenta MCP:

```text
@adonex /mcp crie uma ferramenta MCP somente leitura
```

### Editar código

Para editar uma seleção:

1. Selecione o código no editor.
2. Pressione `Ctrl+Alt+K`.
3. Descreva a alteração.
4. Revise a proposta.
5. Confirme a aplicação.

Para editar vários arquivos:

1. Execute `AdoneX: Open Composer`.
2. Descreva a tarefa.
3. Revise o plano e os arquivos selecionados.
4. Confira o diff.
5. Aprove as alterações desejadas.

Por padrão, o AdoneX prepara as mudanças e solicita aprovação antes de escrever
arquivos ou executar comandos.

### Testar o AdoneX

No terminal:

```powershell
cd adonex
npm install
npm test
```

Para gerar o pacote da extensão:

```powershell
npm run package
```

## 5. Como usar a Vick

A Vick é a interface do Synapse no navegador. Ela aceita texto e voz.

### Iniciar a Vick

No VS Code:

1. Abra `Tasks: Run Task`.
2. Execute `Vick: Abrir assistente web automaticamente`.
3. Aguarde a inicialização.
4. Acesse `http://127.0.0.1:3000`.

Essa tarefa também inicia o backend e o frontend necessários.

### Ativar o serviço de voz

No VS Code:

1. Abra `Tasks: Run Task`.
2. Execute `Vick: Serviço local de voz`.
3. Permita o acesso ao microfone quando solicitado.

O serviço local de voz usa:

```text
http://127.0.0.1:8765
```

### Conversar com a Vick

Você pode digitar na caixa de diálogo ou falar a palavra de ativação:

```text
Vick
```

Depois, diga o comando. Exemplos:

```text
Vick, quais projetos existem?
```

```text
Vick, abra o projeto chamado replicar.
```

```text
Vick, analise o projeto chamado replicar.
```

```text
Vick, crie um projeto de machine learning para detectar fraude.
```

Ao criar um projeto, responda às perguntas de briefing feitas pela Vick.

### Editar projetos pela Vick

A Vick pode preparar alterações por meio da ponte local do AdoneX. Para isso:

- o VS Code deve estar aberto;
- o AdoneX deve estar ativo;
- a ponte HTTP local deve estar habilitada;
- o mesmo token deve estar configurado no AdoneX e no frontend;
- alterações devem ser revisadas e confirmadas.

Configurações relacionadas:

```text
adonex.bridge.enabled
adonex.bridge.port
adonex.bridge.token
adonex.voice.requireConfirmationForPatch
adonex.patch.applyMode
```

A ponte deve escutar somente em `127.0.0.1`. Não exponha essa porta na rede.

### Abertura automática

Para abrir a Vick sempre que o projeto for iniciado:

```text
Tasks: Run Task → Vick: Ativar abertura automática
```

Para desativar:

```text
Tasks: Run Task → Vick: Desativar abertura automática
```

## 6. Fluxo recomendado

Para uso diário:

1. Abra o projeto Synapse no VS Code.
2. Confirme que o Ollama está em execução.
3. Inicie `Synapse: Iniciar modo navegador independente`.
4. Inicie `Vick: Serviço local de voz` se quiser usar o microfone.
5. Use a Vick para interação por voz ou texto.
6. Use o AdoneX para programação local e alterações governadas.
7. Use o Synapse para criar e administrar soluções de IA e ML.

## 7. Solução de problemas

### A Vick não abre

- Confirme se a porta `3000` está livre.
- Verifique os terminais do backend e frontend no VS Code.
- Tente abrir manualmente `http://127.0.0.1:3000`.

### A Vick não escuta

- Execute `Vick: Serviço local de voz`.
- Verifique a permissão do microfone.
- Confirme se o serviço está usando a porta `8765`.
- Verifique se `adonex.voice.engine` está definido como `local_service`.

### O AdoneX não responde

- Confirme que o Ollama está aberto.
- Execute `ollama list`.
- Confirme que `qwen2.5-coder:3b` está instalado.
- Execute `AdoneX: Test Ollama Connection`.

### O AdoneX não altera arquivos

Isso pode ser o comportamento esperado. O projeto exige aprovação antes da
escrita. Abra o painel do AdoneX, revise o diff e confirme a aplicação.

### O backend não inicia

- Verifique as dependências de `backend/requirements.txt`.
- Confira as configurações locais baseadas em `.env.example`.
- Execute `npm run check:enterprise` para localizar inconsistências.

## 8. Documentação complementar

- `README.md`: visão geral do Synapse.
- `adonex/README.md`: recursos detalhados do AdoneX.
- `docs/vscode-workflow.md`: fluxo de trabalho pelo VS Code.
- `docs/dual-interface-contract.md`: diferenças entre navegador e VS Code.
- `adonex/docs/CHAT_INTEGRATION.md`: integração com o Chat do VS Code.
- `adonex/docs/SYNAPSE_INTEGRATION.md`: integração entre AdoneX e Synapse.

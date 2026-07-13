import assert from "node:assert/strict";
import test from "node:test";
import {
  checkSolutionFactoryDialog,
  parseChatInput,
  renderSolutionFactoryMissingInfo,
  resolveChatPrompt,
  routeChatCommand
} from "../src/chat/chatRouting";

test("chat routing keeps side effects behind the governed panel", () => {
  assert.equal(routeChatCommand("implement").governed, true);
  assert.equal(routeChatCommand("test").governed, true);
  assert.equal(routeChatCommand("agent").governed, true);
  assert.equal(routeChatCommand("mcp").governed, true);
});

test("chat parser tolerates duplicated participant mentions", () => {
  assert.deepEqual(parseChatInput(undefined, "@adonex /status"), {
    command: "status",
    prompt: ""
  });
  assert.deepEqual(parseChatInput(undefined, "@adonex @adonex /memoria"), {
    command: "memoria",
    prompt: ""
  });
});

test("chat parser preserves prompt text after an inline command", () => {
  assert.deepEqual(
    parseChatInput(undefined, "@adonex /handoff-codex criar MCP seguro"),
    {
      command: "handoff-codex",
      prompt: "criar MCP seguro"
    }
  );
});

test("chat routing uses Ollama-compatible local modes", () => {
  assert.equal(routeChatCommand("review").mode, "local");
  assert.equal(routeChatCommand("agent").mode, "synapse");
  assert.equal(routeChatCommand("roadmap").mode, "synapse");
});

test("unknown commands degrade to repository-aware chat", () => {
  const route = routeChatCommand("unknown");
  assert.equal(route.action, "chat");
  assert.equal(route.governed, false);
});

test("natural language Synapse explanation uses local analytical route", () => {
  const route = routeChatCommand(undefined, "explique o projeto Synapse");
  assert.equal(route.action, "synapse_explain");
  assert.equal(route.governed, false);
});

test("executive Synapse explanation uses local analytical route", () => {
  const route = routeChatCommand(
    undefined,
    "agora quero uma explicacao completa e executiva do Synapse"
  );
  assert.equal(route.action, "synapse_explain");
  assert.equal(route.title, "Explicacao Executiva do Projeto Synapse");
  assert.equal(route.governed, false);
});

test("Synapse model questions use the model inventory route", () => {
  const route = routeChatCommand(undefined, "quais modelos estamos usando na Synapse?");
  assert.equal(route.action, "synapse_explain");
  assert.equal(route.title, "Inventario de Modelos Synapse");
  assert.equal(route.governed, false);
});

test("natural language correction requests open a governed implementation", () => {
  const route = routeChatCommand(
    undefined,
    "verifique se existem erros no projeto local Synapse e corrija"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.governed, true);
});

test("correction requests mentioning Ollama still edit instead of explaining models", () => {
  const route = routeChatCommand(
    undefined,
    "corrija o nome para Synapse na resposta deterministica e corrija porque o modelo ollama nao fez essa correcao"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.title, "Governed correction");
  assert.equal(route.governed, true);
});

test("natural language coding requests open governed AdoneX implementation", () => {
  const route = routeChatCommand(
    undefined,
    "quero o adonex como agente de codificacao para editar e programar alteracoes no synapse"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.mode, "local");
  assert.equal(route.governed, true);
});

test("natural language external LLM coding requests use governed strong mode", () => {
  const route = routeChatCommand(
    undefined,
    "usando modelo externo LLM quero evoluir o adonex como ferramenta de agentic coding, ajuste"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.mode, "strong");
  assert.equal(route.governed, true);
});

test("natural language project verification requests use governed tests", () => {
  const route = routeChatCommand(
    undefined,
    "verifique se existem erros no projeto local Synapse"
  );
  assert.equal(route.action, "test");
  assert.equal(route.governed, true);
});

test("natural language test execution requests use the governed runner", () => {
  const route = routeChatCommand(
    undefined,
    "rode os testes e execute npm test"
  );
  assert.equal(route.action, "test");
  assert.equal(route.governed, true);
});

test("roadmap supports an empty prompt while creation commands do not", () => {
  assert.match(resolveChatPrompt("", routeChatCommand("roadmap")) ?? "", /roadmap/i);
  assert.equal(resolveChatPrompt("", routeChatCommand("agent")), undefined);
});

test("solution factory chat asks for missing briefing before implementation", () => {
  const route = routeChatCommand(
    undefined,
    "crie um projeto Synapse de IA para atendimento"
  );
  const check = checkSolutionFactoryDialog(
    "crie um projeto Synapse de IA para atendimento",
    route
  );
  assert.equal(check.applies, true);
  assert.ok(check.missingFields.includes("success_metric_or_acceptance_criteria"));
  assert.ok(check.missingFields.includes("available_data_or_knowledge_sources"));
  assert.ok(check.missingFields.includes("risk_level"));
  assert.match(renderSolutionFactoryMissingInfo(check), /BusinessSolutionAnalyzer/);
});

test("solution factory chat proceeds when briefing is complete", () => {
  const prompt = [
    "crie um projeto Synapse de IA/RAG para resolver o problema de atendimento lento ao cliente",
    "objetivo: responder duvidas de contrato",
    "metrica de sucesso: reduzir tempo de resposta em 40% e manter precisao acima de 90%",
    "dados disponiveis: PDFs de contratos, base FAQ e logs do suporte",
    "risco medio por conter dados sensiveis"
  ].join(". ");
  const route = routeChatCommand(undefined, prompt);
  const check = checkSolutionFactoryDialog(prompt, route);
  assert.equal(check.applies, true);
  assert.deepEqual(check.missingFields, []);
});

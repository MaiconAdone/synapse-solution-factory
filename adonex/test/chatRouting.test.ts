import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSolutionFactoryBriefing,
  checkSolutionFactoryDialog,
  parseChatInput,
  renderSolutionFactoryMissingInfo,
  resolveChatPrompt,
  routeChatCommand,
  shouldUseComposer
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

test("external LLM wording cannot move AdoneX away from local execution", () => {
  const route = routeChatCommand(
    undefined,
    "usando modelo externo LLM quero evoluir o adonex como ferramenta de agentic coding, ajuste"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.mode, "local");
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

test("a lone briefing answer does not look like project creation on its own", () => {
  // Regression guard: this is exactly why advanceSolutionFactoryBriefing needs
  // an explicit "dialog is active" state instead of re-classifying each
  // message in isolation.
  const answerOnly =
    "Qual o nivel de risco esperado: alto";
  const route = routeChatCommand(undefined, answerOnly);
  assert.equal(route.action, "chat");
  const check = checkSolutionFactoryDialog(answerOnly, route);
  assert.equal(check.applies, false);
});

test("advanceSolutionFactoryBriefing keeps the dialog alive across turns that don't repeat creation keywords", () => {
  const turn1 = 'vamos criar um novo projeto "Churn_2027"';
  const route1 = routeChatCommand(undefined, turn1);
  const step1 = advanceSolutionFactoryBriefing(undefined, turn1, route1);
  assert.equal(step1.check.applies, true);
  assert.ok(step1.check.missingFields.length > 0);
  assert.ok(step1.nextPendingBriefing);

  // Turn 2 answers the questions but, read alone, has no creation keywords
  // ("criar"/"novo projeto") and would default to the plain chat route.
  const turn2 = [
    "Qual problema de negocio essa solucao precisa resolver? Classificacao",
    "Qual universo devemos usar: ML/DL/series temporais",
    "Qual metrica de sucesso, KPI ou criterio de aceite define que funcionou? precision, recall, f1-score e AUC",
    "Quais dados, documentos, bases ou fontes de conhecimento estao disponiveis? os dados vou inserir depois que o projeto for criado",
    "Qual o nivel de risco esperado: alto, critico"
  ].join("\n");
  const route2 = routeChatCommand(undefined, turn2);
  assert.equal(route2.action, "chat", "turn 2 alone must not look like a creation request");

  const step2 = advanceSolutionFactoryBriefing(step1.nextPendingBriefing, turn2, route2);
  assert.equal(step2.route.action, "synapse_agent", "dialog must force the creation route while active");
  assert.equal(step2.check.applies, true);
  assert.deepEqual(step2.check.missingFields, []);
  assert.equal(step2.nextPendingBriefing, undefined);
  assert.match(step2.briefingSource, /Churn_2027/);
});

test("advanceSolutionFactoryBriefing without prior state re-evaluates the message on its own", () => {
  const answerOnly = "Qual o nivel de risco esperado: alto";
  const step = advanceSolutionFactoryBriefing(undefined, answerOnly, routeChatCommand(undefined, answerOnly));
  assert.equal(step.check.applies, false);
  assert.equal(step.nextPendingBriefing, undefined);
});

test("natural language ML project creation follows the Vick solution factory flow", () => {
  const prompt = "crie um projeto ML modelo para previsao de compradores";
  const route = routeChatCommand(undefined, prompt);
  assert.equal(route.action, "synapse_agent");
  assert.equal(route.mode, "synapse");
  assert.equal(route.governed, true);
  const check = checkSolutionFactoryDialog(prompt, route);
  assert.equal(check.applies, true);
  assert.ok(!check.missingFields.includes("requested_universe"));
  assert.ok(!check.missingFields.includes("business_problem"));
  assert.ok(check.missingFields.includes("success_metric_or_acceptance_criteria"));
  assert.ok(check.missingFields.includes("risk_level"));
});

test("natural language IA and hybrid creations also route to the factory", () => {
  assert.equal(
    routeChatCommand(undefined, "crie uma solucao de IA com RAG para contratos").action,
    "synapse_agent"
  );
  assert.equal(
    routeChatCommand(undefined, "monte um novo projeto hibrido de churn").action,
    "synapse_agent"
  );
});

test("edit requests mentioning a project stay on governed implementation", () => {
  const route = routeChatCommand(
    undefined,
    "adicione um endpoint novo no projeto"
  );
  assert.equal(route.action, "implement");
  assert.equal(route.governed, true);
});

test("advanced slash commands preserve governance boundaries", () => {
  assert.equal(routeChatCommand("search").action, "review");
  assert.equal(routeChatCommand("search").governed, false);
  assert.equal(routeChatCommand("improve").action, "implement");
  assert.equal(routeChatCommand("improve").governed, true);
});
test("unified chat sends implementation requests to the internal Composer", () => {
  assert.equal(shouldUseComposer(routeChatCommand(undefined, "adicione um endpoint com testes")), true);
  assert.equal(shouldUseComposer(routeChatCommand(undefined, "explique a arquitetura")), false);
  assert.equal(shouldUseComposer(routeChatCommand(undefined, "execute os testes")), false);
});

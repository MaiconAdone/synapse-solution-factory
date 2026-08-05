import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolutionBriefing,
  detectUniverse,
  isBriefingCancellation,
  renderProjectCreated,
  slugifyProjectName,
  universeToTipoProjeto
} from "../src/chat/solutionFactory";

test("universe detection binds explicit user declarations like Vick", () => {
  assert.equal(detectUniverse("crie um projeto ML para previsao de compradores"), "ml");
  assert.equal(detectUniverse("quero uma solucao de IA com RAG para contratos"), "ia");
  assert.equal(detectUniverse("um chatbot de atendimento ao cliente"), "chatbolt");
  assert.equal(detectUniverse("projeto hibrido de churn"), "hybrid");
  assert.equal(detectUniverse("machine learning com agentes e MCP"), "hybrid");
  assert.equal(detectUniverse("previsao de vendas para a loja"), null);
});

test("universe maps to the same TipoProjeto used by the Vick factory", () => {
  assert.equal(universeToTipoProjeto("ml"), "ML");
  assert.equal(universeToTipoProjeto("ia"), "IA");
  assert.equal(universeToTipoProjeto("chatbolt"), "Chatbolt");
  assert.equal(universeToTipoProjeto("hybrid"), "ML + IA (Hibrido)");
  assert.equal(universeToTipoProjeto(null), "ML + IA (Hibrido)");
});

test("briefing extraction fills the factory fields from the chat dialog", () => {
  const dialog = [
    "crie um projeto ML modelo para previsao de compradores",
    "metrica de sucesso: acuracia acima de 85%",
    "dados disponiveis: historico de compras em csv no CRM",
    "risco baixo, sem dados sensiveis"
  ].join("\n");
  const briefing = buildSolutionBriefing(dialog);
  assert.equal(briefing.universe, "ml");
  assert.match(briefing.projectGoal, /previsao de compradores/);
  assert.match(briefing.successMetric, /acuracia/);
  assert.match(briefing.availableSources, /csv/);
  assert.match(briefing.riskLevel, /risco baixo/);
});

test("project slug drops filler words and never returns empty", () => {
  assert.equal(
    slugifyProjectName("crie um projeto de previsao de compradores"),
    "previsao-compradores"
  );
  assert.equal(slugifyProjectName("criar projeto"), "projeto-adonex");
});

test("briefing cancellation matches Vick's cancel intents", () => {
  assert.equal(isBriefingCancellation("pode cancelar o briefing"), true);
  assert.equal(isBriefingCancellation("quero desistir"), true);
  assert.equal(isBriefingCancellation("risco baixo"), false);
});

test("creation summary states universe provenance", () => {
  const summary = renderProjectCreated({
    projectName: "previsao-compradores",
    destination: "C:/Projetos/previsao-compradores",
    selectedUniverse: "ml",
    universeSource: "user",
    tipoProjeto: "ML",
    gate: null,
    diagnostics: null
  });
  assert.match(summary, /Projeto criado com sucesso: previsao-compradores/);
  assert.match(summary, /Universo informado no briefing mantido/);
  assert.match(summary, /business_solution_analysis/);
  assert.match(summary, /Nao foi possivel rodar a analise independente/);
});

test("creation summary surfaces the independent per-project diagnostics", () => {
  const summary = renderProjectCreated({
    projectName: "previsao-compradores",
    destination: "C:/Projetos/previsao-compradores",
    selectedUniverse: "ml",
    universeSource: "analyzer",
    tipoProjeto: "ML",
    gate: null,
    diagnostics: {
      status: "failed",
      checksTotal: 40,
      checksPassed: 38,
      checksFailed: 2,
      failedChecks: [
        { id: "runtime_manifest", description: "Runtime manifest existe", detail: "config/runtime_manifest.json" },
        { id: "agents_total", description: "Projeto contem 60 agentes", detail: "agents=58" }
      ]
    }
  });
  assert.match(summary, /Analise independente do projeto/);
  assert.match(summary, /ha pendencias \(38\/40 checks\)/);
  assert.match(summary, /Runtime manifest existe \(config\/runtime_manifest\.json\)/);
  assert.match(summary, /project_diagnostics\.md/);
});

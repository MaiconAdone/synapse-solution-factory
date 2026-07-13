import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodeIntelligence,
  classifyProgrammingTask,
  findRelatedTests,
  summarizeCodeSymbols
} from "../src/context/codeIntelligence";

test("programming task classifier separates bugfix, feature, security, and explanation", () => {
  assert.equal(classifyProgrammingTask("corrija o bug no login"), "bugfix");
  assert.equal(classifyProgrammingTask("adicione endpoint de projetos"), "feature");
  assert.equal(classifyProgrammingTask("revise token e permissao LGPD"), "security");
  assert.equal(classifyProgrammingTask("explique como funciona o Synapse"), "explanation");
});

test("code intelligence finds related tests and suggests coding agents", () => {
  const summary = buildCodeIntelligence(
    "corrija o bug no projectFactoryService",
    [
      "backend/app/services/project_factory_service.py",
      "tests/test_backend_contracts.py",
      "adonex/src/agent/agentOrchestrator.ts",
      "adonex/test/agentOrchestrator.test.ts"
    ],
    [
      {
        path: "backend/app/services/project_factory_service.py",
        content: "from app.services.ruflo_service import RufloService\nclass ProjectFactoryService:\n    pass\n"
      },
      {
        path: "tests/test_backend_contracts.py",
        content: "def test_project_factory_service():\n    assert True\n"
      }
    ]
  );

  assert.equal(summary.taskKind, "bugfix");
  assert.ok(summary.suggestedAgents.includes("testing-qa"));
  assert.ok(summary.relatedTests.includes("tests/test_backend_contracts.py"));
  assert.equal(summary.modelProfile, "code_review");
});

test("code intelligence can request stronger local model profiles", () => {
  assert.equal(
    buildCodeIntelligence("investigue causa raiz e validacao logica", [], [])
      .modelProfile,
    "reasoning_strong"
  );
  assert.equal(
    buildCodeIntelligence("faca revisao final antes de producao usando 32b", [], [])
      .modelProfile,
    "code_critical"
  );
});

test("symbol summary extracts imports, exports, and declarations", () => {
  const summary = summarizeCodeSymbols(
    "src/example.ts",
    [
      "import path from \"node:path\";",
      "import { x } from \"./x\";",
      "export class Example {}",
      "export function run() {}",
      "const localValue = 1;"
    ].join("\n")
  );

  assert.deepEqual(summary.imports, ["node:path", "./x"]);
  assert.deepEqual(summary.exports, ["Example", "run"]);
  assert.ok(summary.declared.includes("localValue"));
});

test("related test finder prefers companion tests", () => {
  const tests = findRelatedTests(
    ["src/foo/service.ts"],
    ["src/foo/service.ts", "src/foo/service.test.ts", "src/bar/other.test.ts"]
  );

  assert.equal(tests[0], "src/foo/service.test.ts");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRouterUserPrompt,
  formatRouterGuidance,
  parseRouterDecision,
  ROUTER_JSON_SCHEMA,
  selectFocusPaths,
  shouldRunRouter
} from "../src/agent/routerAgent";

const candidates = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];

test("parses a clean router decision and keeps only known files", () => {
  const decision = parseRouterDecision(
    JSON.stringify({
      focus_files: ["src/a.ts", "src/hallucinated.ts", "src/b.ts"],
      strategy: "editar a e b",
      roles: ["backend", "testing-qa"]
    }),
    candidates
  );
  assert.ok(decision);
  assert.deepEqual(decision?.focusFiles, ["src/a.ts", "src/b.ts"]);
  assert.equal(decision?.strategy, "editar a e b");
  assert.deepEqual(decision?.roles, ["backend", "testing-qa"]);
});

test("caps focus files and roles at three", () => {
  const decision = parseRouterDecision(
    JSON.stringify({
      focus_files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      strategy: "tudo",
      roles: ["r1", "r2", "r3", "r4"]
    }),
    candidates
  );
  assert.equal(decision?.focusFiles.length, 3);
  assert.equal(decision?.roles.length, 3);
});

test("extracts decision wrapped in prose and fences", () => {
  const text = [
    "Claro:",
    "```json",
    '{"focus_files":["src/c.ts"],"strategy":"corrigir c","roles":[]}',
    "```"
  ].join("\n");
  const decision = parseRouterDecision(text, candidates);
  assert.deepEqual(decision?.focusFiles, ["src/c.ts"]);
  assert.equal(decision?.roles.length, 0);
});

test("returns undefined when there is no usable decision", () => {
  assert.equal(parseRouterDecision("desculpe", candidates), undefined);
  assert.equal(
    parseRouterDecision('{"focus_files":[],"strategy":""}', candidates),
    undefined
  );
});

test("keeps files when no candidate list is provided", () => {
  const decision = parseRouterDecision(
    '{"focus_files":["anything.ts"],"strategy":"x","roles":[]}',
    []
  );
  assert.deepEqual(decision?.focusFiles, ["anything.ts"]);
});

test("guidance text is compact and mentions focus files and strategy", () => {
  const guidance = formatRouterGuidance({
    focusFiles: ["src/a.ts"],
    strategy: "extrair funcao",
    roles: ["backend"]
  });
  assert.match(guidance, /ROUTER/);
  assert.match(guidance, /src\/a\.ts/);
  assert.match(guidance, /extrair funcao/);
  assert.ok(guidance.length < 400);
});

test("user prompt lists candidate files and caps the list", () => {
  const many = Array.from({ length: 30 }, (_, index) => `src/f${index}.ts`);
  const prompt = buildRouterUserPrompt("tarefa", many);
  assert.match(prompt, /src\/f0\.ts/);
  assert.doesNotMatch(prompt, /src\/f20\.ts/);
});

test("schema requires focus_files and strategy", () => {
  assert.deepEqual([...ROUTER_JSON_SCHEMA.required], ["focus_files", "strategy"]);
});

test("selectFocusPaths matches exact, suffix, and dedupes", () => {
  const candidates = ["src/a.ts", "src/nested/b.ts", "src/c.ts"];
  assert.deepEqual(selectFocusPaths(candidates, ["src/a.ts"]), ["src/a.ts"]);
  // router pode abreviar para o basename/sufixo
  assert.deepEqual(selectFocusPaths(candidates, ["b.ts"]), ["src/nested/b.ts"]);
  assert.deepEqual(
    selectFocusPaths(candidates, ["src/a.ts", "src/a.ts"]),
    ["src/a.ts"]
  );
});

test("selectFocusPaths returns empty when nothing matches", () => {
  assert.deepEqual(selectFocusPaths(["src/a.ts"], ["totally/other.ts"]), []);
  assert.deepEqual(selectFocusPaths(["src/a.ts"], []), []);
});

test("shouldRunRouter: enabled forces on regardless of file count", () => {
  assert.equal(shouldRunRouter(true, 3, 1), true);
  assert.equal(shouldRunRouter(true, 0, 0), true);
});

test("shouldRunRouter: auto-activates at or above the threshold", () => {
  assert.equal(shouldRunRouter(false, 3, 2), false);
  assert.equal(shouldRunRouter(false, 3, 3), true);
  assert.equal(shouldRunRouter(false, 3, 5), true);
});

test("shouldRunRouter: threshold 0 disables auto mode", () => {
  assert.equal(shouldRunRouter(false, 0, 10), false);
});

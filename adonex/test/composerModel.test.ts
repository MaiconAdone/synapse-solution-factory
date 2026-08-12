import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComposerFiles,
  diffLineStats,
  inferChangeKind,
  refinementMentionsUnknownFile,
  selectedChanges,
  summarizeProposalView
} from "../src/composer/composerModel";
import type { ProposedFileChange } from "../src/llm/types";

test("inferChangeKind classifies create, modify and delete", () => {
  assert.equal(inferChangeKind(undefined, "new content"), "create");
  assert.equal(inferChangeKind("", "new content"), "create");
  assert.equal(inferChangeKind("old", "new"), "modify");
  assert.equal(inferChangeKind("old content", "   "), "delete");
});

test("diffLineStats counts added and removed lines via LCS", () => {
  const before = "a\nb\nc";
  const after = "a\nB\nc\nd";
  const stats = diffLineStats(before, after);
  // b -> B is one deletion + one addition; d is one addition.
  assert.equal(stats.deletions, 1);
  assert.equal(stats.additions, 2);
});

test("diffLineStats treats a brand new file as pure additions", () => {
  const stats = diffLineStats("", "line1\nline2\nline3");
  assert.equal(stats.deletions, 0);
  assert.equal(stats.additions, 3);
});

test("buildComposerFiles defaults every file to selected on first run", () => {
  const changes: ProposedFileChange[] = [
    { path: "src/new.ts", content: "export const a = 1;\n" },
    { path: "src/existing.ts", content: "export const b = 2;\n" }
  ];
  const befores = new Map<string, string | undefined>([
    ["src/new.ts", undefined],
    ["src/existing.ts", "export const b = 1;\n"]
  ]);
  const files = buildComposerFiles(changes, befores);
  assert.equal(files.length, 2);
  assert.equal(files[0].changeKind, "create");
  assert.equal(files[1].changeKind, "modify");
  assert.ok(files.every((file) => file.selected));
});

test("buildComposerFiles honors a preserved selection when refining", () => {
  const changes: ProposedFileChange[] = [
    { path: "a.ts", content: "1\n" },
    { path: "b.ts", content: "2\n" }
  ];
  const befores = new Map<string, string | undefined>([
    ["a.ts", "0\n"],
    ["b.ts", "0\n"]
  ]);
  const files = buildComposerFiles(changes, befores, new Set(["a.ts"]));
  assert.equal(files.find((file) => file.path === "a.ts")?.selected, true);
  assert.equal(files.find((file) => file.path === "b.ts")?.selected, false);
});

test("selectedChanges filters changes by the selection set", () => {
  const changes: ProposedFileChange[] = [
    { path: "a.ts", content: "1" },
    { path: "b.ts", content: "2" },
    { path: "c.ts", content: "3" }
  ];
  const result = selectedChanges(changes, new Set(["a.ts", "c.ts"]));
  assert.deepEqual(result.map((change) => change.path), ["a.ts", "c.ts"]);
});

test("summarizeProposalView reports counts per change kind", () => {
  const summary = summarizeProposalView({
    summary: "x",
    commands: [],
    files: [
      { path: "a", changeKind: "create", additions: 1, deletions: 0, selected: true, preview: "" },
      { path: "b", changeKind: "modify", additions: 1, deletions: 1, selected: true, preview: "" },
      { path: "c", changeKind: "modify", additions: 2, deletions: 0, selected: true, preview: "" }
    ]
  });
  assert.equal(summary, "1 novo(s) · 2 alterado(s)");
});

const knownPaths = ["src/agent/agentOrchestrator.ts", "src/composer/composerSession.ts"];

test("refinementMentionsUnknownFile is false when the instruction has no file-like token", () => {
  assert.equal(
    refinementMentionsUnknownFile("deixa a mensagem mais curta e direta", knownPaths),
    false
  );
});

test("refinementMentionsUnknownFile is false when the mentioned file is already known", () => {
  assert.equal(
    refinementMentionsUnknownFile("ajusta tambem o agentOrchestrator.ts", knownPaths),
    false
  );
  assert.equal(
    refinementMentionsUnknownFile("atualiza src/composer/composerSession.ts", knownPaths),
    false
  );
});

test("refinementMentionsUnknownFile is true when the instruction cites a new file", () => {
  assert.equal(
    refinementMentionsUnknownFile("aplica a mesma mudanca em judgeAgent.ts", knownPaths),
    true
  );
});

test("refinementMentionsUnknownFile is case-insensitive and normalizes backslashes", () => {
  assert.equal(
    refinementMentionsUnknownFile("AJUSTA O AgentOrchestrator.TS", knownPaths),
    false
  );
  assert.equal(
    refinementMentionsUnknownFile("mexe em src\\composer\\composerSession.ts", knownPaths),
    false
  );
});

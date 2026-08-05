import assert from "node:assert/strict";
import test from "node:test";
import { diffLines, diffLineStats } from "../src/patch/textDiff";

test("diffLines marks unchanged lines as context, not delete+add", () => {
  const lines = diffLines("a\nb\nc", "a\nB\nc");
  assert.deepEqual(lines, [
    { tag: " ", text: "a" },
    { tag: "-", text: "b" },
    { tag: "+", text: "B" },
    { tag: " ", text: "c" }
  ]);
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

test("a single-line edit in a large file stays a single-line diff", () => {
  const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
  const before = lines.join("\n");
  const after = lines
    .map((line, index) => (index === 100 ? "line 100 edited" : line))
    .join("\n");
  const stats = diffLineStats(before, after);
  assert.equal(stats.deletions, 1);
  assert.equal(stats.additions, 1);
});

test("diffLines falls back to a full dump above the size ceiling without throwing", () => {
  const bigBefore = Array.from({ length: 2_001 }, (_, index) => `before ${index}`).join("\n");
  const bigAfter = Array.from({ length: 2_001 }, (_, index) => `after ${index}`).join("\n");
  const lines = diffLines(bigBefore, bigAfter);
  assert.equal(lines.length, 4_002);
  assert.ok(lines.every((line) => line.tag !== " "));
});

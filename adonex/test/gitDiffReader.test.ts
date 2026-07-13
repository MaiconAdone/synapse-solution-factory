import assert from "node:assert/strict";
import test from "node:test";
import { filterSensitiveDiff } from "../src/memory/gitDiffReader";

test("git diff filter removes environment file sections", () => {
  const diff = [
    "diff --git a/.env b/.env",
    "--- a/.env",
    "+++ b/.env",
    "+OPENAI_API_KEY=secret",
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "+export const ready = true;"
  ].join("\n");
  const filtered = filterSensitiveDiff(diff);
  assert.doesNotMatch(filtered, /OPENAI_API_KEY/);
  assert.match(filtered, /src\/app\.ts/);
});

test("git diff filter removes generated directory sections", () => {
  const diff = [
    "diff --git a/dist/app.js b/dist/app.js",
    "+generated",
    "diff --git a/src/app.ts b/src/app.ts",
    "+source"
  ].join("\n");
  const filtered = filterSensitiveDiff(diff);
  assert.doesNotMatch(filtered, /generated/);
  assert.match(filtered, /src\/app\.ts/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { hasMentions, parseMentions } from "../src/context/mentionResolver";

test("parseMentions extracts special mentions", () => {
  const parsed = parseMentions("olhe @selection e @file por favor");
  assert.deepEqual(parsed.specials.sort(), ["file", "selection"]);
  assert.deepEqual(parsed.paths, []);
});

test("parseMentions extracts path mentions with extension or slash", () => {
  const parsed = parseMentions("veja @src/app.ts e @package.json e @README");
  assert.deepEqual(parsed.paths.sort(), ["package.json", "src/app.ts"]);
});

test("parseMentions normalizes backslashes and trims trailing punctuation", () => {
  const parsed = parseMentions("cheque @src\\config.ts.");
  assert.deepEqual(parsed.paths, ["src/config.ts"]);
});

test("parseMentions ignores emails and plain words", () => {
  const parsed = parseMentions("mande para foo@bar e cite @coisa qualquer");
  assert.deepEqual(parsed.specials, []);
  assert.deepEqual(parsed.paths, []);
});

test("hasMentions detects presence of any mention", () => {
  assert.equal(hasMentions("nada aqui"), false);
  assert.equal(hasMentions("use @file"), true);
  assert.equal(hasMentions("veja @a/b.ts"), true);
});

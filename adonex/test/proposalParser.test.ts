import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProposalRepairPrompt,
  extractJsonObject,
  parseProposalText,
  ProposalParseError,
  PROPOSAL_JSON_SCHEMA,
  repairJsonText
} from "../src/agent/proposalParser";

test("parses a clean proposal object", () => {
  const proposal = parseProposalText(
    JSON.stringify({
      summary: "add file",
      changes: [{ path: "src/a.ts", content: "export const a = 1;\n" }],
      operations: [],
      commands: ["npm test"]
    })
  );
  assert.equal(proposal.summary, "add file");
  assert.equal(proposal.changes.length, 1);
  assert.deepEqual(proposal.commands, ["npm test"]);
});

test("parses a proposal wrapped in prose and code fences", () => {
  const text = [
    "Claro! Aqui esta a proposta:",
    "```json",
    JSON.stringify({
      summary: "fix",
      changes: [{ path: "src/a.ts", content: "const a = 2;" }],
      commands: []
    }),
    "```",
    "Espero que ajude."
  ].join("\n");
  const proposal = parseProposalText(text);
  assert.equal(proposal.changes[0].path, "src/a.ts");
});

test("extractJsonObject ignores braces inside strings", () => {
  const text = 'ruido {"summary":"a { not a brace }","changes":[],"commands":[]} fim';
  const json = extractJsonObject(text);
  assert.ok(json);
  const parsed = JSON.parse(json as string);
  assert.equal(parsed.summary, "a { not a brace }");
});

test("repairs trailing commas and comments", () => {
  const dirty = `{
    // proposta
    "summary": "x",
    "changes": [{ "path": "a.ts", "content": "1", }],
    "operations": [],
    "commands": [],
  }`;
  const proposal = parseProposalText(dirty);
  assert.equal(proposal.summary, "x");
  assert.equal(proposal.changes.length, 1);
});

test("repairJsonText leaves comment-like content inside strings untouched", () => {
  const input = '{"summary":"use // and /* */ in code","changes":[],"commands":[]}';
  assert.equal(repairJsonText(input), input);
});

test("drops malformed operations instead of failing the whole proposal", () => {
  const proposal = parseProposalText(
    JSON.stringify({
      summary: "ops",
      changes: [],
      operations: [
        { type: "replace", path: "a.ts", expected: "x", replacement: "y" },
        { type: "replace", path: "a.ts" },
        { type: "bogus", path: "a.ts" },
        { type: "append", path: "b.ts", content: "tail" }
      ],
      commands: []
    })
  );
  assert.equal(proposal.operations?.length, 2);
  assert.equal(proposal.operations?.[0].type, "replace");
  assert.equal(proposal.operations?.[1].type, "append");
});

test("normalizes missing arrays and non-string commands", () => {
  const proposal = parseProposalText(
    '{"summary":"s","changes":[{"path":"a.ts","content":"x"}],"commands":["ok",3,null]}'
  );
  assert.deepEqual(proposal.commands, ["ok"]);
  assert.deepEqual(proposal.operations, []);
});

test("throws when there is no proposal content at all", () => {
  assert.throws(() => parseProposalText("desculpe, nao entendi"), ProposalParseError);
});

test("throws when proposal has neither changes nor operations", () => {
  assert.throws(
    () => parseProposalText('{"summary":"nada","changes":[],"operations":[],"commands":[]}'),
    ProposalParseError
  );
});

test("repair prompt truncates long previous output", () => {
  const prompt = buildProposalRepairPrompt("x".repeat(10_000));
  assert.ok(prompt.includes("SOMENTE"));
  assert.ok(prompt.length < 7_000);
});

test("schema declares the required proposal fields", () => {
  assert.deepEqual([...PROPOSAL_JSON_SCHEMA.required], ["summary", "changes", "commands"]);
});

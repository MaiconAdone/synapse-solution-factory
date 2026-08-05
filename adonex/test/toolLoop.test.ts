import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseToolLoopDecision, runToolLoop, type RunToolLoopOptions } from "../src/agent/toolLoop/loop";
import type { CommandResult, LlmRequest, LlmResponse, WorkspaceSnapshot } from "../src/llm/types";

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "adonex-toolloop-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "app.ts"), "const value = 1;\n", "utf8");
  return root;
}

function baseSnapshot(root: string): WorkspaceSnapshot {
  return {
    root,
    stack: ["TypeScript"],
    synapseDetected: false,
    synapseConfidence: 0,
    synapseSignals: [],
    structure: ["src/app.ts"],
    relevantFiles: [
      { path: "src/app.ts", content: "const value = 1;\n", redacted: false, score: 1, reasons: [] }
    ],
    estimatedTokens: 100
  };
}

function scriptedGenerate(
  responses: string[],
  captured: LlmRequest[] = []
): (request: LlmRequest) => Promise<LlmResponse> {
  let index = 0;
  return async (request) => {
    captured.push(request);
    const text = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      provider: "ollama",
      model: "fake-model",
      text,
      inputTokens: 10,
      outputTokens: 5
    };
  };
}

function baseOptions(
  root: string,
  overrides: Partial<RunToolLoopOptions> = {}
): RunToolLoopOptions {
  return {
    task: "atualize o valor em src/app.ts",
    action: "implement",
    systemPromptBase: "system",
    maxSteps: 8,
    maxOutputTokens: 400,
    generate: scriptedGenerate(['{"tool":"finish","summary":"nada a fazer"}']),
    tools: {
      root,
      snapshot: baseSnapshot(root),
      maxReadChars: 6_000,
      maxSearchResults: 10,
      semantic: {
        enabled: false,
        baseUrl: "http://127.0.0.1:11434",
        model: "nomic-embed-text:latest",
        maxCandidates: 10,
        timeoutMs: 1_000
      },
      runCommand: async (command): Promise<CommandResult> => ({
        command,
        exitCode: 0,
        stdout: "1 passed",
        stderr: "",
        durationMs: 5,
        timedOut: false
      })
    },
    ...overrides
  };
}

test("parseToolLoopDecision accepts clean JSON", () => {
  const decision = parseToolLoopDecision('{"tool":"read_file","path":"src/app.ts"}');
  assert.equal(decision?.tool, "read_file");
  assert.equal(decision?.path, "src/app.ts");
});

test("parseToolLoopDecision extracts JSON wrapped in prose and fences", () => {
  const text = ["Claro, vou ler o arquivo:", "```json", '{"tool":"read_file","path":"src/app.ts"}', "```"].join("\n");
  const decision = parseToolLoopDecision(text);
  assert.equal(decision?.tool, "read_file");
});

test("parseToolLoopDecision rejects unknown tools and empty text", () => {
  assert.equal(parseToolLoopDecision('{"tool":"delete_everything"}'), undefined);
  assert.equal(parseToolLoopDecision(""), undefined);
  assert.equal(parseToolLoopDecision("nao sei o que fazer"), undefined);
});

test("tool loop reads, edits virtually, re-reads the edit, then finishes", async () => {
  const root = await makeWorkspace();
  const captured: LlmRequest[] = [];
  const responses = [
    '{"tool":"read_file","path":"src/app.ts"}',
    '{"tool":"edit_file","operation":{"type":"replace","path":"src/app.ts","expected":"const value = 1;","replacement":"const value = 2;"}}',
    '{"tool":"read_file","path":"src/app.ts"}',
    '{"tool":"finish","summary":"Valor atualizado","commands":["npm test"]}'
  ];
  const result = await runToolLoop(
    baseOptions(root, { generate: scriptedGenerate(responses, captured) })
  );

  assert.equal(result.steps.length, 4);
  assert.equal(result.proposal.summary, "Valor atualizado");
  assert.deepEqual(result.proposal.commands, ["npm test"]);
  assert.equal(result.proposal.operations?.length, 1);
  assert.equal(result.proposal.operations?.[0].type, "replace");
  assert.equal(result.proposal.changes.length, 0);

  // Passo 3 releu o arquivo apos o edit_file virtual: deve ver o valor novo,
  // nao o conteudo original em disco.
  assert.match(result.steps[2].resultSummary, /const value = 2;/);

  // O transcript enviado no turno 4 deve conter o historico dos 3 passos
  // anteriores (o cliente Ollama nao tem canal de historico nativo).
  assert.match(captured[3].userPrompt, /Passo 1/);
  assert.match(captured[3].userPrompt, /Passo 2/);
  assert.match(captured[3].userPrompt, /Passo 3/);
});

test("tool loop stops at maxSteps and preserves accumulated progress", async () => {
  const root = await makeWorkspace();
  const result = await runToolLoop(
    baseOptions(root, {
      maxSteps: 3,
      generate: scriptedGenerate(['{"tool":"list_files"}'])
    })
  );
  assert.equal(result.steps.length, 3);
  assert.match(result.proposal.summary, /Limite de 3 passo/);
});

test("tool loop terminates immediately on an unparseable decision", async () => {
  const root = await makeWorkspace();
  const result = await runToolLoop(
    baseOptions(root, {
      generate: scriptedGenerate(["desculpe, nao consigo ajudar com isso"])
    })
  );
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].ok, false);
  assert.match(result.steps[0].resultSummary, /nao pode ser interpretada/);
});

test("tool loop edit_file refuses sensitive paths and invalid operations", async () => {
  const root = await makeWorkspace();
  const result = await runToolLoop(
    baseOptions(root, {
      generate: scriptedGenerate([
        '{"tool":"edit_file","operation":{"type":"replace","path":".env","expected":"X","replacement":"Y"}}',
        '{"tool":"edit_file","operation":{"type":"replace","path":"src/app.ts"}}',
        '{"tool":"finish","summary":"sem mudancas seguras"}'
      ])
    })
  );
  assert.equal(result.steps[0].ok, false);
  assert.match(result.steps[0].resultSummary, /sensivel/);
  assert.equal(result.steps[1].ok, false);
  assert.match(result.steps[1].resultSummary, /invalida/);
  assert.equal(result.proposal.operations?.length ?? 0, 0);
});

test("tool loop stops immediately, without a cosmetic error step, when a tool is killed by the AbortSignal", async () => {
  const root = await makeWorkspace();
  const controller = new AbortController();
  const result = await runToolLoop(
    baseOptions(root, {
      signal: controller.signal,
      generate: scriptedGenerate(['{"tool":"run_command","command":"npm test"}']),
      tools: {
        root,
        snapshot: baseSnapshot(root),
        maxReadChars: 6_000,
        maxSearchResults: 10,
        semantic: {
          enabled: false,
          baseUrl: "http://127.0.0.1:11434",
          model: "nomic-embed-text:latest",
          maxCandidates: 10,
          timeoutMs: 1_000
        },
        // Simula o Node matando o processo quando o AbortSignal dispara: o
        // signal ja esta aborted no momento em que a rejeicao chega ao loop.
        runCommand: async () => {
          controller.abort();
          throw new Error("Comando cancelado pelo usuario.");
        }
      }
    })
  );
  assert.equal(result.steps.length, 0);
});

test("tool loop run_command surfaces captured output through the step", async () => {
  const root = await makeWorkspace();
  const result = await runToolLoop(
    baseOptions(root, {
      generate: scriptedGenerate([
        '{"tool":"run_command","command":"npm test"}',
        '{"tool":"finish","summary":"testes passaram"}'
      ])
    })
  );
  assert.equal(result.steps[0].tool, "run_command");
  assert.equal(result.steps[0].ok, true);
  assert.match(result.steps[0].resultSummary, /exit 0/);
  assert.match(result.steps[0].resultSummary, /1 passed/);
});

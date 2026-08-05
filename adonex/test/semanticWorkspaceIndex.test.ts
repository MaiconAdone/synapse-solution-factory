import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SemanticWorkspaceIndex } from "../src/context/semanticWorkspaceIndex";

test("semantic workspace index reranks candidates with local embedding similarity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adonex-semantic-"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      const embeddings = body.input.map((text) => {
        const normalized = text.toLowerCase();
        return normalized.includes("auth") || normalized.includes("login")
          ? [1, 0]
          : [0, 1];
      });
      return new Response(JSON.stringify({ embeddings }), { status: 200 });
    }) as typeof fetch;

    const reranked = await new SemanticWorkspaceIndex(root).rerank(
      "corrigir login e autenticação",
      [
        { relativePath: "docs/roadmap.md", score: 10, reasons: ["project-manifest"] },
        { relativePath: "backend/auth/login.ts", score: 5, reasons: ["domain:auth"] }
      ],
      {
        enabled: true,
        baseUrl: "http://127.0.0.1:11434",
        model: "nomic-embed-text:latest",
        maxCandidates: 10,
        timeoutMs: 1000
      }
    );

    assert.equal(reranked[0].relativePath, "backend/auth/login.ts");
    assert.ok(reranked[0].reasons.includes("semantic-local-index"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

const warmOptions = {
  enabled: true,
  baseUrl: "http://127.0.0.1:11434",
  model: "nomic-embed-text:latest",
  maxCandidates: 10,
  timeoutMs: 1000
};

test("warmIndex builds the cache without a task, then skips already up-to-date candidates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adonex-semantic-warm-"));
  const originalFetch = globalThis.fetch;
  let embedCalls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      embedCalls += 1;
      return new Response(
        JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }),
        { status: 200 }
      );
    }) as typeof fetch;

    const index = new SemanticWorkspaceIndex(root);
    const candidates = [
      { relativePath: "a.ts", score: 0, reasons: [] },
      { relativePath: "b.ts", score: 0, reasons: [] }
    ];

    const first = await index.warmIndex(candidates, warmOptions);
    assert.deepEqual(first, { embedded: 2, total: 2, skipped: 0 });
    assert.equal(embedCalls, 1);

    const second = await index.warmIndex(candidates, warmOptions);
    assert.deepEqual(second, { embedded: 0, total: 2, skipped: 2 });
    // Nada estava desatualizado: ensureFresh nao chama embed() de novo.
    assert.equal(embedCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("warmIndex re-embeds only the candidate whose descriptor actually changed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adonex-semantic-warm-"));
  const originalFetch = globalThis.fetch;
  const embeddedInputs: string[][] = [];
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      embeddedInputs.push(body.input);
      return new Response(
        JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }),
        { status: 200 }
      );
    }) as typeof fetch;

    const index = new SemanticWorkspaceIndex(root);
    await index.warmIndex(
      [
        { relativePath: "a.ts", score: 0, reasons: ["domain:auth"] },
        { relativePath: "b.ts", score: 0, reasons: ["domain:data"] }
      ],
      warmOptions
    );
    assert.equal(embeddedInputs.length, 1);

    const result = await index.warmIndex(
      [
        // Reasons mudaram: descriptor diferente, precisa reincorporar.
        { relativePath: "a.ts", score: 0, reasons: ["domain:auth", "task-term:login"] },
        { relativePath: "b.ts", score: 0, reasons: ["domain:data"] }
      ],
      warmOptions
    );
    assert.deepEqual(result, { embedded: 1, total: 2, skipped: 1 });
    assert.equal(embeddedInputs.length, 2);
    assert.equal(embeddedInputs[1].length, 1);
    assert.match(embeddedInputs[1][0], /path: a\.ts/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
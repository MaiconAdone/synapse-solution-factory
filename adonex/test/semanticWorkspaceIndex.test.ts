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
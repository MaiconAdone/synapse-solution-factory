import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  formatCatalogAnswer,
  isCatalogEligibleQuestion,
  LocalAnswerCatalog,
  normalizeQuestion
} from "../src/chat/localAnswerCatalog";

test("local answer catalog stores and reuses model-generated answers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adonex-catalog-"));
  const catalog = new LocalAnswerCatalog(root);
  await catalog.record(
    "Qual o tempo medio de resposta do modelo local em uma solicitacao simples?",
    "Depende do hardware, carga e tamanho do prompt; timeout nao e media real.",
    "ollama",
    "qwen2.5-coder:3b"
  );

  const exact = await catalog.find(
    "qual o tempo medio de resposta do modelo local em uma solicitacao simples"
  );
  assert.ok(exact);
  assert.equal(exact.exact, true);
  assert.match(formatCatalogAnswer(exact), /gerada originalmente pelo modelo qwen2\.5-coder:3b/);

  const similar = await catalog.find(
    "qual tempo medio resposta modelo local solicitacao simples"
  );
  assert.ok(similar);
  assert.equal(similar.exact, false);

  const raw = await readFile(
    path.join(root, ".adonex", "cache", "local-answer-catalog.json"),
    "utf8"
  );
  assert.match(raw, /model_generated/);
  await rm(root, { recursive: true, force: true });
});

test("local answer catalog rejects mutable questions and failure fallbacks", async () => {
  assert.equal(isCatalogEligibleQuestion("qual e o status atual do arquivo @src/app.ts?"), false);
  assert.equal(
    normalizeQuestion("Qual é o tempo médio?"),
    "qual e o tempo medio"
  );

  const root = await mkdtemp(path.join(tmpdir(), "adonex-catalog-"));
  const catalog = new LocalAnswerCatalog(root);
  await catalog.record(
    "qual o tempo medio do modelo local?",
    "## Ollama local nao concluiu a resposta",
    "ollama",
    "qwen2.5-coder:3b"
  );
  assert.equal(await catalog.find("qual o tempo medio do modelo local?"), undefined);
  await rm(root, { recursive: true, force: true });
});

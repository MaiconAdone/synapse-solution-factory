import assert from "node:assert/strict";
import test from "node:test";
import { detectDatabaseProject } from "../src/context/workspaceContextCore";

// databaseSpecialist.ts importa `vscode` diretamente (findFiles/fs/config),
// entao nao pode ser importado pelo runner de testes puro (node --test),
// que roda fora do host do VS Code — mesma razao pela qual workspaceContext.ts
// (a classe, nao o core) tambem nunca e importada diretamente nos testes.
// looksLikeDatabaseQuestion/DATABASE_QUESTION_PATTERN sao cobertos indiretamente
// por essa restricao; detectDatabaseProject vive em workspaceContextCore.ts
// (sem vscode) e e testavel diretamente aqui.

test("detectDatabaseProject requires a real database signal, not just any file", () => {
  const withMigrations = detectDatabaseProject([
    "backend/migrations/0001_init.sql",
    "backend/app/main.py"
  ]);
  assert.equal(withMigrations.detected, true);
  assert.ok(withMigrations.signals.includes("migrations-dir"));

  const withoutSignals = detectDatabaseProject(["backend/app/main.py", "README.md"]);
  assert.equal(withoutSignals.detected, false);
});

test("detectDatabaseProject picks up docker-compose content signals", () => {
  const result = detectDatabaseProject(
    ["docker-compose.yml"],
    "services:\n  db:\n    image: postgres:16"
  );
  assert.equal(result.detected, true);
  assert.ok(result.signals.includes("postgres"));
});

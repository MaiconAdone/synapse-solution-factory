import assert from "node:assert/strict";
import test from "node:test";
import {
  detectStack,
  rankPathForTask,
  scorePathForTask,
  selectContextExcerpt
} from "../src/context/workspaceContextCore";
import {
  isSensitivePath,
  isIgnoredContextPath,
  scanAndRedactSecrets
} from "../src/security/secretScanner";

test("workspace context detects common Synapse stack components", () => {
  const stack = detectStack(
    ["backend/main.py", "requirements.txt", "frontend/package.json", "tsconfig.json", "docker-compose.yml"],
    "FastAPI React next postgres ollama openai"
  );
  assert.ok(stack.includes("Python"));
  assert.ok(stack.includes("FastAPI"));
  assert.ok(stack.includes("Node.js"));
  assert.ok(stack.includes("React"));
  assert.ok(stack.includes("Docker"));
});

test("workspace context prioritizes task-related paths", () => {
  assert.ok(
    scorePathForTask("backend/auth/jwt_service.py", "implement jwt authentication") >
      scorePathForTask("docs/roadmap.md", "implement jwt authentication")
  );
  const ranked = rankPathForTask(
    "backend/auth/jwt_service.py",
    "implement jwt authentication"
  );
  assert.ok(ranked.reasons.includes("domain:auth"));
});

test("workspace context prioritizes project health contracts for broad audits", () => {
  const task = "verifique se existem erros no projeto local Synapse";
  assert.ok(
    scorePathForTask("package.json", task) >
      scorePathForTask("adonex/test/workspaceContext.test.ts", task)
  );
  assert.ok(
    scorePathForTask("tests/test_backend_contracts.py", task) >
      scorePathForTask("scripts/test_local_llm.py", task)
  );
});

test("workspace context prioritizes root Synapse files for project explanation", () => {
  const task = "explique o projeto Synapse";
  assert.ok(
    scorePathForTask("README.md", task) >
      scorePathForTask("adonex/package.json", task)
  );
  assert.ok(
    scorePathForTask("config/runtime_manifest.json", task) >
      scorePathForTask("adonex/package.json", task)
  );
});

test("workspace context prioritizes Synapse model inventory files", () => {
  const task = "quais modelos estamos usando na Synapse?";
  assert.ok(
    scorePathForTask("config/model_providers.json", task) >
      scorePathForTask("docker-compose.yml", task)
  );
  assert.ok(
    scorePathForTask("config/runtime_manifest.json", task) >
      scorePathForTask("README.md", task)
  );
});

test("workspace context never selects environment secret files", () => {
  assert.equal(isSensitivePath(".env"), true);
  assert.equal(isSensitivePath("backend/.env.local"), true);
  assert.equal(isSensitivePath(".env.example"), true);
});

test("workspace context ignores generated and dependency directories", () => {
  assert.equal(isIgnoredContextPath("node_modules/pkg/index.js"), true);
  assert.equal(isIgnoredContextPath(".git/config"), true);
  assert.equal(isIgnoredContextPath("dist/src/extension.js"), true);
  assert.equal(isIgnoredContextPath("build/output.txt"), true);
  assert.equal(isIgnoredContextPath(".venv/Lib/site.py"), true);
  assert.equal(isIgnoredContextPath("src/__pycache__/module.pyc"), true);
  assert.equal(isIgnoredContextPath("output/smoke-project/result.json"), true);
  assert.equal(isIgnoredContextPath("artifacts/models/model.json"), true);
  assert.equal(isIgnoredContextPath(".claude-flow/security/audit.json"), true);
  assert.equal(isIgnoredContextPath(".claude/commands/review.md"), true);
  assert.equal(isIgnoredContextPath(".adonex/tasks/task.md"), true);
  assert.equal(isIgnoredContextPath(".codex/config.toml"), true);
  assert.equal(isIgnoredContextPath("frontend/.next/dev/cache/chunk.sst"), true);
  assert.equal(isIgnoredContextPath("adonex/dist/extension.js.map"), true);
  assert.equal(isIgnoredContextPath("debug.log"), true);
  assert.equal(isIgnoredContextPath("adonex-0.6.16.vsix"), true);
  assert.equal(isIgnoredContextPath("src/app.ts"), false);
});

test("secret scanner redacts API keys before context or logs", () => {
  const result = scanAndRedactSecrets(
    "OPENAI_API_KEY=sk-example-secret-value-123456789"
  );
  assert.equal(result.safe, false);
  assert.doesNotMatch(result.redacted, /sk-example-secret/);
});

test("workspace context keeps head and tail excerpts for large relevant files", () => {
  const excerpt = selectContextExcerpt(
    `${"a".repeat(1000)}IMPORTANT_TAIL`,
    900,
    true
  );
  assert.match(excerpt, /conteudo omitido/);
  assert.match(excerpt, /IMPORTANT_TAIL/);
});

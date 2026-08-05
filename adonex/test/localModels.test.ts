import assert from "node:assert/strict";
import test from "node:test";
import {
  ADONEX_ALLOWED_LOCAL_MODELS,
  ADONEX_FAST_LOCAL_MODEL,
  ADONEX_LOCAL_MODEL_PROFILES,
  ADONEX_REASONING_LOCAL_MODEL,
  localProfileForName,
  normalizeLocalModel,
  outputBudgetForTask,
  selectLocalModelForTask,
  selectLocalModelProfileForTask
} from "../src/llm/localModels";

test("AdoneX only allows the Synapse-approved local Ollama models", () => {
  assert.deepEqual(ADONEX_ALLOWED_LOCAL_MODELS, [
    "qwen2.5-coder:3b",
    "qwen3:8b",
    "deepseek-coder-v2:lite",
    "qwen2.5-coder:14b",
    "qwen3:14b",
    "deepseek-r1:14b",
    "qwen2.5-coder:32b",
    "nomic-embed-text:latest"
  ]);
});

test("local model normalization falls back to the configured role default", () => {
  assert.equal(
    normalizeLocalModel("qwen2.5-coder:14b", ADONEX_FAST_LOCAL_MODEL),
    "qwen2.5-coder:14b"
  );
  assert.equal(
    normalizeLocalModel("qwen2.5-coder:32b", ADONEX_REASONING_LOCAL_MODEL),
    "qwen2.5-coder:32b"
  );
  assert.equal(
    normalizeLocalModel("deepseek-coder-v2:lite", ADONEX_FAST_LOCAL_MODEL),
    "deepseek-coder-v2:lite"
  );
});

test("local model profiles connect every installed Synapse Ollama role", () => {
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.fast.model, "qwen2.5-coder:3b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.general.model, "qwen3:8b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_review.model, "deepseek-coder-v2:lite");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_strong.model, "qwen2.5-coder:14b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.planning_strong.model, "qwen3:14b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.reasoning_strong.model, "deepseek-r1:14b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_critical.model, "qwen2.5-coder:32b");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.embeddings.model, "nomic-embed-text:latest");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.embeddings.generation, false);
});

test("local model selector keeps routine work on the fast local model", () => {
  assert.equal(
    selectLocalModelForTask("review", "revise rapidamente este resumo"),
    "qwen2.5-coder:3b"
  );
  assert.equal(
    selectLocalModelForTask("review", "faÃ§a code review e encontre o bug"),
    "qwen2.5-coder:3b"
  );
  assert.equal(
    selectLocalModelForTask("chat", "qual a estrutura deste projeto?"),
    "qwen2.5-coder:3b"
  );
});

test("local model selector routes real code generation to the local code model", () => {
  // Calibracao CPU-only: 3b triagem/chat; geracao de codigo vai para o lite MoE.
  assert.equal(
    selectLocalModelForTask("implement", "adicione um endpoint"),
    "deepseek-coder-v2:lite"
  );
  assert.equal(
    selectLocalModelForTask("fix", "corrija o teste que quebrou"),
    "deepseek-coder-v2:lite"
  );
  assert.equal(
    selectLocalModelProfileForTask("implement", "adicione um endpoint").profile,
    "code_review"
  );
  // Analises Synapse longas usam o modelo de raciocinio, nao o 3b.
  assert.equal(
    selectLocalModelProfileForTask("synapse_architecture", "avalie a arquitetura").profile,
    "balanced"
  );
});

test("local model selector only escalates to slower profiles when explicitly requested", () => {
  assert.deepEqual(
    {
      profile: selectLocalModelProfileForTask("plan", "planeje a arquitetura e governanca com modelo forte 14b").profile,
      model: selectLocalModelProfileForTask("plan", "planeje a arquitetura e governanca com modelo forte 14b").model
    },
    { profile: "planning_strong", model: "qwen3:14b" }
  );
  assert.equal(
    selectLocalModelProfileForTask("fix", "encontre a causa raiz com raciocinio forte e faca validacao logica").model,
    "deepseek-r1:14b"
  );
  assert.equal(
    selectLocalModelProfileForTask("review", "revisao final antes de producao usando 32b").model,
    "qwen2.5-coder:32b"
  );
  assert.equal(localProfileForName("code_strong")?.numCtx, 4096);
});

test("local output budgets prevent truncated code JSON without unbounded generation", () => {
  assert.equal(outputBudgetForTask(ADONEX_LOCAL_MODEL_PROFILES.fast, "fix", "corrija este bug"), 768);
  assert.equal(outputBudgetForTask(ADONEX_LOCAL_MODEL_PROFILES.code_strong, "implement", "implemente este endpoint"), 1200);
  assert.equal(
    outputBudgetForTask(ADONEX_LOCAL_MODEL_PROFILES.code_strong, "implement", "refatoracao grande em varios arquivos"),
    1800
  );
});

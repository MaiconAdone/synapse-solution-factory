import assert from "node:assert/strict";
import test from "node:test";
import {
  ADONEX_ALLOWED_LOCAL_MODELS,
  ADONEX_FAST_LOCAL_MODEL,
  ADONEX_LOCAL_MODEL_PROFILES,
  ADONEX_REASONING_LOCAL_MODEL,
  escalateLocalModelProfile,
  localProfileForName,
  normalizeLocalModel,
  outputBudgetForTask,
  selectLocalModelForTask,
  selectLocalModelProfileForTask
} from "../src/llm/localModels";

test("AdoneX only allows the Synapse-approved local Ollama models", () => {
  assert.deepEqual(ADONEX_ALLOWED_LOCAL_MODELS, [
    "qwen3-coder-14b-team",
    "nomic-embed-text:latest"
  ]);
});

test("local model normalization falls back to the configured role default", () => {
  assert.equal(
    normalizeLocalModel("qwen3-coder-14b-team", ADONEX_FAST_LOCAL_MODEL),
    "qwen3-coder-14b-team"
  );
  assert.equal(
    normalizeLocalModel("nomic-embed-text:latest", ADONEX_REASONING_LOCAL_MODEL),
    "nomic-embed-text:latest"
  );
  assert.equal(
    normalizeLocalModel("unknown-model:latest", ADONEX_FAST_LOCAL_MODEL),
    "qwen3-coder-14b-team"
  );
});

test("local model profiles connect every installed Synapse Ollama role", () => {
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.fast.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.general.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_review.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_strong.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.planning_strong.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.reasoning_strong.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.code_critical.model, "qwen3-coder-14b-team");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.embeddings.model, "nomic-embed-text:latest");
  assert.equal(ADONEX_LOCAL_MODEL_PROFILES.embeddings.generation, false);
});

test("local model selector keeps routine work on the fast local model", () => {
  assert.equal(
    selectLocalModelForTask("review", "revise rapidamente este resumo"),
    "qwen3-coder-14b-team"
  );
  assert.equal(
    selectLocalModelForTask("review", "faÃ§a code review e encontre o bug"),
    "qwen3-coder-14b-team"
  );
  assert.equal(
    selectLocalModelForTask("chat", "qual a estrutura deste projeto?"),
    "qwen3-coder-14b-team"
  );
});

test("local model selector routes real code generation to the local code model", () => {
  assert.equal(
    selectLocalModelForTask("implement", "adicione um endpoint"),
    "qwen3-coder-14b-team"
  );
  assert.equal(
    selectLocalModelForTask("fix", "corrija o teste que quebrou"),
    "qwen3-coder-14b-team"
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
    { profile: "planning_strong", model: "qwen3-coder-14b-team" }
  );
  assert.equal(
    selectLocalModelProfileForTask("fix", "encontre a causa raiz com raciocinio forte e faca validacao logica").model,
    "qwen3-coder-14b-team"
  );
  assert.equal(
    selectLocalModelProfileForTask("review", "revisao final antes de producao usando 32b").model,
    "qwen3-coder-14b-team"
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

test("escalateLocalModelProfile steps up exactly one tier for each profile", () => {
  assert.equal(escalateLocalModelProfile("fast"), "balanced");
  assert.equal(escalateLocalModelProfile("general"), "balanced");
  assert.equal(escalateLocalModelProfile("balanced"), "code_strong");
  assert.equal(escalateLocalModelProfile("code_review"), "code_strong");
  assert.equal(escalateLocalModelProfile("code_strong"), "code_critical");
  assert.equal(escalateLocalModelProfile("planning_strong"), "reasoning_strong");
  assert.equal(escalateLocalModelProfile("reasoning_strong"), "code_critical");
});

test("escalateLocalModelProfile caps at code_critical and leaves embeddings untouched", () => {
  assert.equal(escalateLocalModelProfile("code_critical"), "code_critical");
  assert.equal(escalateLocalModelProfile("embeddings"), "embeddings");
});

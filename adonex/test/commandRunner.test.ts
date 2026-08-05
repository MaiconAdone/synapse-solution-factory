import assert from "node:assert/strict";
import test from "node:test";
import { executeCapturedCommand } from "../src/execution/capturedCommand";
import { assessCommand } from "../src/execution/commandPolicy";

test("command runner blocks destructive commands", () => {
  assert.equal(assessCommand("rm -rf /").allowed, false);
  assert.equal(assessCommand("shutdown /s").allowed, false);
  assert.equal(assessCommand("git reset --hard").allowed, false);
});

test("command runner permits tests but requires approval", () => {
  const assessment = assessCommand("python -m pytest");
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.requiresApproval, true);
});

test("autonomous Synapse mode cannot bypass dangerous-command policy", () => {
  for (const command of ["rm -rf /", "shutdown /s", "git reset --hard"]) {
    const assessment = assessCommand(command);
    assert.equal(assessment.allowed, false);
    assert.equal(assessment.requiresApproval, false);
  }
});

test("captured command records stdout and failure details", async () => {
  const result = await executeCapturedCommand(
    "npm test",
    process.cwd(),
    1000,
    async () => {
      throw Object.assign(new Error("tests failed"), {
        code: 2,
        stdout: "1 passed",
        stderr: "1 failed"
      });
    }
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "1 passed");
  assert.equal(result.stderr, "1 failed");
});

test("captured command rejects instead of resolving when killed by an AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      executeCapturedCommand(
        "npm test",
        process.cwd(),
        1000,
        // Simula o Node matando o processo por causa do signal: mesma forma
        // de erro que um timeout interno produziria (killed:true, sem code).
        async () => {
          throw Object.assign(new Error("The operation was aborted"), {
            killed: true,
            code: null
          });
        },
        controller.signal
      ),
    (error: unknown) => error instanceof Error && error.name === "AbortError"
  );
});

test("captured command behaves normally when the signal never aborts", async () => {
  const controller = new AbortController();
  const result = await executeCapturedCommand(
    "npm test",
    process.cwd(),
    1000,
    async () => ({ stdout: "ok", stderr: "" }),
    controller.signal
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
});

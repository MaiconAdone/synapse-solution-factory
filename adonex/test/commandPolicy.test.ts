import assert from "node:assert/strict";
import test from "node:test";
import { assessCommand } from "../src/execution/commandPolicy";

test("command policy classifies sandbox category and risk", () => {
  const testCommand = assessCommand("python -m pytest tests/test_backend_contracts.py");
  assert.equal(testCommand.allowed, true);
  assert.equal(testCommand.category, "test");
  assert.equal(testCommand.risk, "low");

  const installCommand = assessCommand("npm install left-pad");
  assert.equal(installCommand.allowed, true);
  assert.equal(installCommand.category, "install");
  assert.equal(installCommand.risk, "high");

  const blockedCommand = assessCommand("git reset --hard");
  assert.equal(blockedCommand.allowed, false);
  assert.equal(blockedCommand.risk, "blocked");
});

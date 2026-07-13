import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultAdoneXEvalSuite,
  runEvalSuite,
  summarizeEvalResults
} from "../src/evals/evalHarness";

test("eval harness marks passing responses when required keywords are present", () => {
  const suite = createDefaultAdoneXEvalSuite();
  const results = runEvalSuite(suite, {
    "plan-response": "We inspected the workspace and proposed safe changes.",
    "review-response": "The architecture review identified risks and next steps.",
    "validation-response": "The validation command passed and confirmed the fix."
  });

  assert.equal(results.length, 3);
  assert.equal(results.every((result) => result.passed), true);
  assert.equal(summarizeEvalResults(results).passed, 3);
});

test("eval harness reports missing keywords for weak responses", () => {
  const results = runEvalSuite(
    [
      {
        id: "review-response",
        prompt: "Review the task",
        expectedKeywords: ["risk", "next steps"]
      }
    ],
    {
      "review-response": "The response is vague and does not help."
    }
  );

  assert.equal(results[0].passed, false);
  assert.deepEqual(results[0].missingKeywords, ["risk", "next steps"]);
});

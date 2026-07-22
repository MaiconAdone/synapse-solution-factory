import assert from "node:assert/strict";
import test from "node:test";
import { isSafeIntegrationUrl } from "../src/control/urlPolicy";

test("integration URL policy permits HTTPS and local HTTP", () => {
  assert.equal(isSafeIntegrationUrl("https://api.empresa.com/v1"), true);
  assert.equal(isSafeIntegrationUrl("http://127.0.0.1:8000"), true);
  assert.equal(isSafeIntegrationUrl("http://localhost:11434"), true);
});

test("integration URL policy blocks insecure remote and non-HTTP targets", () => {
  assert.equal(isSafeIntegrationUrl("http://api.empresa.com"), false);
  assert.equal(isSafeIntegrationUrl("file:///etc/passwd"), false);
  assert.equal(isSafeIntegrationUrl("not-a-url"), false);
});

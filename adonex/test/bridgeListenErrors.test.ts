import assert from "node:assert/strict";
import test from "node:test";
import { isAddressInUseError } from "../src/bridge/listenErrors";

test("bridge listen error recognizes an already used local port", () => {
  assert.equal(isAddressInUseError(Object.assign(new Error("busy"), { code: "EADDRINUSE" })), true);
  assert.equal(isAddressInUseError(Object.assign(new Error("denied"), { code: "EACCES" })), false);
});

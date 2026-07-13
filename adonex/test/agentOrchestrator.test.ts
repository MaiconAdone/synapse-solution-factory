import assert from "node:assert/strict";
import test from "node:test";
import { extractPrimaryTask } from "../src/chat/chatRouting";

test("file selection ignores recent chat history and attached references", () => {
  assert.equal(
    extractPrimaryTask(
      [
        "verifique o projeto Synapse se possui erros",
        "",
        "Recent user context:",
        "teste o Ollama local",
        "",
        "Attached workspace references:",
        "scripts/test_local_llm.py"
      ].join("\n")
    ),
    "verifique o projeto Synapse se possui erros"
  );
});

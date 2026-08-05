import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { detectProjectIdentity } from "../src/context/projectIdentity";

function makeTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adonex-project-identity-"));
}

function writeProjectUniverse(root: string, content: unknown): void {
  const configDir = path.join(root, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "project_universe.json"),
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8"
  );
}

test("detects a generated child project from config/project_universe.json", () => {
  const root = makeTempWorkspace();
  writeProjectUniverse(root, {
    project: "especialista_banco",
    universe: "ia",
    creation_rules: { managed_by: "synapse", factory_capable: false }
  });
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isGeneratedChildProject, true);
  assert.equal(identity.name, "especialista_banco");
  assert.equal(identity.universe, "ia");
});

test("falls back to the folder name when project_universe.json is absent", () => {
  const root = makeTempWorkspace();
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isGeneratedChildProject, false);
  assert.equal(identity.name, path.basename(root));
});

test("does not treat a workspace without the synapse creation markers as generated", () => {
  const root = makeTempWorkspace();
  writeProjectUniverse(root, { project: "unrelated", universe: "ml" });
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isGeneratedChildProject, false);
});

test("tolerates malformed project_universe.json without throwing", () => {
  const root = makeTempWorkspace();
  writeProjectUniverse(root, "{ not valid json");
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isGeneratedChildProject, false);
  assert.equal(identity.name, path.basename(root));
});

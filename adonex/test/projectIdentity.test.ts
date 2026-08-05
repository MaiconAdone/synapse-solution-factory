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

function markAsPlatformRepo(root: string): void {
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, "create_ai_project.ps1"), "# stub", "utf8");
}

test("recognizes the Synapse platform repo by its factory script", () => {
  const root = makeTempWorkspace();
  markAsPlatformRepo(root);
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isPlatformRepo, true);
});

test("treats ANY workspace without the factory script as an independent project", () => {
  // Nao exige config/project_universe.json nem qualquer outro marcador de
  // geracao: a auxencia do script da fabrica ja basta. Isso cobre projetos
  // gerados por versoes antigas do gerador, projetos criados manualmente, e
  // qualquer outro repositorio que o usuario abra com o AdoneX instalado.
  const root = makeTempWorkspace();
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isPlatformRepo, false);
  assert.equal(identity.name, path.basename(root));
});

test("uses the real project name from project_universe.json when present", () => {
  const root = makeTempWorkspace();
  writeProjectUniverse(root, { project: "agent_validador", universe: "ia" });
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isPlatformRepo, false);
  assert.equal(identity.name, "agent_validador");
  assert.equal(identity.universe, "ia");
});

test("the factory script marker wins even if project_universe.json is also present", () => {
  const root = makeTempWorkspace();
  markAsPlatformRepo(root);
  writeProjectUniverse(root, { project: "should-not-matter" });
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isPlatformRepo, true);
});

test("tolerates malformed project_universe.json without throwing", () => {
  const root = makeTempWorkspace();
  writeProjectUniverse(root, "{ not valid json");
  const identity = detectProjectIdentity(root);
  assert.equal(identity.isPlatformRepo, false);
  assert.equal(identity.name, path.basename(root));
});

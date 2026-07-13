const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(
    extensionDevelopmentPath,
    "dist",
    "test",
    "extension",
    "index.js"
  );
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "adonex-extension-host-")
  );
  fs.writeFileSync(
    path.join(workspacePath, "package.json"),
    JSON.stringify({ name: "adonex-host-fixture", private: true }, null, 2)
  );

  try {
    await runTests({
      vscodeExecutablePath: findVSCodeExecutable(),
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        ELECTRON_RUN_AS_NODE: undefined
      },
      launchArgs: [
        workspacePath,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes"
      ]
    });
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

function findVSCodeExecutable() {
  if (process.env.VSCODE_EXECUTABLE_PATH) {
    return process.env.VSCODE_EXECUTABLE_PATH;
  }
  if (process.platform === "win32") {
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Programs",
        "Microsoft VS Code",
        "Code.exe"
      ),
      path.join(
        process.env.ProgramFiles || "",
        "Microsoft VS Code",
        "Code.exe"
      )
    ];
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    if (executable) return executable;
  }
  throw new Error(
    "VS Code executable not found. Set VSCODE_EXECUTABLE_PATH before running extension tests."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

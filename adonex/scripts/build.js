const esbuild = require("esbuild");
const path = require("node:path");

async function main() {
  const root = path.resolve(__dirname, "..");
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "src", "extension.ts")],
    bundle: true,
    outfile: path.join(root, "dist", "extension.js"),
    external: ["vscode"],
    alias: {
      openai: path.join(root, "node_modules", "openai", "index.js")
    },
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: false,
    logLevel: "info"
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export interface SecretScanResult {
  safe: boolean;
  matches: string[];
  redacted: string;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Generic secret", pattern: /\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*["']?([^\s"']+)/gi },
  { name: "Private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g }
];

export function scanAndRedactSecrets(content: string): SecretScanResult {
  const matches: string[] = [];
  let redacted = content;

  for (const entry of SECRET_PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(content)) {
      matches.push(entry.name);
      entry.pattern.lastIndex = 0;
      redacted = redacted.replace(entry.pattern, `[REDACTED:${entry.name}]`);
    }
  }

  return {
    safe: matches.length === 0,
    matches: [...new Set(matches)],
    redacted
  };
}

export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").at(-1) ?? "";
  return (
    basename.startsWith(".env") ||
    normalized.includes("/secrets/") ||
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized.includes("credentials")
  );
}

export function isIgnoredContextPath(relativePath: string): boolean {
  const normalized = `/${relativePath.replace(/\\/g, "/").toLowerCase()}/`;
  const ignoredDirectory = [
    "/.adonex/",
    "/.cache/",
    "/.codex/",
    "/.git/",
    "/node_modules/",
    "/dist/",
    "/build/",
    "/.venv/",
    "/__pycache__/",
    "/output/",
    "/artifacts/",
    "/.claude-flow/",
    "/.claude/",
    "/.next/",
    "/coverage/",
    "/.vscode-test/",
    "/logs/",
    "/tmp/"
  ].some((segment) => normalized.includes(segment));
  if (ignoredDirectory) return true;
  return /\.(7z|bin|db|dll|exe|gif|jpe?g|lock|log|map|mp4|parquet|pdf|png|pyc|pyo|sqlite|sst|vsix|wasm|xlsx|zip)$/i.test(
    relativePath
  );
}

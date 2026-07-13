import { executeCapturedCommand } from "../execution/capturedCommand";
import {
  isIgnoredContextPath,
  isSensitivePath,
  scanAndRedactSecrets
} from "../security/secretScanner";

export class GitDiffReader {
  public constructor(
    private readonly root: string,
    private readonly maxDiffChars = 60_000
  ) {}

  public async getChangedFiles(): Promise<string[]> {
    const [status, tracked] = await Promise.all([
      this.run("git status --short"),
      this.run("git diff --name-only")
    ]);
    const statusFiles = status
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    const trackedFiles = tracked.split(/\r?\n/).map((line) => line.trim());
    return [...new Set([...statusFiles, ...trackedFiles])]
      .filter(Boolean)
      .filter(
        (file) => !isSensitivePath(file) && !isIgnoredContextPath(file)
      );
  }

  public async getDiffStat(): Promise<string> {
    return this.run("git diff --stat");
  }

  public async getFullDiffLimited(): Promise<string> {
    const diff = await this.run("git diff --no-ext-diff --unified=3");
    return filterSensitiveDiff(diff).slice(0, this.maxDiffChars);
  }

  public async summarizeDiffForMemory(): Promise<string> {
    const [files, stat, diff] = await Promise.all([
      this.getChangedFiles(),
      this.getDiffStat(),
      this.getFullDiffLimited()
    ]);
    return [
      `Changed files (${files.length}): ${files.join(", ") || "none"}`,
      stat || "No tracked diff stat.",
      diff ? `Limited diff:\n${diff}` : "No tracked diff content."
    ].join("\n\n");
  }

  private async run(command: string): Promise<string> {
    const result = await executeCapturedCommand(command, this.root, 30_000);
    if (result.exitCode !== 0) {
      throw new Error(`Git read failed: ${result.stderr || result.stdout}`);
    }
    return scanAndRedactSecrets(result.stdout).redacted;
  }
}

export function filterSensitiveDiff(diff: string): string {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((section) => {
      const header = section.split(/\r?\n/, 1)[0] ?? "";
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
      return (
        !match ||
        (!isSensitivePath(match[1]) &&
          !isSensitivePath(match[2]) &&
          !isIgnoredContextPath(match[1]) &&
          !isIgnoredContextPath(match[2]))
      );
    })
    .join("");
}

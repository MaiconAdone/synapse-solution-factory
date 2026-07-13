import * as path from "node:path";
import * as vscode from "vscode";
import { estimateTokens } from "../cost/costGuard";
import type { WorkspaceSnapshot } from "../llm/types";
import {
  isIgnoredContextPath,
  isSensitivePath,
  scanAndRedactSecrets
} from "../security/secretScanner";
import {
  detectSynapseProject,
  detectStack,
  rankPathForTask,
  selectContextExcerpt
} from "./workspaceContextCore";
import { formatWorkspaceSnapshot } from "./contextFormatter";
import { buildCodeIntelligence } from "./codeIntelligence";
import { SemanticWorkspaceIndex } from "./semanticWorkspaceIndex";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".ps1",
  ".sql"
]);

export class WorkspaceContext {
  public async collect(task: string, maxContextChars = 42_000): Promise<WorkspaceSnapshot> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("Open a workspace before using AdoneX.");
    }
    const configuration = vscode.workspace.getConfiguration("adonex");
    const ignores = configuration.get<string[]>("workspace.ignorePatterns", []);
    const maxFileChars = configuration.get<number>("memory.maxFileChars", 20_000);
    const exclude = `{${ignores.map((item) => `**/${item}/**`).join(",")}}`;
    const uris = await vscode.workspace.findFiles("**/*", exclude, 800);
    const rankedCandidates = uris
      .map((uri) => ({
        uri,
        relativePath: vscode.workspace.asRelativePath(uri, false),
        ...rankPathForTask(vscode.workspace.asRelativePath(uri, false), task)
      }))
      .filter(({ relativePath }) => {
        const extension = path.extname(relativePath).toLowerCase();
        return (
          [
            "package.json",
            "pyproject.toml",
            "requirements.txt",
            "docker-compose.yml",
            "docker-compose.yaml",
            "pytest.ini",
            "agents.md",
            "claude.md",
            "readme.md",
            "tsconfig.json"
          ].includes(path.basename(relativePath).toLowerCase()) ||
          TEXT_EXTENSIONS.has(extension)
        );
      })
      .filter(
        ({ relativePath }) =>
          !isSensitivePath(relativePath) && !isIgnoredContextPath(relativePath)
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.relativePath.localeCompare(right.relativePath)
      );

    const candidates = await this.semanticRerank(
      folder.uri.fsPath,
      task,
      rankedCandidates,
      configuration
    );

    const structure = candidates.map((item) => item.relativePath).slice(0, 250);
    const relevantFiles: WorkspaceSnapshot["relevantFiles"] = [];
    let currentChars = 0;
    for (const candidate of candidates.slice(0, 40)) {
      if (currentChars >= maxContextChars) break;
      const stat = await vscode.workspace.fs.stat(candidate.uri);
      const bytes = await vscode.workspace.fs.readFile(candidate.uri);
      const content = new TextDecoder().decode(bytes);
      const scan = scanAndRedactSecrets(content);
      const remaining = maxContextChars - currentChars;
      const selected = selectContextExcerpt(
        scan.redacted,
        Math.min(12_000, maxFileChars, remaining),
        stat.size > maxFileChars
      );
      relevantFiles.push({
        path: candidate.relativePath,
        content: selected,
        redacted: !scan.safe,
        score: candidate.score,
        reasons: candidate.reasons
      });
      currentChars += selected.length;
    }

    const combined = relevantFiles.map((file) => file.content).join("\n");
    const stack = detectStack(structure, combined);
    const Synapse = detectSynapseProject(structure, combined);
    return {
      root: folder.uri.fsPath,
      stack,
      synapseDetected: Synapse.detected,
      synapseConfidence: Synapse.confidence,
      synapseSignals: Synapse.signals,
      structure,
      relevantFiles,
      estimatedTokens: estimateTokens(combined),
      codeIntelligence: buildCodeIntelligence(task, structure, relevantFiles)
    };
  }

  public format(snapshot: WorkspaceSnapshot): string {
    return formatWorkspaceSnapshot(snapshot);
  }

  private async semanticRerank<T extends { relativePath: string; score: number; reasons: string[] }>(
    workspaceRoot: string,
    task: string,
    candidates: T[],
    configuration: vscode.WorkspaceConfiguration
  ): Promise<T[]> {
    try {
      return await new SemanticWorkspaceIndex(workspaceRoot).rerank(task, candidates, {
        enabled: configuration.get<boolean>("semanticIndex.enabled", true),
        baseUrl: configuration.get<string>("ollama.baseUrl", "http://127.0.0.1:11434"),
        model: configuration.get<string>("ollama.embeddingModel", "nomic-embed-text:latest"),
        maxCandidates: configuration.get<number>("semanticIndex.maxCandidates", 80),
        timeoutMs: configuration.get<number>("semanticIndex.timeoutSeconds", 8) * 1000
      });
    } catch {
      return candidates;
    }
  }

}

import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type {
  AppliedPatchReceipt,
  GeneratedPatch,
  ProposedFileChange,
  ProposedPatchOperation
} from "../llm/types";
import { requestApproval } from "../security/approvalGate";
import { isSensitivePath } from "../security/secretScanner";
import { applyPatchOperation, createSimpleDiff, resolveSafePath } from "./patchUtils";

export class PatchEngine {
  public async generate(
    changes: ProposedFileChange[] = [],
    operations: ProposedPatchOperation[] = []
  ): Promise<GeneratedPatch> {
    const root = this.workspaceRoot();
    const resolved = await this.resolveOperations(root, operations);
    const allChanges = mergeChanges([...changes, ...resolved]);
    const diffs: string[] = [];
    for (const change of allChanges) {
      assertPatchPathAllowed(change.path);
      const target = resolveSafePath(root, change.path);
      const before = await fs.readFile(target, "utf8").catch(() => "");
      diffs.push(createSimpleDiff(change.path, before, change.content));
    }
    return { changes: allChanges, operations, diff: diffs.join("\n\n") };
  }

  public async preview(patch: GeneratedPatch): Promise<string> {
    const root = this.workspaceRoot();
    const previewRoot = path.join(root, ".adonex", "previews");
    await fs.mkdir(previewRoot, { recursive: true });

    for (const change of patch.changes) {
      assertPatchPathAllowed(change.path);
      const target = resolveSafePath(root, change.path);
      const before = await fs.readFile(target, "utf8").catch(() => "");
      const preview = path.join(previewRoot, change.path);
      const originalPreview = path.join(previewRoot, ".original", change.path);
      await fs.mkdir(path.dirname(preview), { recursive: true });
      await fs.mkdir(path.dirname(originalPreview), { recursive: true });
      await fs.writeFile(originalPreview, before, "utf8");
      await fs.writeFile(preview, change.content, "utf8");
      await vscode.commands.executeCommand(
        "vscode.diff",
        before ? vscode.Uri.file(target) : vscode.Uri.file(originalPreview),
        vscode.Uri.file(preview),
        `AdoneX Preview: ${change.path}`
      );
    }
    return patch.diff;
  }

  public async apply(
    patch: GeneratedPatch,
    createBackup = true,
    requireApproval = true
  ): Promise<AppliedPatchReceipt> {
    const root = this.workspaceRoot();
    const paths = patch.changes.map((change) => change.path).join("\n");
    if (
      requireApproval &&
      !(await requestApproval(
        "Apply AdoneX patch?",
        `The following files will be written:\n${paths}`,
        "Apply Patch"
      ))
    ) {
      throw new Error("Patch application was rejected.");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logRoot = path.join(root, ".adonex", "logs");
    const backupRoot = path.join(root, ".adonex", "backups", timestamp);
    await fs.mkdir(logRoot, { recursive: true });
    const log: string[] = [`AdoneX patch ${new Date().toISOString()}`];
    const receipt: AppliedPatchReceipt = {
      appliedAt: new Date().toISOString(),
      entries: []
    };

    for (const change of patch.changes) {
      assertPatchPathAllowed(change.path);
      const target = resolveSafePath(root, change.path);
      const before = await fs.readFile(target, "utf8").catch(() => undefined);
      receipt.entries.push({
        path: change.path,
        existed: before !== undefined,
        beforeContent: before
      });
      if (createBackup && before) {
        const backup = path.join(backupRoot, change.path);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.writeFile(backup, before, "utf8");
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, change.content, "utf8");
    }
    await fs.writeFile(
      path.join(logRoot, `${timestamp}.patch.log`),
      [log[0], patch.diff].join("\n\n"),
      "utf8"
    );
    return receipt;
  }

  public async revert(receipt: AppliedPatchReceipt): Promise<void> {
    const root = this.workspaceRoot();
    for (const entry of receipt.entries) {
      assertPatchPathAllowed(entry.path);
      const target = resolveSafePath(root, entry.path);
      if (!entry.existed) {
        await fs.rm(target, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.beforeContent ?? "", "utf8");
    }
  }

  private workspaceRoot(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Open a workspace before applying a patch.");
    return root;
  }

  private async resolveOperations(
    root: string,
    operations: ProposedPatchOperation[]
  ): Promise<ProposedFileChange[]> {
    const currentByPath = new Map<string, string>();
    const changed = new Map<string, string>();
    for (const operation of operations) {
      assertPatchPathAllowed(operation.path);
      const target = resolveSafePath(root, operation.path);
      const current =
        changed.get(operation.path) ??
        currentByPath.get(operation.path) ??
        (await fs.readFile(target, "utf8").catch(() => ""));
      currentByPath.set(operation.path, current);
      changed.set(operation.path, applyPatchOperation(current, operation));
    }
    return [...changed.entries()].map(([filePath, content]) => ({
      path: filePath,
      content
    }));
  }
}

function assertPatchPathAllowed(relativePath: string): void {
  if (isSensitivePath(relativePath)) {
    throw new Error(`AdoneX refuses to read or write sensitive path: ${relativePath}`);
  }
}

function mergeChanges(changes: ProposedFileChange[]): ProposedFileChange[] {
  const byPath = new Map<string, ProposedFileChange>();
  for (const change of changes) byPath.set(change.path, change);
  return [...byPath.values()];
}

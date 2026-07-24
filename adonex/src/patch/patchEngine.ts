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
import {
  applyOperationsToContents,
  createSimpleDiff,
  detectHighRiskRewrites,
  resolveSafePath
} from "./patchUtils";

export interface PatchGenerateOptions {
  /**
   * Quantidade de changes/operations malformadas descartadas pelo parser da
   * proposta. Vira warning no patch para o usuario saber que a proposta
   * aplicada e parcial em relacao ao que o modelo tentou enviar.
   */
  droppedOperations?: number;
}

export class PatchEngine {
  public async generate(
    changes: ProposedFileChange[] = [],
    operations: ProposedPatchOperation[] = [],
    options: PatchGenerateOptions = {}
  ): Promise<GeneratedPatch> {
    const root = this.workspaceRoot();
    const resolved = await this.resolveOperations(root, operations);
    const allChanges = mergeChanges([...changes, ...resolved]);
    const diffs: string[] = [];
    const currentByPath = new Map<string, string>();
    for (const change of allChanges) {
      assertPatchPathAllowed(change.path);
      const target = resolveSafePath(root, change.path);
      const before = await fs.readFile(target, "utf8").catch(() => "");
      if (before) currentByPath.set(change.path, before);
      diffs.push(createSimpleDiff(change.path, before, change.content));
    }
    const warnings: string[] = [];
    if (options.droppedOperations) {
      warnings.push(
        `${options.droppedOperations} entrada(s) malformada(s) do JSON do modelo foram descartadas; o patch aplica apenas as entradas validas.`
      );
    }
    // Guarda contra rewrite alucinado: o modelo pode ter visto so um excerpt
    // do arquivo e devolvido um "arquivo completo" que apaga codigo nunca visto.
    const highRiskRewrites = detectHighRiskRewrites(allChanges, currentByPath);
    return {
      changes: allChanges,
      operations,
      diff: diffs.join("\n\n"),
      ...(warnings.length ? { warnings } : {}),
      ...(highRiskRewrites.length ? { highRiskRewrites } : {})
    };
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
    const highRisk = patch.highRiskRewrites ?? [];
    // Rewrites de alto risco nao sao bloqueados, mas exigem ciencia explicita:
    // no fluxo interativo o aviso entra no prompt de aprovacao; no fluxo sem
    // prompt (composer/autonomo) fica registrado no log do patch.
    const riskNote = highRisk.length
      ? `\n\nHIGH-RISK REWRITE: ${highRisk
          .map(
            (rewrite) =>
              `${rewrite.path} removes ~${rewrite.removedPercent}% of the existing lines (${rewrite.beforeLines} -> ${rewrite.afterLines})`
          )
          .join("; ")}. Confirm only if the model saw the full file.`
      : "";
    if (
      requireApproval &&
      !(await requestApproval(
        "Apply AdoneX patch?",
        `The following files will be written:\n${paths}${riskNote}`,
        "Apply Patch"
      ))
    ) {
      throw new Error("Patch application was rejected.");
    }

    // Edits cirurgicos: reaplica as operations contra o estado ATUAL do disco.
    // Edicoes manuais feitas entre a proposta e o Apply sao preservadas; se o
    // anchor/expected nao existir mais, o conflito aborta antes de escrever.
    const freshContentByPath = await this.resolveOperationsAtApplyTime(root, patch);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logRoot = path.join(root, ".adonex", "logs");
    const backupRoot = path.join(root, ".adonex", "backups", timestamp);
    await fs.mkdir(logRoot, { recursive: true });
    const log: string[] = [`AdoneX patch ${new Date().toISOString()}`];
    for (const warning of patch.warnings ?? []) {
      log.push(`WARNING: ${warning}`);
    }
    for (const rewrite of highRisk) {
      log.push(
        `WARNING: high-risk rewrite applied to ${rewrite.path} (~${rewrite.removedPercent}% of existing lines removed).`
      );
    }
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
      await fs.writeFile(
        target,
        freshContentByPath.get(change.path) ?? change.content,
        "utf8"
      );
    }
    await fs.writeFile(
      path.join(logRoot, `${timestamp}.patch.log`),
      [...log, patch.diff].join("\n\n"),
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
    const changed = applyOperationsToContents(
      operations,
      await this.readCurrentContents(root, operations)
    );
    return [...changed.entries()].map(([filePath, content]) => ({
      path: filePath,
      content
    }));
  }

  /**
   * Reaplica no momento do apply as operations dos arquivos presentes no patch,
   * lendo o conteudo atual do disco. Retorna o conteudo final por path; paths
   * sem operations continuam usando o conteudo completo proposto.
   */
  private async resolveOperationsAtApplyTime(
    root: string,
    patch: GeneratedPatch
  ): Promise<ReadonlyMap<string, string>> {
    const selectedPaths = new Set(patch.changes.map((change) => change.path));
    const operations = (patch.operations ?? []).filter((operation) =>
      selectedPaths.has(operation.path)
    );
    if (!operations.length) return new Map();
    return applyOperationsToContents(
      operations,
      await this.readCurrentContents(root, operations)
    );
  }

  private async readCurrentContents(
    root: string,
    operations: readonly ProposedPatchOperation[]
  ): Promise<Map<string, string>> {
    const currentByPath = new Map<string, string>();
    for (const operation of operations) {
      if (currentByPath.has(operation.path)) continue;
      assertPatchPathAllowed(operation.path);
      const target = resolveSafePath(root, operation.path);
      currentByPath.set(operation.path, await fs.readFile(target, "utf8").catch(() => ""));
    }
    return currentByPath;
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

import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import type { AgentOrchestrator } from "../agent/agentOrchestrator";
import type { PatchEngine } from "../patch/patchEngine";
import { resolveSafePath } from "../patch/patchUtils";
import { isSensitivePath, scanAndRedactSecrets } from "../security/secretScanner";
import type {
  AgentMode,
  AppliedPatchReceipt,
  GeneratedPatch,
  ImplementationProposal
} from "../llm/types";
import {
  buildComposerFiles,
  selectedChanges,
  type ComposerProposalView
} from "./composerModel";

export interface ComposerGenerateResult {
  view: ComposerProposalView;
  responseText: string;
  model: string;
}

export interface ComposerApplyResult {
  receipt: AppliedPatchReceipt;
  appliedPaths: string[];
  commands: string[];
}

/**
 * Sessao do Composer multi-arquivo. Reaproveita o orquestrador (plan/execute) e
 * o motor de patch (generate/preview/apply/revert) ja existentes, adicionando a
 * camada de revisao por arquivo: selecao, diff por arquivo e aplicacao seletiva.
 */
export class ComposerSession {
  private history: string[] = [];
  private proposal?: ImplementationProposal;
  private patch?: GeneratedPatch;
  private selection = new Set<string>();
  private root?: string;
  private lastReceipt?: AppliedPatchReceipt;

  public constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly patchEngine: PatchEngine
  ) {}

  public hasProposal(): boolean {
    return Boolean(this.patch?.changes.length);
  }

  public reset(): void {
    this.history = [];
    this.proposal = undefined;
    this.patch = undefined;
    this.selection = new Set();
    this.lastReceipt = undefined;
  }

  public async generate(
    task: string,
    mode: AgentMode,
    signal?: AbortSignal,
    onProgress?: (text: string) => void
  ): Promise<ComposerGenerateResult> {
    const safeTask = scanAndRedactSecrets(task).redacted.trim();
    if (!safeTask) throw new Error("Descreva a solucao ou feature antes de gerar.");
    this.history = [safeTask];
    return this.runGeneration(safeTask, mode, signal, onProgress);
  }

  public async refine(
    instruction: string,
    mode: AgentMode,
    signal?: AbortSignal,
    onProgress?: (text: string) => void
  ): Promise<ComposerGenerateResult> {
    if (!this.history.length) {
      return this.generate(instruction, mode, signal, onProgress);
    }
    const safe = scanAndRedactSecrets(instruction).redacted.trim();
    if (!safe) throw new Error("Descreva o ajuste antes de refinar a proposta.");
    this.history.push(safe);
    const combined = [
      "Objetivo original do Composer:",
      this.history[0],
      "",
      "Ajustes solicitados em sequencia:",
      ...this.history.slice(1).map((item, index) => `${index + 1}. ${item}`),
      "",
      "Gere a proposta multi-arquivo consolidada considerando todos os ajustes."
    ].join("\n");
    return this.runGeneration(combined, mode, signal, onProgress);
  }

  private async runGeneration(
    task: string,
    mode: AgentMode,
    signal?: AbortSignal,
    onProgress?: (text: string) => void
  ): Promise<ComposerGenerateResult> {
    const previousSelection = new Set(this.selection);
    onProgress?.("Planejando a mudanca multi-arquivo...");
    const { plan, snapshot } = await this.orchestrator.createPlan(
      task,
      "implement",
      mode
    );
    this.root = snapshot.root;
    const execution = await this.orchestrator.executeApproved(
      task,
      "implement",
      mode,
      plan,
      snapshot,
      { signal, onProgress }
    );
    if (!execution.proposal || !execution.proposal.changes.length) {
      this.proposal = execution.proposal;
      this.patch = undefined;
      throw new Error(
        "O modelo local nao propos mudancas de arquivo. Detalhe melhor o objetivo ou os arquivos esperados e tente novamente."
      );
    }
    this.proposal = execution.proposal;
    this.patch = await this.patchEngine.generate(
      execution.proposal.changes,
      execution.proposal.operations
    );
    const befores = await this.readBefores(this.patch);
    const files = buildComposerFiles(
      this.patch.changes,
      befores,
      previousSelection.size ? previousSelection : undefined
    );
    // Selecao padrao: tudo marcado na primeira geracao; preserva escolhas ao refinar.
    this.selection = new Set(files.filter((file) => file.selected).map((file) => file.path));
    return {
      view: {
        summary: execution.proposal.summary,
        files,
        commands: execution.proposal.commands ?? []
      },
      responseText: execution.response.text,
      model: `${execution.response.provider}/${execution.response.model}`
    };
  }

  public toggleFile(path: string, selected: boolean): void {
    if (selected) this.selection.add(path);
    else this.selection.delete(path);
  }

  public setAllSelected(selected: boolean): void {
    if (!this.patch) return;
    this.selection = selected
      ? new Set(this.patch.changes.map((change) => change.path))
      : new Set();
  }

  public selectedCount(): number {
    return this.selection.size;
  }

  public async openDiff(path: string): Promise<void> {
    const change = this.patch?.changes.find((item) => item.path === path);
    if (!change) throw new Error(`Sem mudanca proposta para ${path}.`);
    await this.patchEngine.preview({ diff: "", changes: [change], operations: [] });
  }

  public async apply(requireApproval: boolean): Promise<ComposerApplyResult> {
    if (!this.patch?.changes.length) throw new Error("Nao ha proposta do Composer para aplicar.");
    const changes = selectedChanges(this.patch.changes, this.selection);
    if (!changes.length) throw new Error("Selecione ao menos um arquivo para aplicar.");
    const subset: GeneratedPatch = { diff: this.patch.diff, changes, operations: [] };
    const receipt = await this.patchEngine.apply(subset, true, requireApproval);
    this.lastReceipt = receipt;
    return {
      receipt,
      appliedPaths: changes.map((change) => change.path),
      commands: this.proposal?.commands ?? []
    };
  }

  public async undo(): Promise<void> {
    if (!this.lastReceipt) throw new Error("Nenhuma aplicacao do Composer para reverter.");
    await this.patchEngine.revert(this.lastReceipt);
    this.lastReceipt = undefined;
  }

  private async readBefores(patch: GeneratedPatch): Promise<Map<string, string | undefined>> {
    const root = this.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const befores = new Map<string, string | undefined>();
    if (!root) return befores;
    for (const change of patch.changes) {
      if (isSensitivePath(change.path)) {
        befores.set(change.path, undefined);
        continue;
      }
      try {
        const target = resolveSafePath(root, change.path);
        befores.set(change.path, await fs.readFile(target, "utf8"));
      } catch {
        befores.set(change.path, undefined);
      }
    }
    return befores;
  }
}

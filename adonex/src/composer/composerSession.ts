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
  ImplementationProposal,
  TaskPlan,
  WorkspaceSnapshot
} from "../llm/types";
import {
  buildComposerFiles,
  refinementMentionsUnknownFile,
  selectedChanges,
  type ComposerProposalView
} from "./composerModel";
import { detectTestWeakening } from "./validationLoop";
import { formatJudgeWarning } from "../agent/judgeAgent";

export interface ComposerGenerateResult {
  view: ComposerProposalView;
  responseText: string;
  model: string;
  /** Avisos nao fatais da geracao (ex.: entradas malformadas descartadas no parse). */
  warnings?: string[];
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
  // Contexto da ultima geracao, para o ciclo validar -> corrigir reutilizar o
  // mesmo plano/snapshot sem recoletar workspace inteiro.
  private lastMode?: AgentMode;
  private lastPlan?: TaskPlan;
  private lastSnapshot?: WorkspaceSnapshot;

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
    this.lastMode = undefined;
    this.lastPlan = undefined;
    this.lastSnapshot = undefined;
  }

  public getRoot(): string | undefined {
    return this.root;
  }

  public isSynapseWorkspace(): boolean {
    return Boolean(this.lastSnapshot?.synapseDetected);
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
    // Reaproveita o snapshot da geracao anterior (evita recoletar o
    // workspace inteiro, incluindo reranking semantico via Ollama) quando o
    // modo nao mudou e o ajuste nao parece citar um arquivo novo.
    const reuseContext =
      this.lastMode === mode &&
      Boolean(this.lastSnapshot) &&
      !refinementMentionsUnknownFile(safe, [
        ...(this.lastSnapshot?.structure ?? []),
        ...(this.lastSnapshot?.relevantFiles.map((file) => file.path) ?? [])
      ]);
    return this.runGeneration(combined, mode, signal, onProgress, { reuseContext });
  }

  private async runGeneration(
    task: string,
    mode: AgentMode,
    signal?: AbortSignal,
    onProgress?: (text: string) => void,
    options: { reuseContext?: boolean } = {}
  ): Promise<ComposerGenerateResult> {
    const previousSelection = new Set(this.selection);
    let plan: TaskPlan;
    let snapshot: WorkspaceSnapshot;
    if (options.reuseContext && this.lastPlan && this.lastSnapshot) {
      onProgress?.("Reaproveitando o contexto da geracao anterior (sem reescanear o workspace)...");
      plan = this.lastPlan;
      snapshot = this.lastSnapshot;
    } else {
      onProgress?.("Planejando a mudanca multi-arquivo...");
      ({ plan, snapshot } = await this.orchestrator.createPlan(task, "implement", mode));
    }
    this.root = snapshot.root;
    this.lastMode = mode;
    this.lastPlan = plan;
    this.lastSnapshot = snapshot;
    const execution = await this.orchestrator.executeApproved(
      task,
      "implement",
      mode,
      plan,
      snapshot,
      { signal, onProgress }
    );
    if (
      !execution.proposal ||
      (!execution.proposal.changes.length && !execution.proposal.operations?.length)
    ) {
      this.proposal = execution.proposal;
      this.patch = undefined;
      throw new Error(
        "O modelo local nao propos mudancas de arquivo. Detalhe melhor o objetivo ou os arquivos esperados e tente novamente."
      );
    }
    this.proposal = execution.proposal;
    this.patch = await this.patchEngine.generate(
      execution.proposal.changes,
      execution.proposal.operations,
      { droppedOperations: execution.proposal.droppedOperations }
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
      model: `${execution.response.provider}/${execution.response.model}`,
      ...(this.patch.warnings?.length ? { warnings: this.patch.warnings } : {})
    };
  }

  /**
   * Ciclo editar -> validar -> corrigir: gera uma unica correcao governada a
   * partir da saida capturada do comando que falhou, reutilizando o plano e o
   * snapshot da geracao original. A aplicacao segue o mesmo fluxo de revisao.
   */
  public async repair(
    capturedFailure: string,
    signal?: AbortSignal,
    onProgress?: (text: string) => void
  ): Promise<ComposerGenerateResult> {
    if (!this.history.length || !this.lastPlan || !this.lastSnapshot || !this.lastMode) {
      throw new Error("Nao ha geracao do Composer para corrigir.");
    }
    onProgress?.("Gerando correcao a partir da falha capturada...");
    const execution = await this.orchestrator.proposeFix(
      this.history[0],
      capturedFailure,
      this.lastMode,
      this.lastPlan,
      this.lastSnapshot,
      { signal, onProgress }
    );
    if (
      !execution.proposal ||
      (!execution.proposal.changes.length && !execution.proposal.operations?.length)
    ) {
      throw new Error("O modelo local nao propos uma correcao para a falha capturada.");
    }
    this.proposal = execution.proposal;
    this.patch = await this.patchEngine.generate(
      execution.proposal.changes,
      execution.proposal.operations,
      { droppedOperations: execution.proposal.droppedOperations }
    );
    const befores = await this.readBefores(this.patch);
    const files = buildComposerFiles(this.patch.changes, befores);
    // Correcao e minima por contrato: todos os arquivos entram selecionados.
    this.selection = new Set(files.map((file) => file.path));
    const judgeWarnings = await this.judgeTestWeakening(
      capturedFailure,
      this.patch.changes,
      befores,
      signal
    );
    return {
      view: {
        summary: execution.proposal.summary,
        files,
        commands: execution.proposal.commands ?? []
      },
      responseText: execution.response.text,
      model: `${execution.response.provider}/${execution.response.model}`,
      ...(this.patch.warnings?.length || judgeWarnings.length
        ? { warnings: [...(this.patch.warnings ?? []), ...judgeWarnings] }
        : {})
    };
  }

  /**
   * Metodo fable (fable-judge): checagem deterministica primeiro
   * (`detectTestWeakening`, sem custo de LLM); so escala para o judge local
   * (uma chamada extra ao modelo rapido) quando ela ja acusa algo suspeito
   * num arquivo de teste tocado pela correcao.
   */
  private async judgeTestWeakening(
    capturedFailure: string,
    changes: readonly { path: string; content: string }[],
    befores: Map<string, string | undefined>,
    signal?: AbortSignal
  ): Promise<string[]> {
    const findings = changes.flatMap((change) =>
      detectTestWeakening(change.path, befores.get(change.path), change.content)
    );
    if (!findings.length) return [];
    const testPaths = new Set(findings.map((finding) => finding.path));
    const testDiffs = changes
      .filter((change) => testPaths.has(change.path))
      .map((change) => ({ path: change.path, before: befores.get(change.path), after: change.content }));
    const productionDiffs = changes
      .filter((change) => !testPaths.has(change.path))
      .map((change) => ({ path: change.path, before: befores.get(change.path), after: change.content }));
    const verdict = await this.orchestrator.runTestWeakeningJudge(
      capturedFailure,
      testDiffs,
      productionDiffs,
      signal
    );
    if (verdict.verdict === "fixes_root_cause") return [];
    return findings.map((finding) => formatJudgeWarning(finding, verdict));
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

  /** Paths atualmente selecionados para aplicacao (usado no diff de diagnostics). */
  public selectedPaths(): string[] {
    return [...this.selection];
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
    // Preserva as operations incrementais dos arquivos selecionados: o motor de
    // patch as reaplica contra o disco atual, protegendo edicoes simultaneas.
    const operations = (this.patch.operations ?? []).filter((operation) =>
      this.selection.has(operation.path)
    );
    const subset: GeneratedPatch = {
      diff: this.patch.diff,
      changes,
      operations,
      // Propaga avisos e rewrites de alto risco (dos arquivos selecionados)
      // para o apply sinalizar no prompt de aprovacao e no log.
      ...(this.patch.warnings?.length ? { warnings: this.patch.warnings } : {}),
      ...(this.patch.highRiskRewrites?.length
        ? {
            highRiskRewrites: this.patch.highRiskRewrites.filter((rewrite) =>
              this.selection.has(rewrite.path)
            )
          }
        : {})
    };
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

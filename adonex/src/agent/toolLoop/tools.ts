import { promises as fs } from "node:fs";
import type { CommandResult, ProposedPatchOperation, WorkspaceSnapshot } from "../../llm/types";
import { applyPatchOperation, resolveSafePath } from "../../patch/patchUtils";
import { normalizeOperation } from "../proposalParser";
import {
  isIgnoredContextPath,
  isSensitivePath,
  scanAndRedactSecrets
} from "../../security/secretScanner";
import {
  SemanticWorkspaceIndex,
  type SemanticIndexOptions
} from "../../context/semanticWorkspaceIndex";
import type { ToolLoopTool, ToolLoopToolName } from "./types";

/**
 * Dependencias do Tool Loop mantidas fora de vscode: quem instancia isto
 * (AgentOrchestrator, ja acoplado ao Extension Host) injeta `runCommand` em
 * vez de este modulo importar CommandRunner diretamente. Mantem tools.ts e
 * loop.ts testaveis com `node --test`, sem mock de `vscode`.
 */
export interface ToolLoopToolsOptions {
  root: string;
  snapshot: WorkspaceSnapshot;
  maxReadChars: number;
  maxSearchResults: number;
  semantic: SemanticIndexOptions;
  runCommand: (command: string) => Promise<CommandResult>;
}

export interface ToolLoopRuntime {
  tools: Map<ToolLoopToolName, ToolLoopTool>;
  virtualFiles: Map<string, string>;
  operations: ProposedPatchOperation[];
  commandResults: CommandResult[];
}

export function createToolLoopTools(options: ToolLoopToolsOptions): ToolLoopRuntime {
  const virtualFiles = new Map<string, string>(
    options.snapshot.relevantFiles.map((file) => [file.path, file.content])
  );
  const operations: ProposedPatchOperation[] = [];
  const commandResults: CommandResult[] = [];

  const readCurrent = async (relativePath: string): Promise<string> => {
    if (virtualFiles.has(relativePath)) return virtualFiles.get(relativePath) ?? "";
    const target = resolveSafePath(options.root, relativePath);
    return fs.readFile(target, "utf8").catch(() => "");
  };

  const tools = new Map<ToolLoopToolName, ToolLoopTool>();

  tools.set("read_file", {
    name: "read_file",
    description:
      "Le o conteudo atual de um arquivo do workspace (inclui edicoes virtuais ja feitas neste loop).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    execute: async (input) => {
      const { path: relativePath } = (input ?? {}) as { path?: string };
      if (!relativePath) return { ok: false, summary: "Faltou o parametro path." };
      if (isSensitivePath(relativePath)) {
        return { ok: false, summary: `Caminho sensivel recusado: ${relativePath}` };
      }
      try {
        const content = await readCurrent(relativePath);
        const redacted = scanAndRedactSecrets(content).redacted;
        const bounded =
          redacted.length > options.maxReadChars
            ? `${redacted.slice(0, options.maxReadChars)}\n[conteudo truncado pelo AdoneX]`
            : redacted;
        return {
          ok: true,
          summary: bounded
            ? `${bounded.length} caractere(s) lidos de ${relativePath}`
            : `${relativePath} esta vazio ou nao existe ainda`,
          detail: bounded
        };
      } catch (error) {
        return { ok: false, summary: describeError(error) };
      }
    }
  });

  tools.set("list_files", {
    name: "list_files",
    description: "Lista a estrutura do workspace ja coletada (limitada e sem caminhos sensiveis).",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const files = options.snapshot.structure.filter((path) => !isIgnoredContextPath(path));
      return {
        ok: true,
        summary: `${files.length} arquivo(s) na estrutura do workspace`,
        detail: files.slice(0, 400).join("\n")
      };
    }
  });

  tools.set("search_files", {
    name: "search_files",
    description:
      "Busca arquivos por termo/caminho, com reranking semantico local (embeddings) quando disponivel.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    execute: async (input) => {
      const { query } = (input ?? {}) as { query?: string };
      const term = query?.trim();
      if (!term) return { ok: false, summary: "Faltou o parametro query." };
      const needle = term.toLowerCase();
      const candidates = options.snapshot.structure
        .filter((path) => !isIgnoredContextPath(path))
        .map((relativePath) => ({
          relativePath,
          score: relativePath.toLowerCase().includes(needle) ? 5 : 0,
          reasons: relativePath.toLowerCase().includes(needle) ? ["name-match"] : []
        }));
      let ranked = candidates;
      try {
        ranked = await new SemanticWorkspaceIndex(options.root).rerank(
          term,
          candidates,
          options.semantic
        );
      } catch {
        // Busca semantica e best-effort: falha nunca bloqueia a busca por nome.
      }
      const top = ranked
        .filter((candidate) => candidate.score > 0)
        .slice(0, options.maxSearchResults)
        .map((candidate) => candidate.relativePath);
      return {
        ok: true,
        summary: `${top.length} arquivo(s) encontrados para "${term}"`,
        detail: top.join("\n")
      };
    }
  });

  tools.set("edit_file", {
    name: "edit_file",
    description:
      "Aplica UMA operacao cirurgica (replace/insert_before/insert_after/append/delete) a um arquivo. " +
      "Fica em estado virtual nesta sessao; so grava no disco apos aprovacao do usuario no preview final.",
    parameters: {
      type: "object",
      properties: { operation: { type: "object" } },
      required: ["operation"]
    },
    execute: async (input) => {
      const { operation: rawOperation } = (input ?? {}) as { operation?: unknown };
      const operation = normalizeOperation(rawOperation);
      if (!operation) {
        return {
          ok: false,
          summary:
            "Operacao invalida. Use {type, path, expected|anchor, replacement|content} conforme o tipo."
        };
      }
      if (isSensitivePath(operation.path)) {
        return { ok: false, summary: `Caminho sensivel recusado: ${operation.path}` };
      }
      try {
        const current = await readCurrent(operation.path);
        const next = applyPatchOperation(current, operation);
        virtualFiles.set(operation.path, next);
        operations.push(operation);
        return {
          ok: true,
          summary: `${operation.type} aplicado (em memoria) a ${operation.path}`
        };
      } catch (error) {
        return { ok: false, summary: describeError(error) };
      }
    }
  });

  tools.set("run_command", {
    name: "run_command",
    description:
      "Executa um comando no workspace com captura real de stdout/stderr (ex.: rodar testes). Exige aprovacao do usuario.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"]
    },
    execute: async (input) => {
      const { command } = (input ?? {}) as { command?: string };
      if (!command?.trim()) return { ok: false, summary: "Faltou o parametro command." };
      try {
        const result = await options.runCommand(command);
        commandResults.push(result);
        const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-2_000);
        return {
          ok: result.exitCode === 0 && !result.timedOut,
          summary: `exit ${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
          detail: tail
        };
      } catch (error) {
        return { ok: false, summary: describeError(error) };
      }
    }
  });

  return { tools, virtualFiles, operations, commandResults };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

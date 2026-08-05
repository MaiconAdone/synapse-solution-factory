import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { cosineSimilarity, OllamaEmbeddingClient } from "../llm/ollamaEmbeddingClient";

export interface SemanticIndexCandidate {
  relativePath: string;
  score: number;
  reasons: string[];
}

export interface SemanticIndexOptions {
  baseUrl: string;
  model: string;
  enabled: boolean;
  maxCandidates: number;
  timeoutMs: number;
}

interface SemanticIndexEntry {
  path: string;
  hash: string;
  embedding: number[];
}

interface SemanticIndexFile {
  version: 1;
  model: string;
  updatedAt: string;
  entries: SemanticIndexEntry[];
}

export class SemanticWorkspaceIndex {
  public constructor(private readonly workspaceRoot: string) {}

  public async rerank<T extends SemanticIndexCandidate>(
    task: string,
    candidates: T[],
    options: SemanticIndexOptions
  ): Promise<T[]> {
    if (!options.enabled || !task.trim() || !candidates.length) return candidates;
    const { client, byPath, selected } = await this.ensureFresh(candidates, options);

    const [queryEmbedding] = await client.embed([task]);
    const semanticScores = new Map<string, number>();
    for (const candidate of selected) {
      const entry = byPath.get(candidate.relativePath);
      if (entry) semanticScores.set(candidate.relativePath, cosineSimilarity(queryEmbedding, entry.embedding));
    }

    return candidates
      .map((candidate) => {
        const semanticScore = semanticScores.get(candidate.relativePath) ?? 0;
        const semanticBoost = Math.max(0, semanticScore) * 8;
        return {
          candidate,
          score: candidate.score + semanticBoost,
          reasons: semanticBoost > 0.5 ? [...candidate.reasons, "semantic-local-index"] : candidate.reasons
        };
      })
      .sort((left, right) => right.score - left.score || left.candidate.relativePath.localeCompare(right.candidate.relativePath))
      .map(({ candidate, score, reasons }) => ({ ...candidate, score, reasons: [...new Set(reasons)] }));
  }

  /**
   * Constroi/atualiza o cache de embeddings para os candidatos, sem query
   * associada. Usado pelo comando "AdoneX: Rebuild Semantic Index" para
   * aquecer o indice antes da primeira tarefa real do usuario. Ao contrario
   * de rerank(), nao exige task e nao verifica options.enabled: quem chama
   * warmIndex ja fez o pedido explicito (o proprio comando).
   */
  public async warmIndex(
    candidates: SemanticIndexCandidate[],
    options: SemanticIndexOptions
  ): Promise<{ embedded: number; total: number; skipped: number }> {
    if (!candidates.length) return { embedded: 0, total: 0, skipped: 0 };
    const { selected, embedded } = await this.ensureFresh(candidates, options);
    return { embedded, total: selected.length, skipped: selected.length - embedded };
  }

  /**
   * Garante que o cache local tenha embeddings atualizados para os
   * candidatos selecionados: carrega o cache, reincorpora so os que mudaram
   * de conteudo (por hash) e salva. Compartilhado por rerank() (que ainda
   * embute a query por cima) e warmIndex() (que para por aqui).
   */
  private async ensureFresh<T extends SemanticIndexCandidate>(
    candidates: T[],
    options: SemanticIndexOptions
  ): Promise<{
    client: OllamaEmbeddingClient;
    byPath: Map<string, SemanticIndexEntry>;
    selected: T[];
    embedded: number;
  }> {
    const selected = candidates.slice(0, Math.max(1, options.maxCandidates));
    const client = new OllamaEmbeddingClient({
      baseUrl: options.baseUrl,
      model: options.model,
      timeoutMs: options.timeoutMs
    });
    const index = await this.load(options.model);
    const byPath = new Map(index.entries.map((entry) => [entry.path, entry]));
    const stale = selected.filter((candidate) => {
      const text = descriptorFor(candidate);
      return byPath.get(candidate.relativePath)?.hash !== hashText(text);
    });
    if (stale.length) {
      const embeddings = await client.embed(stale.map(descriptorFor));
      stale.forEach((candidate, indexInStale) => {
        byPath.set(candidate.relativePath, {
          path: candidate.relativePath,
          hash: hashText(descriptorFor(candidate)),
          embedding: embeddings[indexInStale]
        });
      });
      await this.save(options.model, [...byPath.values()]);
    }
    return { client, byPath, selected, embedded: stale.length };
  }

  private async load(model: string): Promise<SemanticIndexFile> {
    try {
      const raw = await fs.readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(raw) as SemanticIndexFile;
      if (parsed.version === 1 && parsed.model === model && Array.isArray(parsed.entries)) return parsed;
    } catch {
      // Missing or invalid cache is rebuilt lazily.
    }
    return { version: 1, model, updatedAt: new Date().toISOString(), entries: [] };
  }

  private async save(model: string, entries: SemanticIndexEntry[]): Promise<void> {
    const file: SemanticIndexFile = {
      version: 1,
      model,
      updatedAt: new Date().toISOString(),
      entries
    };
    await fs.mkdir(path.dirname(this.indexPath()), { recursive: true });
    await fs.writeFile(this.indexPath(), JSON.stringify(file, null, 2), "utf8");
  }

  private indexPath(): string {
    return path.join(this.workspaceRoot, ".adonex", "index", "semantic-index.json");
  }
}

function descriptorFor(candidate: SemanticIndexCandidate): string {
  return [
    `path: ${candidate.relativePath}`,
    `segments: ${candidate.relativePath.replace(/[\\/_.-]+/g, " ")}`,
    `signals: ${candidate.reasons.join(", ") || "none"}`
  ].join("\n");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
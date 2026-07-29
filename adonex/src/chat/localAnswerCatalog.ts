import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface LocalAnswerCatalogEntry {
  id: string;
  question: string;
  normalizedQuestion: string;
  answer: string;
  provider: "ollama";
  model: string;
  source: "model_generated";
  createdAt: string;
  updatedAt: string;
  hits: number;
}

interface LocalAnswerCatalogDocument {
  version: 1;
  entries: LocalAnswerCatalogEntry[];
}

export interface CatalogMatch {
  entry: LocalAnswerCatalogEntry;
  similarity: number;
  exact: boolean;
}

const CATALOG_PATH = path.join(".adonex", "cache", "local-answer-catalog.json");
const MAX_ENTRIES = 200;
const SIMILARITY_THRESHOLD = 0.9;

export class LocalAnswerCatalog {
  public constructor(private readonly root: string) {}

  public async find(question: string): Promise<CatalogMatch | undefined> {
    if (!isCatalogEligibleQuestion(question)) return undefined;
    const document = await this.load();
    const normalized = normalizeQuestion(question);
    let best: CatalogMatch | undefined;
    for (const entry of document.entries) {
      const exact = entry.normalizedQuestion === normalized;
      const similarity = exact
        ? 1
        : questionSimilarity(normalized, entry.normalizedQuestion);
      if (!best || similarity > best.similarity) {
        best = { entry, similarity, exact };
      }
    }
    if (!best || (!best.exact && best.similarity < SIMILARITY_THRESHOLD)) {
      return undefined;
    }
    best.entry.hits += 1;
    best.entry.updatedAt = new Date().toISOString();
    await this.save(document);
    return best;
  }

  public async record(question: string, answer: string, provider: string, model: string): Promise<void> {
    if (provider !== "ollama") return;
    if (!isCatalogEligibleQuestion(question) || !isCatalogEligibleAnswer(answer)) return;
    const document = await this.load();
    const normalized = normalizeQuestion(question);
    const existing = document.entries.find((entry) => entry.normalizedQuestion === normalized);
    const now = new Date().toISOString();
    if (existing) {
      existing.question = question;
      existing.answer = answer;
      existing.model = model;
      existing.updatedAt = now;
      await this.save(document);
      return;
    }
    document.entries.unshift({
      id: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
      question,
      normalizedQuestion: normalized,
      answer,
      provider: "ollama",
      model,
      source: "model_generated",
      createdAt: now,
      updatedAt: now,
      hits: 0
    });
    document.entries = document.entries.slice(0, MAX_ENTRIES);
    await this.save(document);
  }

  private async load(): Promise<LocalAnswerCatalogDocument> {
    try {
      const raw = await fs.readFile(path.join(this.root, CATALOG_PATH), "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalAnswerCatalogDocument>;
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return { version: 1, entries: parsed.entries };
      }
    } catch {
      // Missing or malformed catalog: start fresh.
    }
    return { version: 1, entries: [] };
  }

  private async save(document: LocalAnswerCatalogDocument): Promise<void> {
    const file = path.join(this.root, CATALOG_PATH);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
}

export function formatCatalogAnswer(match: CatalogMatch): string {
  const kind = match.exact ? "pergunta identica" : `pergunta semelhante (${Math.round(match.similarity * 100)}%)`;
  return [
    match.entry.answer,
    "",
    `_Resposta reutilizada do catalogo local de respostas do AdoneX: ${kind}, gerada originalmente pelo modelo ${match.entry.model} em ${match.entry.createdAt.slice(0, 10)}._`
  ].join("\n");
}

export function isCatalogEligibleQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (normalized.length < 12 || normalized.length > 700) return false;
  if (/@[\w./\\-]+/.test(question)) return false;
  if (/\b(agora|hoje|ontem|amanha|atual|status|erro atual|log|arquivo|selecao|selection|diff|commit|branch)\b/.test(normalized)) {
    return false;
  }
  if (/\b(corrij|implemente|adicione|altere|edite|refatore|rode|execute|aplique|delete|remova)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function isCatalogEligibleAnswer(answer: string): boolean {
  if (answer.length < 20 || answer.length > 4_000) return false;
  if (/Ollama local nao concluiu|request exceeded|nao tratou isso como cancelamento/i.test(answer)) {
    return false;
  }
  return true;
}

export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[`"'“”‘’.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment);
}

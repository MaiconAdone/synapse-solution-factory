import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentMode } from "../llm/types";

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface UsageEntry {
  timestamp: string;
  provider: "openai" | "ollama" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

interface UsageDocument {
  version: 1;
  entries: UsageEntry[];
}

export interface BudgetStatus {
  allowed: boolean;
  dailyUsedUsd: number;
  monthlyUsedUsd: number;
  projectedDailyUsd: number;
  projectedMonthlyUsd: number;
  reason?: string;
}

const MODE_PRICES: Record<AgentMode, { input: number; output: number }> = {
  economic: { input: 0.05, output: 0.4 },
  balanced: { input: 0.25, output: 2.0 },
  strong: { input: 1.25, output: 10.0 },
  local: { input: 0, output: 0 },
  synapse: { input: 0, output: 0 }
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCost(
  input: string,
  mode: AgentMode,
  outputTokens = 800
): CostEstimate {
  const inputTokens = estimateTokens(input);
  return estimateTokenCost(inputTokens, outputTokens, mode);
}

export function estimateTokenCost(
  inputTokens: number,
  outputTokens: number,
  mode: AgentMode
): CostEstimate {
  const price = MODE_PRICES[mode];
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6))
  };
}

export class CostGuard {
  private readonly usagePath: string;

  public constructor(
    workspaceRoot: string,
    private readonly dailyBudgetUsd: number,
    private readonly monthlyBudgetUsd: number
  ) {
    this.usagePath = path.join(workspaceRoot, ".adonex", "usage.json");
  }

  public async check(estimate: CostEstimate, now = new Date()): Promise<BudgetStatus> {
    const usage = await this.readUsage();
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const dailyUsedUsd = this.sum(
      usage.entries.filter((entry) => entry.timestamp.startsWith(day))
    );
    const monthlyUsedUsd = this.sum(
      usage.entries.filter((entry) => entry.timestamp.startsWith(month))
    );
    const projectedDailyUsd = dailyUsedUsd + estimate.estimatedCostUsd;
    const projectedMonthlyUsd = monthlyUsedUsd + estimate.estimatedCostUsd;
    const dailyExceeded =
      this.dailyBudgetUsd > 0 && projectedDailyUsd > this.dailyBudgetUsd;
    const monthlyExceeded =
      this.monthlyBudgetUsd > 0 && projectedMonthlyUsd > this.monthlyBudgetUsd;

    return {
      allowed: !dailyExceeded && !monthlyExceeded,
      dailyUsedUsd,
      monthlyUsedUsd,
      projectedDailyUsd,
      projectedMonthlyUsd,
      reason: dailyExceeded
        ? "Daily OpenAI budget would be exceeded."
        : monthlyExceeded
          ? "Monthly OpenAI budget would be exceeded."
          : undefined
    };
  }

  public async record(entry: UsageEntry): Promise<void> {
    const usage = await this.readUsage();
    usage.entries.push(entry);
    await fs.mkdir(path.dirname(this.usagePath), { recursive: true });
    await fs.writeFile(this.usagePath, JSON.stringify(usage, null, 2), "utf8");
  }

  public async reset(): Promise<void> {
    await fs.mkdir(path.dirname(this.usagePath), { recursive: true });
    await fs.writeFile(
      this.usagePath,
      JSON.stringify({ version: 1, entries: [] }, null, 2),
      "utf8"
    );
  }

  private sum(entries: UsageEntry[]): number {
    return entries.reduce((total, entry) => total + entry.estimatedCostUsd, 0);
  }

  private async readUsage(): Promise<UsageDocument> {
    try {
      const raw = await fs.readFile(this.usagePath, "utf8");
      const parsed = JSON.parse(raw) as UsageDocument;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return { version: 1, entries: [] };
    }
  }
}

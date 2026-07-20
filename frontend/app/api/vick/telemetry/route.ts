import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Telemetria real do Synapse para o cockpit da Vick.
// - Custo: derivado do ledger real de roteamento LLM (artifacts/llm-routing/events.jsonl),
//   o mesmo que o backend grava. Chamadas locais (Ollama) não têm custo de API;
//   chamadas de nuvem são estimadas a partir dos tokens reais registrados.
// - Atividade: mesclagem das chamadas LLM reais + interações da Vick e gates da
//   Solution Factory registrados em .adonex/memory/SHARED_DIALOG_MEMORY.md.

type LlmEvent = {
  timestamp?: string;
  provider?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  fallback_used?: boolean;
  billable?: boolean;
};

type ActivityItem = {
  level: "ok" | "info" | "warn";
  main: string;
  ts: number;
};

// Estimativa de preço de nuvem (USD por 1M tokens). Local = 0.
// Aproximações; usadas apenas quando um provedor de nuvem realmente é acionado.
const CLOUD_PRICE_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  openai: { in: 1.25, out: 10 },
  anthropic: { in: 3, out: 15 },
};
const USD_TO_BRL = 5.4;
const LOCAL_PROVIDERS = new Set(["ollama", "local", "synapse-local", "vick-web"]);

function workspaceRoot() {
  // O servidor Next roda em frontend/; o workspace Synapse é o diretório acima.
  return path.resolve(process.cwd(), "..");
}

function eventCostBrl(event: LlmEvent): number {
  if (event.billable === false) return 0;
  const provider = (event.provider ?? "").toLowerCase();
  if (!provider || LOCAL_PROVIDERS.has(provider)) return 0;
  const price = CLOUD_PRICE_USD_PER_MTOK[provider];
  if (!price) return 0;
  const promptTok = Number(event.prompt_tokens ?? 0);
  const completionTok = Number(event.completion_tokens ?? Math.max(0, Number(event.total_tokens ?? 0) - promptTok));
  const usd = (promptTok * price.in + completionTok * price.out) / 1_000_000;
  return usd * USD_TO_BRL;
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readLlmEvents(): Promise<LlmEvent[]> {
  const file = path.join(workspaceRoot(), "artifacts", "llm-routing", "events.jsonl");
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-5000);
    const events: LlmEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as LlmEvent);
      } catch {
        // linha corrompida é ignorada
      }
    }
    return events;
  } catch {
    return [];
  }
}

type CodexTokenEvent = {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    cwd?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };
  };
};

async function readCodexEvents(): Promise<LlmEvent[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsRoot = path.join(codexHome, "sessions");
  const files: string[] = [];
  const now = Date.now();

  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(now - offset * 86_400_000);
    const folder = path.join(
      sessionsRoot,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    );
    try {
      const names = await fs.readdir(folder);
      files.push(...names.filter((name) => name.endsWith(".jsonl")).map((name) => path.join(folder, name)));
    } catch {
      // Dia sem sessoes do Codex.
    }
  }

  const events: LlmEvent[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split(/\r?\n/);
    try {
      const meta = JSON.parse(lines[0]) as CodexTokenEvent;
      const sessionCwd = meta.payload?.cwd;
      if (!sessionCwd || path.resolve(sessionCwd).toLowerCase() !== workspaceRoot().toLowerCase()) continue;
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.includes('"token_count"')) continue;
      try {
        const entry = JSON.parse(line) as CodexTokenEvent;
        const usage = entry.payload?.info?.last_token_usage;
        if (entry.type !== "event_msg" || entry.payload?.type !== "token_count" || !usage) continue;
        const input = Number(usage.input_tokens ?? 0);
        const output = Number(usage.output_tokens ?? 0);
        events.push({
          timestamp: entry.timestamp,
          provider: "openai",
          model: "codex",
          prompt_tokens: input,
          completion_tokens: output,
          total_tokens: Number(usage.total_tokens ?? input + output),
          billable: false,
        });
      } catch {
        // Somente eventos JSON validos de token_count sao considerados.
      }
    }
  }
  return events;
}

function buildCost(events: LlmEvent[]) {
  const now = Date.now();
  const todayKey = localDayKey(now);
  const yesterdayKey = localDayKey(now - 86_400_000);

  // Sparkline: tokens por dia nos últimos 7 dias (atividade real).
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i -= 1) dayKeys.push(localDayKey(now - i * 86_400_000));
  const tokensByDay = new Map<string, number>(dayKeys.map((k) => [k, 0]));

  let brlToday = 0;
  let requestsToday = 0;
  let cloudRequestsToday = 0;
  let tokensToday = 0;
  let tokensYesterday = 0;

  for (const event of events) {
    const ts = event.timestamp ? Date.parse(event.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const key = localDayKey(ts);
    const tokens = Number(event.total_tokens ?? 0);
    if (tokensByDay.has(key)) tokensByDay.set(key, (tokensByDay.get(key) ?? 0) + tokens);
    if (key === todayKey) {
      brlToday += eventCostBrl(event);
      requestsToday += 1;
      tokensToday += tokens;
      const provider = (event.provider ?? "").toLowerCase();
      if (provider && !LOCAL_PROVIDERS.has(provider)) cloudRequestsToday += 1;
    } else if (key === yesterdayKey) {
      tokensYesterday += tokens;
    }
  }

  const spark = dayKeys.map((k) => Math.round((tokensByDay.get(k) ?? 0) / 100) / 10); // em milhares
  const trendPct =
    tokensYesterday > 0 ? Math.round(((tokensToday - tokensYesterday) / tokensYesterday) * 100) : null;

  return {
    currency: "BRL",
    brlToday: Math.round(brlToday * 100) / 100,
    requestsToday,
    cloudRequestsToday,
    tokensToday,
    trendPct,
    spark: spark.some((v) => v > 0) ? spark : [0, 0, 0, 0, 0, 0, 0],
    localOnly: cloudRequestsToday === 0,
  };
}

function buildProviderCost(events: LlmEvent[], provider: "openai" | "anthropic") {
  const now = Date.now();
  const todayKey = localDayKey(now);
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i -= 1) dayKeys.push(localDayKey(now - i * 86_400_000));
  const costByDay = new Map<string, number>(dayKeys.map((key) => [key, 0]));
  const tokensByDay = new Map<string, number>(dayKeys.map((key) => [key, 0]));
  let brlToday = 0;
  let requestsToday = 0;
  let inputTokensToday = 0;
  let outputTokensToday = 0;
  let tokensToday = 0;

  for (const event of events) {
    if ((event.provider ?? "").toLowerCase() !== provider) continue;
    const ts = event.timestamp ? Date.parse(event.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const key = localDayKey(ts);
    const cost = eventCostBrl(event);
    if (costByDay.has(key)) costByDay.set(key, (costByDay.get(key) ?? 0) + cost);
    const eventTokens = Number(event.total_tokens ?? 0);
    if (tokensByDay.has(key)) tokensByDay.set(key, (tokensByDay.get(key) ?? 0) + eventTokens);
    if (key === todayKey) {
      brlToday += cost;
      const inputTokens = Number(event.prompt_tokens ?? 0);
      const outputTokens = Number(event.completion_tokens ?? 0);
      requestsToday += 1;
      inputTokensToday += inputTokens;
      outputTokensToday += outputTokens;
      tokensToday += Number(event.total_tokens ?? inputTokens + outputTokens);
    }
  }

  return {
    brlToday: Math.round(brlToday * 100) / 100,
    requestsToday,
    inputTokensToday,
    outputTokensToday,
    tokensToday,
    spark: dayKeys.map((key) => Math.round((costByDay.get(key) ?? 0) * 100) / 100),
    tokenSpark: dayKeys.map((key) => Math.round((tokensByDay.get(key) ?? 0) / 100) / 10),
  };
}
function providerLevel(event: LlmEvent): ActivityItem["level"] {
  if (event.fallback_used) return "warn";
  const provider = (event.provider ?? "").toLowerCase();
  if (provider && !LOCAL_PROVIDERS.has(provider)) return "info";
  return "ok";
}

function sentimentLevel(sentiment: string): ActivityItem["level"] {
  if (sentiment === "frustrado" || sentiment === "ansioso") return "warn";
  if (sentiment === "satisfeito") return "ok";
  return "info";
}

async function readMemoryActivity(): Promise<ActivityItem[]> {
  const file = path.join(workspaceRoot(), ".adonex", "memory", "SHARED_DIALOG_MEMORY.md");
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const items: ActivityItem[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const stamp = line.match(/\[vick\]\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
    if (!stamp) continue;
    const ts = Date.parse(stamp[1]);
    if (Number.isNaN(ts)) continue;

    const gate = line.match(/analyzer-gate\s+projeto=(\S+)\s+status=(\S+)/);
    if (gate) {
      items.push({ level: "ok", main: `Solution Factory · projeto ${gate[1]} (${gate[2]})`, ts });
      continue;
    }
    const sentiment = (line.match(/sentimento=(\w+)/) ?? [])[1] ?? "neutro";
    const prompt = (line.match(/prompt="([^"]*)"/) ?? [])[1] ?? "";
    const short = prompt.length > 52 ? `${prompt.slice(0, 52)}…` : prompt;
    items.push({
      level: sentimentLevel(sentiment),
      main: short ? `Vick · "${short}"` : `Vick · comando de voz (${sentiment})`,
      ts,
    });
  }
  return items;
}

function buildActivity(events: LlmEvent[], memory: ActivityItem[]): ActivityItem[] {
  const fromEvents: ActivityItem[] = events
    .filter((event) => event.timestamp)
    .map((event) => {
      const ts = Date.parse(event.timestamp as string);
      const provider = event.provider ?? "desconhecido";
      const model = event.model ? ` ${event.model}` : "";
      const tokens = Number(event.total_tokens ?? 0);
      return {
        level: providerLevel(event),
        main: `LLM · ${provider}${model} · ${tokens} tok`,
        ts,
      } as ActivityItem;
    })
    .filter((item) => !Number.isNaN(item.ts));

  return [...fromEvents, ...memory]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);
}

export async function GET() {
  const [ledgerEvents, codexEvents] = await Promise.all([readLlmEvents(), readCodexEvents()]);
  const events = [...ledgerEvents, ...codexEvents];
  const memory = await readMemoryActivity();
  return NextResponse.json(
    {
      cost: buildCost(events),
      providerCosts: {
        codex: buildProviderCost(events, "openai"),
        claudeCode: buildProviderCost(events, "anthropic"),
      },
      activity: buildActivity(events, memory),
      generatedAt: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

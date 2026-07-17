import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type RufloAgent = {
  id: string;
  tier: "core" | "specialist";
  domain: string;
  mission: string;
};

function parseAgents(source: string): RufloAgent[] {
  const agents: RufloAgent[] = [];
  let current: Partial<RufloAgent> | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const id = line.match(/^-\s+id:\s*(.+)$/);
    if (id) {
      if (current?.id) agents.push(normalizeAgent(current));
      current = { id: id[1].trim() };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === "tier") current.tier = field[2] === "core" ? "core" : "specialist";
    if (field[1] === "domain") current.domain = field[2].trim();
    if (field[1] === "mission") current.mission = field[2].trim();
  }
  if (current?.id) agents.push(normalizeAgent(current));
  return agents;
}

function normalizeAgent(agent: Partial<RufloAgent>): RufloAgent {
  return {
    id: agent.id ?? "unknown-agent",
    tier: agent.tier ?? "specialist",
    domain: agent.domain ?? "general",
    mission: agent.mission ?? "Especialista Ruflo local.",
  };
}

export async function GET() {
  try {
    const catalogPath = path.resolve(process.cwd(), "..", "agents", "definitions", "enterprise_agents.yaml");
    const agents = parseAgents(await readFile(catalogPath, "utf8"));
    return NextResponse.json({ agents, total: agents.length, activationPolicy: "on-demand" });
  } catch (error) {
    return NextResponse.json(
      { agents: [], total: 0, activationPolicy: "unavailable", error: error instanceof Error ? error.message : "catalog unavailable" },
      { status: 503 },
    );
  }
}

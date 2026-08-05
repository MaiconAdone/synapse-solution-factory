import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectIdentity {
  name: string;
  isGeneratedChildProject: boolean;
  universe?: string;
}

/**
 * Diferencia "este workspace E o repositorio da plataforma Synapse" de
 * "este workspace e UM PROJETO GERADO pela Solution Factory do Synapse".
 * detectSynapseProject (workspaceContextCore.ts) nao consegue distinguir os
 * dois: todo projeto gerado herda os mesmos sinais de peso maximo
 * (runtime_manifest.json, start_ruflo_swarm.ps1, .mcp.json, AGENTS.md).
 * create_ai_project.ps1, porem, grava config/project_universe.json em todo
 * projeto gerado com creation_rules.managed_by=synapse e
 * factory_capable=false — um sinal inequivoco que a propria plataforma
 * Synapse nao possui. Best-effort: qualquer falha de leitura cai no
 * fallback (nome = nome da pasta, nao e projeto gerado).
 */
export function detectProjectIdentity(root: string): ProjectIdentity {
  const fallback: ProjectIdentity = {
    name: path.basename(root),
    isGeneratedChildProject: false
  };
  const universePath = path.join(root, "config", "project_universe.json");
  try {
    if (!fs.existsSync(universePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(universePath, "utf8")) as {
      project?: string;
      universe?: string;
      creation_rules?: { managed_by?: string; factory_capable?: boolean };
    };
    const isGeneratedChildProject =
      parsed.creation_rules?.managed_by === "synapse" &&
      parsed.creation_rules?.factory_capable === false;
    if (!isGeneratedChildProject) return fallback;
    return {
      name: parsed.project?.trim() || fallback.name,
      isGeneratedChildProject: true,
      universe: parsed.universe
    };
  } catch {
    return fallback;
  }
}

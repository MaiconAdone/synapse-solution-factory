import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectIdentity {
  name: string;
  /** true quando este workspace E o repositorio da plataforma Synapse em si. */
  isPlatformRepo: boolean;
  universe?: string;
}

/**
 * scripts/create_ai_project.ps1 e a propria fabrica de projetos: so existe no
 * repositorio da plataforma Synapse. diagnose_project.ps1 ja usa a AUSENCIA
 * desse arquivo como prova de que um projeto gerado nao e a fabrica (check
 * "no_factory"). E o sinal mais estavel disponivel para esta distincao —
 * ao contrario de detectSynapseProject (que da positivo tanto na plataforma
 * quanto em qualquer projeto por ela gerado, pois os dois herdam os mesmos
 * arquivos de config/agents/docs) ou de tentar reconhecer o formato exato de
 * um marcador especifico de geracao (fragil: muda entre versoes do gerador,
 * so cobre projetos gerados por ele, e nao cobre nenhum outro projeto que o
 * usuario simplesmente abra com o AdoneX instalado).
 */
const PLATFORM_MARKER = path.join("scripts", "create_ai_project.ps1");

interface ProjectUniverseFile {
  project?: string;
  universe?: string;
}

function readProjectUniverse(root: string): ProjectUniverseFile | undefined {
  try {
    const universePath = path.join(root, "config", "project_universe.json");
    if (!fs.existsSync(universePath)) return undefined;
    return JSON.parse(fs.readFileSync(universePath, "utf8")) as ProjectUniverseFile;
  } catch {
    return undefined;
  }
}

/**
 * Identifica se o workspace aberto E o repositorio da plataforma Synapse ou
 * QUALQUER OUTRO projeto — gerado pela Solution Factory ou nao, com ou sem
 * config/project_universe.json. Fora do repositorio da plataforma, o AdoneX
 * nunca deve se apresentar como "Synapse": deve se ancorar no nome real do
 * projeto aberto e responder somente com base nos arquivos que encontrar
 * nele. Best-effort: qualquer falha de I/O cai no fallback (nome = nome da
 * pasta, tratado como projeto independente, nao a plataforma).
 */
export function detectProjectIdentity(root: string): ProjectIdentity {
  const isPlatformRepo = fs.existsSync(path.join(root, PLATFORM_MARKER));
  const universeFile = readProjectUniverse(root);
  return {
    name: universeFile?.project?.trim() || path.basename(root),
    isPlatformRepo,
    universe: universeFile?.universe
  };
}

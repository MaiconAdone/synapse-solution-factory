import { agents as fallbackAgents, workflows as fallbackWorkflows } from "@/lib/catalog";

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type ApiResult<T> = {
  data: T;
  source: "api" | "fallback";
  error?: string;
};

export type Agent = {
  id: string;
  domain?: string;
  role: string;
};

export type Workflow = {
  id: string;
  name?: string;
  strategy?: string;
  steps?: string[];
  description?: string;
};

export type HealthStatus = {
  status: string;
  environment: string;
  memory_backend: string;
  swarm_topology: string;
};

export type MemoryStatus = {
  backend: string;
  tiers: string[];
  embeddings?: {
    enabled: boolean;
    dimension: number;
    provider?: string;
  };
  semantic_search?: {
    enabled: boolean;
    index: string;
  };
};

export type SwarmStatus = {
  core: string;
  operational_state: string;
  topology: string;
  consensus: string;
  coordination: string;
  max_agents: number;
  core_agent_count?: number;
  specialist_agent_count?: number;
  activation_policy?: string;
  anti_drift: boolean;
};

export type MlflowStatus = {
  available: boolean;
  reason?: string;
  tracking_uri: string;
  registry_uri: string;
  experiment_name: string;
  experiment_id?: string | null;
  ui_url?: string;
};

export type MlflowRun = {
  run_id: string;
  status: string;
  start_time?: number | null;
  end_time?: number | null;
  params: Record<string, string>;
  metrics: Record<string, number>;
  tags: Record<string, string>;
};

export type MlflowRuns = {
  available: boolean;
  reason?: string;
  experiment_id?: string;
  runs?: MlflowRun[];
};

async function fetchApi<T>(path: string, fallback: T): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { data: (await response.json()) as T, source: "api" };
  } catch (error) {
    return {
      data: fallback,
      source: "fallback",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export function getHealth() {
  return fetchApi<HealthStatus>("/health", {
    status: "offline",
    environment: "local",
    memory_backend: "hybrid",
    swarm_topology: "hierarchical-mesh",
  });
}

export function getAgents() {
  return fetchApi<Agent[]>(
    "/agents",
    fallbackAgents.map(([id, role]) => ({ id, role })),
  );
}

export function getWorkflows() {
  return fetchApi<Workflow[]>(
    "/workflows",
    fallbackWorkflows.map(([id, description]) => ({ id, description })),
  );
}

export function getMemory() {
  return fetchApi<MemoryStatus>("/memory", {
    backend: "hybrid",
    tiers: ["working", "episodic", "semantic"],
    embeddings: { enabled: true, dimension: 384, provider: "ruflo-agentdb" },
    semantic_search: { enabled: true, index: "hnsw-ready" },
  });
}

export function getSwarm() {
  return fetchApi<SwarmStatus>("/swarm", {
    core: "Synapse local runtime",
    operational_state: "configured",
    topology: "hierarchical-mesh",
    consensus: "raft",
    coordination: "distributed",
    max_agents: 60,
    core_agent_count: 15,
    specialist_agent_count: 45,
    activation_policy: "activate_core_parallel_and_route_specialists_on_demand",
    anti_drift: true,
  });
}

export function getMlflowStatus() {
  return fetchApi<MlflowStatus>("/mlflow/status", {
    available: false,
    reason: "backend unavailable",
    tracking_uri: "http://localhost:5000",
    registry_uri: "http://localhost:5000",
    experiment_name: "synapse-ai",
  });
}

export function getMlflowRuns() {
  return fetchApi<MlflowRuns>("/mlflow/runs?max_results=10", {
    available: false,
    reason: "backend unavailable",
    runs: [],
  });
}

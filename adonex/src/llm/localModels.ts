export const ADONEX_TEAM_LOCAL_MODEL = "qwen3-coder-14b-team";

export const ADONEX_FAST_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_REASONING_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_GENERAL_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_CODE_STRONG_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_PLANNING_STRONG_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_REASONING_STRONG_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_CODE_CRITICAL_LOCAL_MODEL = ADONEX_TEAM_LOCAL_MODEL;
export const ADONEX_EMBEDDING_LOCAL_MODEL = "nomic-embed-text:latest";

export const ADONEX_ALLOWED_LOCAL_MODELS = [
  ADONEX_TEAM_LOCAL_MODEL,
  ADONEX_EMBEDDING_LOCAL_MODEL
] as const;

export type AdoneXAllowedLocalModel = (typeof ADONEX_ALLOWED_LOCAL_MODELS)[number];
export type AdoneXGenerationLocalModel = Exclude<
  AdoneXAllowedLocalModel,
  typeof ADONEX_EMBEDDING_LOCAL_MODEL
>;
export type AdoneXLocalModelProfile =
  | "fast"
  | "general"
  | "balanced"
  | "code_review"
  | "code_strong"
  | "planning_strong"
  | "reasoning_strong"
  | "code_critical"
  | "embeddings";

export interface LocalModelCallProfile {
  profile: AdoneXLocalModelProfile;
  model: AdoneXAllowedLocalModel;
  purpose: string;
  generation: boolean;
  numCtx: number;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  maxOutputTokens: number;
}

export const ADONEX_LOCAL_MODEL_PROFILES: Record<
  AdoneXLocalModelProfile,
  LocalModelCallProfile
> = {
  fast: {
    profile: "fast",
    model: ADONEX_FAST_LOCAL_MODEL,
    purpose: "triagem, classificacao, resumos curtos e perguntas simples",
    generation: true,
    numCtx: 2048,
    temperature: 0.15,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 384
  },
  general: {
    profile: "general",
    model: ADONEX_GENERAL_LOCAL_MODEL,
    purpose: "respostas gerais, explicacoes, documentacao leve e sintese final",
    generation: true,
    numCtx: 4096,
    temperature: 0.2,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 900
  },
  balanced: {
    profile: "balanced",
    model: ADONEX_REASONING_LOCAL_MODEL,
    purpose: "debugging medio, revisao tecnica e tarefas de agente moderadas",
    generation: true,
    numCtx: 4096,
    temperature: 0.1,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 1000
  },
  code_review: {
    profile: "code_review",
    model: ADONEX_REASONING_LOCAL_MODEL,
    purpose: "code review, bugs, stack traces, seguranca e reparos pequenos",
    generation: true,
    numCtx: 4096,
    temperature: 0,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 1200
  },
  code_strong: {
    profile: "code_strong",
    model: ADONEX_CODE_STRONG_LOCAL_MODEL,
    purpose: "implementacoes maiores, scripts, endpoints e integracoes",
    generation: true,
    numCtx: 4096,
    temperature: 0,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 1200
  },
  planning_strong: {
    profile: "planning_strong",
    model: ADONEX_PLANNING_STRONG_LOCAL_MODEL,
    purpose: "arquitetura, governanca, planejamento agentico e roadmap",
    generation: true,
    numCtx: 4096,
    temperature: 0.15,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 1400
  },
  reasoning_strong: {
    profile: "reasoning_strong",
    model: ADONEX_REASONING_STRONG_LOCAL_MODEL,
    purpose: "causa raiz, validacao logica e decisoes tecnicas dificeis",
    generation: true,
    numCtx: 4096,
    temperature: 0.05,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 1400
  },
  code_critical: {
    profile: "code_critical",
    model: ADONEX_CODE_CRITICAL_LOCAL_MODEL,
    purpose: "codigo critico, revisao final e refatoracoes de alto risco por pedido explicito",
    generation: true,
    numCtx: 8192,
    temperature: 0,
    topP: 0.9,
    repeatPenalty: 1.08,
    maxOutputTokens: 2200
  },
  embeddings: {
    profile: "embeddings",
    model: ADONEX_EMBEDDING_LOCAL_MODEL,
    purpose: "embeddings para memoria, RAG e busca semantica; nao usar para chat",
    generation: false,
    numCtx: 2048,
    temperature: 0,
    topP: 1,
    repeatPenalty: 1,
    maxOutputTokens: 0
  }
};

// Ladder de escalada para a correcao (repair): um unico degrau acima do
// perfil que ja falhou, com teto em code_critical/reasoning_strong. Local
// models ganham mais com uma segunda tentativa MAIS capaz do que com uma
// tentativa identica; um degrau evita saltar direto para 32b sem pedido
// explicito do usuario.
const PROFILE_ESCALATION: Partial<Record<AdoneXLocalModelProfile, AdoneXLocalModelProfile>> = {
  fast: "balanced",
  general: "balanced",
  balanced: "code_strong",
  code_review: "code_strong",
  code_strong: "code_critical",
  planning_strong: "reasoning_strong",
  reasoning_strong: "code_critical"
};

/** Um degrau acima na ladder de capacidade; teto em code_critical/embeddings (no-op). */
export function escalateLocalModelProfile(
  profile: AdoneXLocalModelProfile
): AdoneXLocalModelProfile {
  return PROFILE_ESCALATION[profile] ?? profile;
}

export function isAllowedLocalModel(model: string): model is AdoneXAllowedLocalModel {
  return (ADONEX_ALLOWED_LOCAL_MODELS as readonly string[]).includes(model);
}

export function normalizeLocalModel(
  model: string | undefined,
  fallback: AdoneXAllowedLocalModel
): AdoneXAllowedLocalModel {
  const candidate = (model ?? "").trim();
  return isAllowedLocalModel(candidate) ? candidate : fallback;
}

export function selectLocalModelForTask(
  action: string,
  task: string,
  configuredFast?: string,
  configuredReasoning?: string
): AdoneXAllowedLocalModel {
  return selectLocalModelProfileForTask(
    action,
    task,
    configuredFast,
    configuredReasoning
  ).model;
}

export function selectLocalModelProfileForTask(
  action: string,
  task: string,
  configuredFast?: string,
  configuredReasoning?: string
): LocalModelCallProfile {
  const fast = normalizeLocalModel(configuredFast, ADONEX_FAST_LOCAL_MODEL);
  const reasoning = normalizeLocalModel(
    configuredReasoning,
    ADONEX_REASONING_LOCAL_MODEL
  );
  const text = stripAccents(task.toLowerCase());
  const heavyAction = [
    "implement",
    "fix",
    "synapse_architecture",
    "synapse_agent",
    "synapse_mcp",
    "synapse_pipeline",
    "synapse_roadmap"
  ].includes(action);
  const heavySignal =
    /\b(corrij|implemente|refator|vulnerabilidade|security|seguranca|bug|stack trace|mcp|agente|pipeline|rag|arquitetura critica|producao)\b/i.test(
      text
    );
  const explicitSlowModelSignal =
    /\b(8b|14b|32b|modelo maior|modelo forte|strong|critical|critico|cr[ií]tico|profundo|deep|raciocinio forte|reasoning strong)\b/i.test(
      text
    );
  const criticalSignal =
    /\b(codigo critico|refatoracao grande|revisao final|antes de producao|modelo grande|large|32b|code critical)\b/i.test(text);
  const planningSignal =
    /\b(arquitetura|governanca|agentic|roadmap|estrategia|multiagente)\b/i.test(text);
  const reasoningSignal =
    /\b(raciocinio|causa raiz|root cause|validacao logica|decisao final)\b/i.test(text);
  const codeStrongSignal =
    /\b(implemente|implementacao|endpoint|script|pipeline|integracao)\b/i.test(text);
  const explicitFast =
    /\b(rapido|rapida|fast|simples|resuma|triagem|classifique|baixo custo)\b/i.test(
      text
    );
  if (explicitFast && !heavyAction) return withModel("fast", fast);
  if (explicitSlowModelSignal && criticalSignal) return ADONEX_LOCAL_MODEL_PROFILES.code_critical;
  if (explicitSlowModelSignal && reasoningSignal) return ADONEX_LOCAL_MODEL_PROFILES.reasoning_strong;
  if (explicitSlowModelSignal && planningSignal) return ADONEX_LOCAL_MODEL_PROFILES.planning_strong;
  if (explicitSlowModelSignal && codeStrongSignal && heavyAction) return ADONEX_LOCAL_MODEL_PROFILES.code_strong;
  if (explicitSlowModelSignal && (heavyAction || heavySignal)) return withModel("code_review", reasoning);
  // Calibracao CPU-only: geracao de codigo real vai para o modelo de codigo
  // (lite MoE via role reasoning); o 3b fica para triagem, chat e resumos.
  if (["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action)) {
    return withModel("code_review", reasoning);
  }
  // Analises Synapse longas (arquitetura, pipeline, roadmap) tambem rendem mais
  // no modelo de raciocinio do que no 3b.
  if (heavyAction) return withModel("balanced", reasoning);
  if (heavySignal) return withModel("fast", fast);
  if (/\b(explique|explica|documente|docs|readme|como funciona)\b/i.test(text)) {
    return withModel("fast", fast);
  }
  return withModel("fast", fast);
}

export function localProfileForName(
  profile: string | undefined,
  configuredFast?: string,
  configuredReasoning?: string
): LocalModelCallProfile | undefined {
  if (!profile) return undefined;
  if (profile === "fast") {
    return withModel("fast", normalizeLocalModel(configuredFast, ADONEX_FAST_LOCAL_MODEL));
  }
  if (profile === "balanced") {
    return withModel(
      "balanced",
      normalizeLocalModel(configuredReasoning, ADONEX_REASONING_LOCAL_MODEL)
    );
  }
  if (profile in ADONEX_LOCAL_MODEL_PROFILES) {
    return ADONEX_LOCAL_MODEL_PROFILES[profile as AdoneXLocalModelProfile];
  }
  return undefined;
}

export function outputBudgetForTask(
  profile: LocalModelCallProfile,
  action: string,
  task: string
): number {
  const codeAction = ["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action);
  if (!codeAction) return profile.maxOutputTokens;
  const text = stripAccents(task.toLowerCase());
  const broadChange = /\b(multiplos arquivos|varios arquivos|refatoracao grande|migracao|projeto inteiro|cross-file)\b/i.test(text);
  if (profile.profile === "fast") return broadChange ? 1200 : 768;
  if (profile.profile === "code_strong") return broadChange ? 1800 : 1200;
  return Math.min(profile.maxOutputTokens, broadChange ? 1600 : 1000);
}

function withModel(
  profile: Exclude<AdoneXLocalModelProfile, "embeddings">,
  model: AdoneXAllowedLocalModel
): LocalModelCallProfile {
  if (model === ADONEX_EMBEDDING_LOCAL_MODEL) {
    return ADONEX_LOCAL_MODEL_PROFILES[profile];
  }
  return { ...ADONEX_LOCAL_MODEL_PROFILES[profile], model };
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

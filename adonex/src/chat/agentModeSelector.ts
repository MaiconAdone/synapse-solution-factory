import { classifyProgrammingTask } from "../context/codeIntelligence";
import type { AgentAction, AgentMode } from "../llm/types";
import type { ChatRoute } from "./chatRouting";

export function normalizeConfiguredAgentMode(value: string | undefined): AgentMode {
  if (
    value === "auto" ||
    value === "balanced" ||
    value === "strong" ||
    value === "local" ||
    value === "synapse"
  ) {
    return value;
  }
  return "auto";
}

export function resolveAgentMode(
  prompt: string,
  action: AgentAction,
  route: Pick<ChatRoute, "mode" | "governed">,
  requestedMode: AgentMode | undefined
): Exclude<AgentMode, "auto"> {
  const requested = requestedMode ?? "auto";
  if (requested !== "auto") return requested;
  return selectAutomaticAgentMode(prompt, action, route);
}

export function selectAutomaticAgentMode(
  prompt: string,
  action: AgentAction,
  route: Pick<ChatRoute, "mode" | "governed">
): Exclude<AgentMode, "auto"> {
  const text = stripAccents(prompt.toLowerCase());
  if (route.mode === "synapse" || action.startsWith("synapse_")) return "synapse";
  if (/\b(solution factory|projeto synapse|mcp|rag|multiagente|ruflo|agentes?)\b/.test(text)) {
    return "synapse";
  }

  const taskKind = classifyProgrammingTask(prompt);
  if (
    taskKind === "security" ||
    taskKind === "architecture" ||
    /\b(producao|migration|migracao|database|banco de dados|auth|lgpd|32b|critico|critical)\b/.test(text)
  ) {
    return "strong";
  }
  if (
    route.governed ||
    taskKind === "bugfix" ||
    taskKind === "feature" ||
    taskKind === "refactor" ||
    taskKind === "test" ||
    /\b(corrij|implemente|adicione|refatore|rode os testes|execute os testes)\b/.test(text)
  ) {
    return "balanced";
  }
  return "local";
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

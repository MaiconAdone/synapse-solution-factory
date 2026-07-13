import type { TaskLog } from "./types";

export function taskLogFileName(log: TaskLog): string {
  return `${timestampForPath(log.date)}_${slug(log.title)}.md`;
}

export function renderTaskLog(log: TaskLog): string {
  return `---
id: ${safeLine(log.id)}
title: ${safeLine(log.title)}
date: ${safeLine(log.date)}
tool: ${safeLine(log.tool)}
status: ${safeLine(log.status)}
---

# Tarefa

## Objetivo

${log.objective || "Not recorded."}

## Contexto usado

${list(log.context)}

## Plano

${list(log.plan)}

## Arquivos lidos

${list(log.filesRead)}

## Arquivos alterados

${list(log.filesChanged)}

## Comandos executados

${list(log.commandsRun)}

## Decisoes tomadas

${list(log.decisions)}

## Problemas encontrados

${list(log.problems)}

## Resultado

${log.result || "Not recorded."}

## Proximos passos

${list(log.nextSteps)}
`;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
}

export function timestampForPath(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date
    .toISOString()
    .replace("T", "_")
    .replace(/:/g, "-")
    .slice(0, 16);
}

function list(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None.";
}

function safeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

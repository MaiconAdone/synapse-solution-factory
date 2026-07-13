import { architectAgent } from "./architectAgent";
import { backendAgent } from "./backendAgent";
import { dataAgent } from "./dataAgent";
import { docsAgent } from "./docsAgent";
import { frontendAgent } from "./frontendAgent";
import { mlAgent } from "./mlAgent";
import { securityAgent } from "./securityAgent";
import { testAgent } from "./testAgent";

export const SPECIALISTS = [
  architectAgent,
  backendAgent,
  frontendAgent,
  dataAgent,
  mlAgent,
  testAgent,
  securityAgent,
  docsAgent
] as const;

export function specialistPrompts(task: string): string[] {
  const text = task.toLowerCase();
  const selected = SPECIALISTS.filter((agent) => {
    if (agent.id === "architect" || agent.id === "security") return true;
    if (agent.id === "backend") return /api|backend|fastapi|server|database/.test(text);
    if (agent.id === "frontend") return /frontend|react|webview|ui|vscode/.test(text);
    if (agent.id === "data") return /data|dataset|postgres|sql|pipeline/.test(text);
    if (agent.id === "ml") return /\bml\b|model|training|prediction|mlflow/.test(text);
    if (agent.id === "test") return /test|implement|fix|review/.test(text);
    if (agent.id === "docs") return /doc|readme|architecture/.test(text);
    return false;
  });
  return selected.slice(0, 4).map((agent) => agent.prompt);
}

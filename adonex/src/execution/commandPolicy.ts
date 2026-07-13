const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/i,
  /\bdel\s+\/s\b/i,
  /\bformat(\.com)?\b/i,
  /\bshutdown\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\b(?:setx|set-item)\b.*(?:token|secret|password|api[_-]?key)/i,
  /\binvoke-webrequest\b.*(?:\|\s*(?:iex|invoke-expression))/i
];

export interface CommandAssessment {
  allowed: boolean;
  requiresApproval: boolean;
  category: "test" | "build" | "git" | "install" | "read_only" | "unknown";
  risk: "low" | "medium" | "high" | "blocked";
  reason: string;
}

export function assessCommand(command: string): CommandAssessment {
  const normalized = command.trim();
  if (!normalized) {
    return {
      allowed: false,
      requiresApproval: false,
      category: "unknown",
      risk: "blocked",
      reason: "Command is empty."
    };
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      allowed: false,
      requiresApproval: false,
      category: "unknown",
      risk: "blocked",
      reason: "Command matches an AdoneX dangerous-command policy."
    };
  }
  const install = /\b(npm|pnpm|yarn|pip|uv)\b.*\b(install|add)\b/i.test(normalized);
  const category = commandCategory(normalized);
  const risk = install ? "high" : category === "test" || category === "read_only" ? "low" : "medium";
  return {
    allowed: true,
    requiresApproval: true,
    category,
    risk,
    reason: install
      ? "Dependency installation changes the workspace and requires approval."
      : `Command sandbox category: ${category}; risk: ${risk}. Terminal commands require explicit approval.`
  };
}

function commandCategory(command: string): CommandAssessment["category"] {
  if (/\b(npm|pnpm|yarn|pip|uv)\b.*\b(install|add)\b/i.test(command)) return "install";
  if (/\b(pytest|npm\s+test|node\s+--test|vitest|jest)\b/i.test(command)) return "test";
  if (/\b(tsc|npm\s+run\s+(?:build|compile|check)|pnpm\s+(?:build|check)|yarn\s+(?:build|check))\b/i.test(command)) return "build";
  if (/\bgit\s+(?:status|diff|show|log)\b/i.test(command)) return "git";
  if (/^(?:Get-Content|rg\b|dir\b|ls\b|type\b|cat\b)/i.test(command)) return "read_only";
  return "unknown";
}

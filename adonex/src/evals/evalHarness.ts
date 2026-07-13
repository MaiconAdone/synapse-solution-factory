export interface EvalCase {
  id: string;
  prompt: string;
  expectedKeywords: string[];
}

export interface EvalResult {
  id: string;
  passed: boolean;
  missingKeywords: string[];
  score: number;
}

export function createDefaultAdoneXEvalSuite(): EvalCase[] {
  return [
    {
      id: "plan-response",
      prompt: "Plan a safe implementation",
      expectedKeywords: ["workspace", "safe", "changes"]
    },
    {
      id: "review-response",
      prompt: "Review the architecture",
      expectedKeywords: ["risks", "next steps"]
    },
    {
      id: "validation-response",
      prompt: "Validate the fix",
      expectedKeywords: ["validation", "passed", "fix"]
    }
  ];
}

export function runEvalSuite(
  suite: EvalCase[],
  responses: Record<string, string>
): EvalResult[] {
  return suite.map((entry) => {
    const response = (responses[entry.id] ?? "").toLowerCase();
    const missingKeywords = entry.expectedKeywords.filter(
      (keyword) => !response.includes(keyword.toLowerCase())
    );
    const passed = missingKeywords.length === 0;
    const score = passed ? 1 : 0;
    return {
      id: entry.id,
      passed,
      missingKeywords,
      score
    };
  });
}

export function summarizeEvalResults(results: EvalResult[]): {
  passed: number;
  failed: number;
  score: number;
} {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const score = results.length ? passed / results.length : 0;
  return { passed, failed, score };
}

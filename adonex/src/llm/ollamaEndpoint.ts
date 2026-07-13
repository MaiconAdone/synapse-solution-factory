export function normalizeOllamaBaseUrl(value: string): string {
  return value
    .trim()
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1");
}

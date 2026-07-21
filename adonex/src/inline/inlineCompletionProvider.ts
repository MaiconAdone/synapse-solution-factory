import * as vscode from "vscode";
import { normalizeOllamaBaseUrl } from "../llm/ollamaEndpoint";
import { ADONEX_FAST_LOCAL_MODEL } from "../llm/localModels";
import { isSensitivePath } from "../security/secretScanner";
import { fetchFimCompletion } from "./ollamaFim";
import { boundFimWindow, cleanFimCompletion } from "./codeExtraction";

/**
 * Autocomplete inline (ghost text) 100% local via fill-in-middle no Ollama.
 * Desligavel por `adonex.inlineCompletion.enabled`. Nunca dispara em arquivos
 * sensiveis (.env e afins) e cancela a chamada anterior a cada nova posicao.
 */
export class AdoneXInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private inFlight?: AbortController;

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = vscode.workspace.getConfiguration("adonex");
    if (!config.get<boolean>("inlineCompletion.enabled", true)) return undefined;
    if (!config.get<boolean>("ollama.enabled", true)) return undefined;

    const relativePath = vscode.workspace.asRelativePath(document.uri);
    if (isSensitivePath(relativePath)) return undefined;
    if (document.uri.scheme !== "file") return undefined;

    const debounceMs = config.get<number>("inlineCompletion.debounceMs", 350);
    await delay(debounceMs);
    if (token.isCancellationRequested) return undefined;

    const offset = document.offsetAt(position);
    const fullText = document.getText();
    const { prefix, suffix } = boundFimWindow(
      fullText.slice(0, offset),
      fullText.slice(offset),
      config.get<number>("inlineCompletion.maxPrefixChars", 2_000),
      config.get<number>("inlineCompletion.maxSuffixChars", 1_000)
    );
    if (!prefix.trim() && !suffix.trim()) return undefined;

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    token.onCancellationRequested(() => controller.abort());

    const raw = await fetchFimCompletion({
      baseUrl: normalizeOllamaBaseUrl(
        config.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")
      ),
      model: config.get<string>("inlineCompletion.model", ADONEX_FAST_LOCAL_MODEL),
      prefix,
      suffix,
      numPredict: config.get<number>("inlineCompletion.maxTokens", 128),
      temperature: config.get<number>("inlineCompletion.temperature", 0.1),
      timeoutMs: config.get<number>("inlineCompletion.timeoutMs", 4) * 1_000,
      keepAlive: config.get<string>("ollama.keepAlive", "10m"),
      signal: controller.signal
    });

    if (token.isCancellationRequested) return undefined;
    const completion = cleanFimCompletion(raw, prefix);
    if (!completion.trim()) return undefined;

    return [
      new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position)
      )
    ];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

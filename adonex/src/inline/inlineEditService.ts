import * as vscode from "vscode";
import { OllamaClient } from "../llm/ollamaClient";
import { normalizeOllamaBaseUrl } from "../llm/ollamaEndpoint";
import { ADONEX_FAST_LOCAL_MODEL, normalizeLocalModel } from "../llm/localModels";
import { isSensitivePath, scanAndRedactSecrets } from "../security/secretScanner";
import { extractCodeBlock } from "./codeExtraction";

const CONTEXT_LINES = 40;

/**
 * Edicao inline estilo Cmd+K: seleciona codigo, descreve a mudanca e o AdoneX
 * reescreve apenas a selecao com um modelo local. Aplica via WorkspaceEdit, com
 * undo nativo do VS Code. Nao envia secrets e bloqueia arquivos sensiveis.
 */
export class InlineEditService {
  public async run(instruction?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage(
        "Abra um arquivo e posicione o cursor para usar a edicao inline do AdoneX."
      );
      return;
    }
    const document = editor.document;
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    if (isSensitivePath(relativePath)) {
      void vscode.window.showWarningMessage(
        "AdoneX nao edita arquivos sensiveis (segredos, .env)."
      );
      return;
    }

    const range = editor.selection.isEmpty
      ? document.lineAt(editor.selection.active.line).range
      : new vscode.Range(editor.selection.start, editor.selection.end);
    const target = document.getText(range);
    if (!target.trim()) {
      void vscode.window.showInformationMessage(
        "Selecione o codigo (ou posicione em uma linha com conteudo) antes de editar."
      );
      return;
    }
    if (scanAndRedactSecrets(target).redacted !== target) {
      void vscode.window.showWarningMessage(
        "A selecao contem um possivel segredo. Remova-o antes de pedir a edicao inline."
      );
      return;
    }

    const prompt =
      instruction ??
      (await vscode.window.showInputBox({
        title: "AdoneX: Edicao inline (Cmd+K)",
        prompt: "Descreva a mudanca para a selecao",
        placeHolder: "Ex.: extraia para uma funcao, trate erros, adicione tipagem...",
        ignoreFocusOut: true
      }));
    if (!prompt?.trim()) return;

    const config = vscode.workspace.getConfiguration("adonex");
    const model = normalizeLocalModel(
      config.get<string>("inlineEdit.model") ||
        config.get<string>("ollama.modelReasoning"),
      ADONEX_FAST_LOCAL_MODEL
    );

    const newCode = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `AdoneX editando a selecao (${model})...`,
        cancellable: true
      },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        const before = document.getText(
          new vscode.Range(
            new vscode.Position(Math.max(0, range.start.line - CONTEXT_LINES), 0),
            range.start
          )
        );
        const after = document.getText(
          new vscode.Range(
            range.end,
            new vscode.Position(
              Math.min(document.lineCount - 1, range.end.line + CONTEXT_LINES),
              Number.MAX_SAFE_INTEGER
            )
          )
        );
        const response = await new OllamaClient({
          baseUrl: normalizeOllamaBaseUrl(
            config.get<string>("ollama.baseUrl", "http://127.0.0.1:11434")
          ),
          model,
          apiStyle: config.get<"chat" | "generate">("ollama.apiStyle", "chat"),
          timeoutMs:
            Math.max(config.get<number>("ollama.timeoutSeconds", 120), 120) * 1_000,
          keepAlive: config.get<string>("ollama.keepAlive", "10m"),
          numCtx: config.get<number>("ollama.numCtx", 4_096),
          temperature: 0,
          topP: config.get<number>("ollama.topP", 0.9),
          repeatPenalty: config.get<number>("ollama.repeatPenalty", 1.08),
          maxRetries: config.get<number>("ollama.maxRetries", 1)
        }).generate({
          systemPrompt: [
            "Voce e o motor de edicao inline do AdoneX.",
            "Reescreva APENAS o trecho selecionado conforme a instrucao.",
            "Retorne somente o codigo final que substitui a selecao.",
            "Nao inclua explicacoes, comentarios extras nem cercas de codigo.",
            "Preserve a indentacao, o estilo e os contratos publicos do arquivo.",
            `Linguagem do arquivo: ${document.languageId}.`
          ].join("\n"),
          userPrompt: [
            `Instrucao: ${scanAndRedactSecrets(prompt).redacted}`,
            "",
            "Codigo antes da selecao:",
            "```",
            scanAndRedactSecrets(before).redacted.slice(-2_000),
            "```",
            "",
            "Selecao a reescrever:",
            "```",
            target,
            "```",
            "",
            "Codigo depois da selecao:",
            "```",
            scanAndRedactSecrets(after).redacted.slice(0, 1_500),
            "```"
          ].join("\n"),
          maxOutputTokens: config.get<number>("inlineEdit.maxTokens", 1_200),
          signal: controller.signal
        });
        return extractCodeBlock(response.text);
      }
    );

    if (!newCode?.trim()) {
      void vscode.window.showWarningMessage(
        "AdoneX nao gerou uma edicao aplicavel. Detalhe melhor a instrucao."
      );
      return;
    }
    if (newCode === target) {
      void vscode.window.showInformationMessage("AdoneX nao propos mudancas para a selecao.");
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, newCode);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      void vscode.window.showInformationMessage(
        "AdoneX aplicou a edicao inline. Use Ctrl+Z para reverter."
      );
    } else {
      void vscode.window.showErrorMessage("Nao foi possivel aplicar a edicao inline.");
    }
  }
}

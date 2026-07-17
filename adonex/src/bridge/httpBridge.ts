import * as http from "node:http";
import * as vscode from "vscode";

/**
 * Ponte HTTP local do AdoneX.
 *
 * Existe para a Vick web (navegador, porta 3000) conseguir acionar o fluxo
 * governado do AdoneX, que roda dentro do VS Code e nao tem porta propria.
 *
 * O transporte HTTP ja estava previsto em src/mcp/mcpServer.ts ("Transport
 * binding is intentionally deferred ... stdio, HTTP, or a future VS Code MCP
 * API"). Esta e a ligacao concreta.
 *
 * Regras de seguranca (isto edita codigo, entao nao sao opcionais):
 *  - bind apenas em 127.0.0.1, nunca exposto na rede;
 *  - token compartilhado obrigatorio (senao qualquer processo local edita
 *    o workspace);
 *  - CORS refletido somente para origens locais;
 *  - desligada por padrao (adonex.bridge.enabled = false).
 *
 * O que o comando faz depois de entrar (preparar o patch ou aplicar direto) NAO
 * e decidido aqui: continua valendo adonex.voice.requireConfirmationForPatch e
 * adonex.patch.applyMode.
 */

const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY_BYTES = 16_384;

export interface BridgeTarget {
  simulateVickCommand(transcript?: string): Promise<void>;
}

export class AdoneXHttpBridge implements vscode.Disposable {
  private server?: http.Server;
  private readonly output: vscode.OutputChannel;

  public constructor(
    private readonly target: BridgeTarget,
    output?: vscode.OutputChannel
  ) {
    this.output = output ?? vscode.window.createOutputChannel("AdoneX Bridge");
  }

  private config() {
    const configuration = vscode.workspace.getConfiguration("adonex");
    return {
      enabled: configuration.get<boolean>("bridge.enabled", false),
      port: configuration.get<number>("bridge.port", 8766),
      token: configuration.get<string>("bridge.token", "").trim()
    };
  }

  /** Sobe (ou derruba) a ponte conforme a configuracao atual. */
  public async sync(): Promise<void> {
    const { enabled, port, token } = this.config();
    this.stop();
    if (!enabled) return;
    if (!token) {
      this.output.appendLine(
        "Bridge NAO iniciada: adonex.bridge.token esta vazio. Defina um token para habilitar."
      );
      void vscode.window.showWarningMessage(
        "AdoneX Bridge: defina adonex.bridge.token antes de habilitar a ponte HTTP."
      );
      return;
    }
    await this.start(port, token);
  }

  private async start(port: number, token: string): Promise<void> {
    const server = http.createServer((request, response) => {
      void this.handle(request, response, token);
    });
    server.on("error", (error) => {
      this.output.appendLine(`Bridge falhou na porta ${port}: ${String(error)}`);
      void vscode.window.showErrorMessage(`AdoneX Bridge: ${String(error)}`);
    });
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.output.appendLine(`Bridge ouvindo em http://127.0.0.1:${port} (token exigido).`);
  }

  private cors(request: http.IncomingMessage, response: http.ServerResponse): void {
    const origin = request.headers.origin ?? "";
    if (LOCAL_ORIGIN_RE.test(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Adonex-Token");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
  }

  private send(response: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(body);
  }

  private async readBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new Error("payload muito grande");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    token: string
  ): Promise<void> {
    this.cors(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const path = (request.url ?? "").split("?")[0];

    if (request.method === "GET" && path === "/health") {
      const { port } = this.config();
      const configuration = vscode.workspace.getConfiguration("adonex");
      this.send(response, 200, {
        ok: true,
        service: "adonex-bridge",
        port,
        workspace: vscode.workspace.workspaceFolders?.[0]?.name ?? null,
        // Transparencia: a Vick web mostra se o patch sera aplicado ou so preparado.
        applyMode: configuration.get<string>("patch.applyMode", "prepare"),
        requiresConfirmation: configuration.get<boolean>(
          "voice.requireConfirmationForPatch",
          true
        )
      });
      return;
    }

    if (request.method === "POST" && path === "/command") {
      if ((request.headers["x-adonex-token"] ?? "") !== token) {
        this.send(response, 401, { detail: "token invalido" });
        return;
      }
      let transcript = "";
      try {
        const raw = await this.readBody(request);
        const payload = JSON.parse(raw || "{}") as { transcript?: string; command?: string };
        transcript = String(payload.transcript ?? payload.command ?? "").trim();
      } catch (error) {
        this.send(response, 400, { detail: `JSON invalido: ${String(error)}` });
        return;
      }
      if (!transcript) {
        this.send(response, 400, { detail: "transcript obrigatorio" });
        return;
      }
      // A wake word e exigida por simulateVickCommand; adiciona se vier sem.
      const withWake = /\bvick\b/i.test(transcript) ? transcript : `Vick ${transcript}`;
      this.output.appendLine(`Comando recebido da Vick web: ${withWake}`);
      void this.target.simulateVickCommand(withWake);
      // Responde na hora: a tarefa roda no AdoneX e o progresso aparece no cockpit.
      this.send(response, 202, { accepted: true, routed: withWake });
      return;
    }

    this.send(response, 404, { detail: "rota inexistente" });
  }

  public stop(): void {
    if (!this.server) return;
    this.server.close();
    this.server = undefined;
    this.output.appendLine("Bridge parada.");
  }

  public dispose(): void {
    this.stop();
    this.output.dispose();
  }
}

import * as vscode from "vscode";
import { isSafeIntegrationUrl } from "./urlPolicy";

type Section = "settings" | "apis" | "mcp" | "models" | "memory" | "diagnostics";
interface ApiConfig { id: string; name: string; baseUrl: string; auth: "none" | "bearer" | "api-key"; }
interface McpConfig { id: string; name: string; transport: "stdio" | "http" | "sse" | "streamable-http"; target: string; enabled: boolean; hasSecret: boolean; }
const API_KEY = "adonex.control.apis";
const MCP_KEY = "adonex.control.mcps";

class Item extends vscode.TreeItem {
  public constructor(label: string, state: vscode.TreeItemCollapsibleState, public section?: Section, command?: vscode.Command) {
    super(label, state);
    this.command = command;
  }
}

export class AdoneXControlCenter implements vscode.TreeDataProvider<Item> {
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public register(): vscode.Disposable[] {
    const command = (id: string, callback: (...args: unknown[]) => unknown) => vscode.commands.registerCommand(id, callback);
    return [
      vscode.window.registerTreeDataProvider("adonex.controlCenterView", this),
      command("adonex.control.refresh", () => this.changed.fire(undefined)),
      command("adonex.control.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:synapse-ai.adonex")),
      command("adonex.control.addApi", () => this.addApi()),
      command("adonex.control.gatewaySecret", () => this.gatewaySecret()),
      command("adonex.control.testApi", (item) => this.testApi(item as Item)),
      command("adonex.control.addMcp", () => this.addMcp()),
      command("adonex.control.inspectMcp", (item) => this.inspectMcp(item as Item)),
      command("adonex.control.listModels", () => this.listModels()),
      command("adonex.control.openMemory", () => vscode.commands.executeCommand("adonex.memory.open")),
      command("adonex.control.diagnostics", () => this.diagnostics())
    ];
  }

  public getTreeItem(element: Item): vscode.TreeItem { return element; }
  public getChildren(element?: Item): Item[] {
    if (!element) return [
      this.section("Configurações", "settings"), this.section("APIs", "apis"),
      this.section("MCP", "mcp"), this.section("Modelos Ollama", "models"),
      this.section("Memória", "memory"), this.section("Diagnóstico", "diagnostics")
    ];
    if (element.section === "settings") return [this.action("Abrir configurações do AdoneX", "adonex.control.openSettings", "settings-gear")];
    if (element.section === "apis") return [
      this.connection("Ollama local", vscode.workspace.getConfiguration("adonex").get<string>("ollama.baseUrl", "http://127.0.0.1:11434"), "adonex.ollama.testConnection", "builtin-ollama"),
      this.connection("FastAPI / Synapse Gateway", vscode.workspace.getConfiguration("adonex").get<string>("synapse.llmGateway.baseUrl", "http://127.0.0.1:8000"), "adonex.control.testApi", "builtin-gateway"),
      this.action("Definir credencial do Gateway", "adonex.control.gatewaySecret", "key"),
      this.action("Adicionar API empresarial", "adonex.control.addApi", "add"),
      ...this.apis().map(api => this.connection(api.name, api.baseUrl, "adonex.control.testApi", api.id))
    ];
    if (element.section === "mcp") return [this.action("Adicionar servidor MCP", "adonex.control.addMcp", "add"), ...this.mcps().map(mcp => this.connection(mcp.name, `${mcp.transport}: ${mcp.target}`, "adonex.control.inspectMcp", mcp.id))];
    if (element.section === "models") return [this.action("Consultar modelos instalados", "adonex.control.listModels", "server-environment")];
    if (element.section === "memory") return [this.action("Abrir memória compartilhada", "adonex.control.openMemory", "book")];
    if (element.section === "diagnostics") return [this.action("Executar diagnóstico seguro", "adonex.control.diagnostics", "pulse")];
    return [];
  }

  private section(label: string, section: Section): Item {
    const item = new Item(label, vscode.TreeItemCollapsibleState.Collapsed, section);
    item.iconPath = new vscode.ThemeIcon(section === "diagnostics" ? "pulse" : "folder");
    return item;
  }
  private action(label: string, command: string, icon: string): Item {
    const item = new Item(label, vscode.TreeItemCollapsibleState.None, undefined, { command, title: label });
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
  private connection(label: string, description: string, command: string, id: string): Item {
    const item = this.action(label, command, "plug"); item.description = description; item.contextValue = id; return item;
  }
  private apis(): ApiConfig[] { return this.context.globalState.get<ApiConfig[]>(API_KEY, []); }
  private mcps(): McpConfig[] { return this.context.globalState.get<McpConfig[]>(MCP_KEY, []); }

  private async addApi(): Promise<void> {
    const name = await vscode.window.showInputBox({ title: "AdoneX: nova API", prompt: "Nome da integração" });
    if (!name?.trim()) return;
    const baseUrl = await vscode.window.showInputBox({ title: `API ${name}`, prompt: "URL HTTPS ou endpoint local HTTP" });
    if (!baseUrl?.trim() || !isSafeIntegrationUrl(baseUrl)) throw new Error("Use HTTPS ou um endpoint HTTP local.");
    const auth = await vscode.window.showQuickPick(["none", "bearer", "api-key"] as const, { title: "Autenticação" });
    if (!auth) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (auth !== "none") {
      const secret = await vscode.window.showInputBox({ title: `Credencial de ${name}`, password: true, ignoreFocusOut: true });
      if (!secret) return;
      await this.context.secrets.store(`adonex.api.${id}`, secret);
    }
    await this.context.globalState.update(API_KEY, [...this.apis(), { id, name: name.trim(), baseUrl: baseUrl.trim().replace(/\/$/, ""), auth }]);
    this.changed.fire(undefined);
  }

  private async testApi(item: Item): Promise<void> {
    const api = item.contextValue === "builtin-gateway"
      ? { id: "synapse-gateway", name: "Synapse Gateway", baseUrl: vscode.workspace.getConfiguration("adonex").get<string>("synapse.llmGateway.baseUrl", "http://127.0.0.1:8000"), auth: "api-key" as const }
      : this.apis().find(value => value.id === item.contextValue); if (!api) return;
    const headers: Record<string, string> = {}; const secret = await this.context.secrets.get(api.id === "synapse-gateway" ? "adonex.synapse.gatewayApiKey" : `adonex.api.${api.id}`);
    if (api.auth === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
    if (api.auth === "api-key" && secret) headers["X-API-Key"] = secret;
    const started = Date.now(); const response = await fetch(api.baseUrl, { headers, signal: AbortSignal.timeout(5000) });
    void vscode.window.showInformationMessage(`${api.name}: HTTP ${response.status} em ${Date.now() - started} ms.`);
  }

  private async gatewaySecret(): Promise<void> {
    const secret = await vscode.window.showInputBox({ title: "Credencial do Synapse Gateway", password: true, ignoreFocusOut: true });
    if (!secret) return;
    await this.context.secrets.store("adonex.synapse.gatewayApiKey", secret);
    void vscode.window.showInformationMessage("Credencial do Gateway protegida no SecretStorage.");
  }

  private async addMcp(): Promise<void> {
    const name = await vscode.window.showInputBox({ title: "AdoneX: novo MCP", prompt: "Nome do servidor" }); if (!name?.trim()) return;
    const transport = await vscode.window.showQuickPick(["stdio", "http", "sse", "streamable-http"] as const, { title: "Transporte MCP" }); if (!transport) return;
    const target = await vscode.window.showInputBox({ title: `MCP ${name}`, prompt: transport === "stdio" ? "Comando (não será executado automaticamente)" : "URL do servidor" });
    if (!target?.trim()) return; if (transport !== "stdio" && !isSafeIntegrationUrl(target)) throw new Error("Use HTTPS ou um endpoint HTTP local.");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const auth = transport === "stdio" ? "Sem credencial" : await vscode.window.showQuickPick(["Sem credencial", "Bearer token"] as const, { title: "Autenticação MCP" });
    if (!auth) return;
    let hasSecret = false;
    if (auth === "Bearer token") {
      const secret = await vscode.window.showInputBox({ title: `Credencial de ${name}`, password: true, ignoreFocusOut: true }); if (!secret) return;
      await this.context.secrets.store(`adonex.mcp.${id}`, secret); hasSecret = true;
    }
    await this.context.globalState.update(MCP_KEY, [...this.mcps(), { id, name: name.trim(), transport, target: target.trim(), enabled: false, hasSecret }]); this.changed.fire(undefined);
  }

  private async inspectMcp(item: Item): Promise<void> {
    const mcp = this.mcps().find(value => value.id === item.contextValue); if (!mcp) return;
    const action = await vscode.window.showQuickPick(["Testar", mcp.enabled ? "Desativar" : "Ativar", "Remover"] as const, { title: `${mcp.name} · ${mcp.transport}` });
    if (action === "Testar") {
      if (mcp.transport === "stdio") {
        void vscode.window.showInformationMessage(`${mcp.name}: comando cadastrado e sintaticamente não vazio. Execução requer aprovação explícita.`); return;
      }
      const secret = mcp.hasSecret ? await this.context.secrets.get(`adonex.mcp.${mcp.id}`) : undefined;
      const headers: Record<string, string> = { Accept: "application/json, text/event-stream" }; if (secret) headers.Authorization = `Bearer ${secret}`;
      const response = await fetch(mcp.target, { headers, signal: AbortSignal.timeout(5000) });
      void vscode.window.showInformationMessage(`${mcp.name}: HTTP ${response.status}.`); return;
    }
    if (action === "Ativar" || action === "Desativar") {
      await this.context.globalState.update(MCP_KEY, this.mcps().map(value => value.id === mcp.id ? { ...value, enabled: action === "Ativar" } : value)); this.changed.fire(undefined); return;
    }
    if (action === "Remover") {
      await this.context.secrets.delete(`adonex.mcp.${mcp.id}`); await this.context.globalState.update(MCP_KEY, this.mcps().filter(value => value.id !== mcp.id)); this.changed.fire(undefined);
    }
  }
  private async listModels(): Promise<void> {
    const baseUrl = vscode.workspace.getConfiguration("adonex").get<string>("ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error(`Ollama respondeu HTTP ${response.status}.`);
    const body = await response.json() as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map(model => model.name).filter((name): name is string => Boolean(name));
    await vscode.window.showQuickPick(models.length ? models : ["Nenhum modelo instalado"], { title: "Modelos Ollama locais" });
  }

  private async diagnostics(): Promise<void> {
    const config = vscode.workspace.getConfiguration("adonex");
    const ollama = config.get<string>("ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
    const gateway = config.get<string>("synapse.llmGateway.baseUrl", "http://127.0.0.1:8000").replace(/\/$/, "");
    const probe = async (url: string, headers: Record<string, string> = {}): Promise<string> => {
      try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) }); return `HTTP ${response.status}`; }
      catch (error) { return `indisponível (${error instanceof Error ? error.message : String(error)})`; }
    };
    const gatewaySecret = await this.context.secrets.get("adonex.synapse.gatewayApiKey");
    const [ollamaStatus, gatewayStatus] = await Promise.all([
      probe(`${ollama}/api/tags`),
      probe(gateway, gatewaySecret ? { "X-API-Key": gatewaySecret } : {})
    ]);
    const report = ["# Diagnóstico AdoneX", "", `- Ollama: ${ollamaStatus}`, `- Synapse Gateway: ${gatewayStatus}`, `- APIs cadastradas: ${this.apis().length}`, `- MCPs cadastrados: ${this.mcps().length}`, `- MCPs ativos: ${this.mcps().filter(value => value.enabled).length}`, "- Credenciais: SecretStorage (valores não exibidos)", "- Geração: Ollama local exclusivo", "- Risco alto: MCP stdio nunca é executado pelo diagnóstico"].join("\n");
    const document = await vscode.workspace.openTextDocument({ language: "markdown", content: report }); await vscode.window.showTextDocument(document, { preview: true });
  }}

import argparse
import json
import socket
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


HTML = """<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vick | Synapse</title>
  <style>
    :root { color-scheme: dark; --bg: #0b0f14; --panel: #111923; --line: #273242; --text: #e8eef7; --muted: #8fa3b8; --accent: #38bdf8; --ok: #22c55e; --warn: #f59e0b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: Segoe UI, system-ui, sans-serif; color: var(--text); background: radial-gradient(circle at 15% 0%, #122132, transparent 34%), var(--bg); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--line); background: rgba(8, 13, 20, .86); backdrop-filter: blur(16px); }
    .brand { display: grid; gap: 2px; }
    .brand strong { font-size: 22px; }
    .brand span, .status span, label { color: var(--muted); font-size: 12px; }
    .status { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: rgba(17, 25, 35, .72); }
    .bars { display: grid; grid-template-columns: repeat(5, 4px); align-items: end; gap: 3px; height: 26px; }
    .bars i { display: block; min-height: 7px; border-radius: 2px; background: var(--accent); animation: level .82s ease-in-out infinite alternate; }
    .bars i:nth-child(2) { height: 16px; animation-delay: .08s; } .bars i:nth-child(3) { height: 25px; animation-delay: .16s; } .bars i:nth-child(4) { height: 13px; animation-delay: .24s; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; width: min(1180px, calc(100vw - 32px)); margin: 18px auto; }
    section { border: 1px solid var(--line); border-radius: 8px; background: rgba(17, 25, 35, .78); box-shadow: 0 20px 60px rgba(0,0,0,.28); }
    .dialog { display: grid; grid-template-rows: auto 1fr auto; min-height: calc(100vh - 112px); }
    h1, h2 { margin: 0; font-size: 15px; }
    .section-head { padding: 14px 16px; border-bottom: 1px solid var(--line); }
    #history { display: grid; align-content: start; gap: 12px; padding: 16px; overflow: auto; }
    .msg { padding: 10px 12px; border-left: 3px solid var(--accent); background: rgba(255,255,255,.035); white-space: pre-wrap; line-height: 1.45; }
    .msg.user { border-color: var(--ok); }
    .composer { display: grid; gap: 10px; padding: 14px; border-top: 1px solid var(--line); }
    textarea, input, select, button { width: 100%; color: var(--text); background: #0d141d; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
    textarea { min-height: 92px; resize: vertical; padding: 10px; }
    input, select { min-height: 36px; padding: 8px; }
    button { min-height: 36px; cursor: pointer; font-weight: 650; }
    button.primary { color: #031018; background: var(--accent); border-color: var(--accent); }
    .grid { display: grid; gap: 10px; padding: 14px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 11px; }
    @keyframes level { from { transform: scaleY(.45); opacity: .55; } to { transform: scaleY(1); opacity: 1; } }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } .dialog { min-height: 60vh; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><strong>Vick</strong><span>Synapse Solution Factory</span></div>
    <div class="status"><div class="bars"><i></i><i></i><i></i><i></i><i></i></div><span id="state">ouvindo: Vick</span></div>
  </header>
  <main>
    <section class="dialog">
      <div class="section-head"><h1>Criação de soluções corporativas</h1></div>
      <div id="history"></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Diga ou escreva: Vick, crie um projeto para..."></textarea>
        <div class="two">
          <button id="send" class="primary">Enviar para Vick</button>
          <button id="voice">Ativar microfone</button>
        </div>
      </div>
    </section>
    <section>
      <div class="section-head"><h2>Briefing</h2></div>
      <div class="grid">
        <label>Objetivo do projeto<input id="goal"></label>
        <label>Problema de negócio<input id="problem"></label>
        <label>Universo<select id="universe"><option>Híbrido</option><option>ML</option><option>IA/RAG/Agentes</option><option>Chatbolt</option></select></label>
        <label>Métrica de sucesso<input id="metric"></label>
        <label>Dados/fontes disponíveis<input id="sources"></label>
        <label>Risco<select id="risk"><option>médio</option><option>baixo</option><option>alto</option><option>crítico</option></select></label>
        <button id="brief" class="primary">Preparar briefing</button>
        <div class="hint">A Vick coleta o briefing aqui e mantém o fluxo oficial em VS Code Chat, AdoneX, Claude Code ou Codex antes da implementação.</div>
        <span class="pill" id="workspace"></span>
      </div>
    </section>
  </main>
  <script>
    const history = document.getElementById("history");
    const promptBox = document.getElementById("prompt");
    const state = document.getElementById("state");
    const workspace = document.getElementById("workspace");
    let recognition;
    function add(kind, text) {
      const item = document.createElement("div");
      item.className = "msg " + kind;
      item.textContent = text;
      history.appendChild(item);
      item.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    async function post(path, body) {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return response.json();
    }
    async function send(text) {
      const value = (text || promptBox.value).trim();
      if (!value) return;
      add("user", value);
      state.textContent = "pensando";
      const result = await post("/api/message", { text: value });
      add("assistant", result.reply);
      state.textContent = "ouvindo: " + result.wake_word;
      promptBox.value = "";
    }
    document.getElementById("send").onclick = () => send();
    document.getElementById("brief").onclick = () => {
      const text = `Vick, preparar novo projeto corporativo. Objetivo: ${goal.value}. Problema de negócio: ${problem.value}. Universo: ${universe.value}. Métrica de sucesso: ${metric.value}. Dados/fontes: ${sources.value}. Risco: ${risk.value}.`;
      send(text);
    };
    document.getElementById("voice").onclick = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { add("assistant", "Reconhecimento de voz do navegador indisponível. Use o campo de texto da Vick."); return; }
      recognition = recognition || new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => state.textContent = "ouvindo microfone";
      recognition.onresult = event => send(event.results[0][0].transcript);
      recognition.onerror = event => add("assistant", "Falha no microfone: " + event.error);
      recognition.onend = () => state.textContent = "ouvindo: Vick";
      recognition.start();
    };
    fetch("/api/status").then(r => r.json()).then(data => {
      workspace.textContent = data.workspace_name;
      add("assistant", data.greeting);
    });
  </script>
</body>
</html>
"""


class VickHandler(BaseHTTPRequestHandler):
    workspace: Path
    wake_word: str

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/status":
            self._json(
                {
                    "name": "Vick",
                    "wake_word": self.wake_word,
                    "workspace": str(self.workspace),
                    "workspace_name": self.workspace.name,
                    "greeting": (
                        "Oi, eu sou a Vick. Estou carregada no Synapse para ajudar a criar "
                        "solucoes corporativas com briefing, arquitetura, agentes, pipelines e templates."
                    ),
                }
            )
            return
        self._html(HTML)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/message":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        text = str(payload.get("text", "")).strip()
        reply = build_reply(text, self.wake_word, self.workspace)
        append_memory(self.workspace, text, reply)
        self._json({"reply": reply, "wake_word": self.wake_word})

    def _html(self, content: str) -> None:
        data = content.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def build_reply(text: str, wake_word: str, workspace: Path) -> str:
    clean = text.strip()
    lowered = clean.lower()
    if lowered.startswith(wake_word.lower()):
        clean = clean[len(wake_word):].lstrip(" ,;:-")
    missing = []
    checks = {
        "objetivo do projeto": ("objetivo", "goal"),
        "problema de negocio": ("problema", "negocio", "negócio"),
        "universo": ("universo", "ml", "rag", "agente", "chatbolt", "hibrido", "híbrido"),
        "metrica de sucesso": ("metrica", "métrica", "kpi", "sucesso"),
        "dados/fontes disponiveis": ("dados", "fontes", "documentos", "base"),
        "nivel de risco": ("risco", "baixo", "medio", "médio", "alto", "critico", "crítico"),
    }
    normalized = lowered
    for label, terms in checks.items():
        if not any(term in normalized for term in terms):
            missing.append(label)
    if missing:
        return (
            "Consigo preparar a solucao, mas ainda preciso completar o briefing minimo do Synapse.\n\n"
            + "Campos faltantes: "
            + ", ".join(missing)
            + ".\n\nUse este navegador para rascunhar, e confirme pelo VS Code Chat, AdoneX, Claude Code ou Codex antes da implementacao."
        )
    return (
        "Briefing inicial recebido. Proximo passo: confirmar este conteudo em um canal autorizado "
        "(VS Code Chat, AdoneX, Claude Code ou Codex), executar o BusinessSolutionAnalyzer e gerar "
        "`config/business_solution_analysis.json` e `docs/briefings/business_solution_analysis.md` no projeto."
    )


def append_memory(workspace: Path, text: str, reply: str) -> None:
    memory = workspace / ".adonex" / "memory" / "CHAT_TASKS.md"
    memory.parent.mkdir(parents=True, exist_ok=True)
    with memory.open("a", encoding="utf-8") as handle:
        handle.write(f"\n- Vick browser | user: {text[:240]} | reply: {reply[:240]}\n")


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the local Vick browser assistant.")
    parser.add_argument("--workspace", default=".", help="Workspace root.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--wake-word", default="Vick")
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    port = args.port if port_available(args.port) else args.port + 1
    VickHandler.workspace = workspace
    VickHandler.wake_word = args.wake_word
    server = ThreadingHTTPServer(("127.0.0.1", port), VickHandler)
    url = f"http://127.0.0.1:{port}"
    if args.open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"Vick running at {url} for {workspace}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

const vscode = acquireVsCodeApi();
const prompt = document.getElementById("prompt");
const estimate = document.getElementById("estimate");
const history = document.getElementById("history");
const activeModel = document.getElementById("activeModel");
const sendButton = document.getElementById("send");
const attachButton = document.getElementById("attach");
const memoryButton = document.getElementById("memory");
const mentionButton = document.getElementById("mention");
const attachments = document.getElementById("attachments");
const memoryPanel = document.getElementById("memoryPanel");
const memoryHistory = document.getElementById("memoryHistory");
const closeMemory = document.getElementById("closeMemory");
const resumeTask = document.getElementById("resumeTask");
const mode = document.getElementById("mode");
let selectedSharedTask = "";

const viewChatTab = document.getElementById("viewChat");
const viewComposerTab = document.getElementById("viewComposer");
const chatView = document.getElementById("history");
const composerView = document.getElementById("composerView");
const composerGoal = document.getElementById("composerGoal");
const composerGenerateBtn = document.getElementById("composerGenerate");
const composerCancelBtn = document.getElementById("composerCancel");
const composerStatus = document.getElementById("composerStatus");
const composerResult = document.getElementById("composerResult");
const composerSummary = document.getElementById("composerSummary");
const composerStats = document.getElementById("composerStats");
const composerSelectAll = document.getElementById("composerSelectAll");
const composerModel = document.getElementById("composerModel");
const composerFiles = document.getElementById("composerFiles");
const composerCommands = document.getElementById("composerCommands");
const composerApplyBtn = document.getElementById("composerApply");
const composerUndoBtn = document.getElementById("composerUndo");
const composerDiscardBtn = document.getElementById("composerDiscard");
const composerRefineInput = document.getElementById("composerRefineInput");
const composerRefineBtn = document.getElementById("composerRefine");
const chatComposer = document.querySelector(".composer");

const kindLabel = { create: "novo", modify: "alterado", delete: "removido" };

function setView(view) {
  const composer = view === "composer";
  viewChatTab.classList.toggle("active", !composer);
  viewComposerTab.classList.toggle("active", composer);
  viewChatTab.setAttribute("aria-selected", String(!composer));
  viewComposerTab.setAttribute("aria-selected", String(composer));
  chatView.hidden = composer;
  composerView.hidden = !composer;
  if (chatComposer) chatComposer.hidden = composer;
  if (composer) composerGoal.focus();
}

viewChatTab.addEventListener("click", () => setView("chat"));
viewComposerTab.addEventListener("click", () => setView("composer"));

function composerBusy(busy) {
  composerGenerateBtn.disabled = busy;
  composerRefineBtn.disabled = busy;
  composerApplyBtn.disabled = busy;
  composerCancelBtn.hidden = !busy;
}

function showComposerStatus(text, kind) {
  composerStatus.hidden = !text;
  composerStatus.textContent = text || "";
  composerStatus.className = `composer-status${kind ? ` ${kind}` : ""}`;
}

composerGenerateBtn.addEventListener("click", () => {
  const task = composerGoal.value.trim();
  if (!task) return;
  composerBusy(true);
  showComposerStatus("Planejando mudancas multi-arquivo...", "busy");
  vscode.postMessage({ type: "composerGenerate", task, mode: mode.value });
});

composerCancelBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
  composerBusy(false);
  showComposerStatus("Cancelado.", "");
});

composerRefineBtn.addEventListener("click", () => {
  const task = composerRefineInput.value.trim();
  if (!task) return;
  composerBusy(true);
  showComposerStatus("Refinando a proposta...", "busy");
  vscode.postMessage({ type: "composerRefine", task, mode: mode.value });
});

composerApplyBtn.addEventListener("click", () => {
  composerBusy(true);
  showComposerStatus("Aplicando arquivos selecionados...", "busy");
  vscode.postMessage({ type: "composerApply" });
});

composerUndoBtn.addEventListener("click", () => vscode.postMessage({ type: "composerUndo" }));

composerDiscardBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "composerDiscard" });
  composerResult.hidden = true;
  composerFiles.replaceChildren();
});

composerSelectAll.addEventListener("change", () => {
  const selected = composerSelectAll.checked;
  vscode.postMessage({ type: "composerSelectAll", selected });
  composerFiles.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.checked = selected;
  });
});

function renderComposerFiles(files) {
  composerFiles.replaceChildren();
  for (const file of files) {
    const card = document.createElement("div");
    card.className = `composer-file kind-${file.changeKind}`;

    const head = document.createElement("div");
    head.className = "composer-file-head";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = file.selected;
    check.addEventListener("change", () => {
      vscode.postMessage({ type: "composerToggle", path: file.path, selected: check.checked });
    });
    const badge = document.createElement("span");
    badge.className = `composer-badge ${file.changeKind}`;
    badge.textContent = kindLabel[file.changeKind] || file.changeKind;
    const name = document.createElement("span");
    name.className = "composer-file-path";
    name.textContent = file.path;
    const stat = document.createElement("span");
    stat.className = "composer-file-stat";
    stat.textContent = `+${file.additions} −${file.deletions}`;
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "composer-open";
    openBtn.textContent = "Ver diff";
    openBtn.addEventListener("click", () =>
      vscode.postMessage({ type: "composerOpenDiff", path: file.path })
    );
    head.append(check, badge, name, stat, openBtn);

    const pre = document.createElement("pre");
    pre.className = "composer-file-preview";
    pre.textContent = file.preview || "(sem preview)";

    card.append(head, pre);
    composerFiles.appendChild(card);
  }
}

const persisted = vscode.getState() || {};
const messages = Array.isArray(persisted.messages)
  ? persisted.messages.filter((item) => item && ["user", "assistant", "error"].includes(item.kind))
  : [];
for (const message of messages) addMessage(message.kind, message.text, false);
vscode.setState({ messages });

prompt.addEventListener("input", () => {
  estimate.textContent = `Entrada estimada: ${prompt.value ? Math.max(1, Math.ceil(prompt.value.length / 4)) : 0} tokens`;
});

function insertAtPrompt(token) {
  if (!token) return;
  const start = prompt.selectionStart ?? prompt.value.length;
  const end = prompt.selectionEnd ?? prompt.value.length;
  prompt.value = `${prompt.value.slice(0, start)}${token}${prompt.value.slice(end)}`;
  const caret = start + token.length;
  prompt.setSelectionRange(caret, caret);
  prompt.focus();
  estimate.textContent = `Entrada estimada: ${prompt.value ? Math.max(1, Math.ceil(prompt.value.length / 4)) : 0} tokens`;
}

let chatBusy = false;

function setChatBusy(busy) {
  chatBusy = busy;
  sendButton.textContent = busy ? "Parar" : "Enviar";
  sendButton.classList.toggle("stop", busy);
  sendButton.setAttribute("aria-label", busy ? "Parar processo" : "Enviar mensagem");
  showThinking(busy, "Pensando...");
}

function showThinking(show, label) {
  let el = document.getElementById("thinking");
  if (show) {
    if (!el) {
      history.querySelector(".empty-state")?.remove();
      el = document.createElement("article");
      el.id = "thinking";
      el.className = "message assistant thinking";
      const strong = document.createElement("strong");
      strong.textContent = "AdoneX";
      const row = document.createElement("div");
      row.className = "thinking-row";
      const dots = document.createElement("span");
      dots.className = "dots";
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      const text = document.createElement("span");
      text.className = "thinking-label";
      text.textContent = label || "Pensando...";
      row.append(dots, text);
      el.append(strong, row);
      history.appendChild(el);
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (label) {
      const text = el.querySelector(".thinking-label");
      if (text) text.textContent = label;
    }
  } else if (el) {
    el.remove();
  }
}

function sendMessage() {
  if (chatBusy) return;
  const task = prompt.value.trim();
  if (!task) return;
  addMessage("user", task);
  vscode.postMessage({ type: "send", task, mode: "local" });
  prompt.value = "";
  estimate.textContent = "Entrada estimada: 0 tokens";
  setChatBusy(true);
  prompt.focus();
}

sendButton.addEventListener("click", () => {
  if (chatBusy) {
    vscode.postMessage({ type: "stop" });
    return;
  }
  sendMessage();
});
attachButton.addEventListener("click", () => vscode.postMessage({ type: "selectAttachments" }));
memoryButton.addEventListener("click", () => vscode.postMessage({ type: "openSharedMemory" }));
mentionButton.addEventListener("click", () => vscode.postMessage({ type: "mentionPick" }));
closeMemory.addEventListener("click", () => { memoryPanel.hidden = true; });
resumeTask.addEventListener("click", () => {
  if (!selectedSharedTask) return;
  vscode.postMessage({ type: "resumeSharedTask", task: selectedSharedTask });
  memoryPanel.hidden = true;
});
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

window.addEventListener("message", ({ data }) => {
  if (data.type === "chatResponse") {
    setChatBusy(false);
    if (activeModel && data.model) activeModel.textContent = `${data.provider || "ollama"}/${data.model}`;
    addMessage("assistant", data.text);
  } else if (data.type === "stopped") {
    setChatBusy(false);
    composerBusy(false);
    if (!composerView.hidden) showComposerStatus(data.text || "Processo interrompido.", "");
    addMessage("assistant", data.text || "Processo interrompido.");
  } else if (data.type === "status") {
    if (chatBusy) showThinking(true, data.text);
  } else if (data.type === "error") {
    setChatBusy(false);
    composerBusy(false);
    if (!composerView.hidden) showComposerStatus(data.text, "error");
    addMessage("error", data.text);
  } else if (data.type === "attachments") {
    renderAttachments(Array.isArray(data.files) ? data.files : []);
  } else if (data.type === "sharedHistory") {
    renderSharedHistory(Array.isArray(data.entries) ? data.entries : []);
  } else if (data.type === "insertMention") {
    insertAtPrompt(data.token || "");
  } else if (data.type === "setView") {
    setView(data.view);
  } else if (data.type === "composerState") {
    if (data.state !== "planning" && data.state !== "applying") composerBusy(false);
    showComposerStatus(data.text, data.state === "error" ? "error" : "");
    if (data.state === "idle") {
      composerResult.hidden = true;
      composerFiles.replaceChildren();
    }
  } else if (data.type === "composerProposal") {
    composerBusy(false);
    renderComposerProposal(data);
  } else if (data.type === "composerApplied") {
    composerBusy(false);
    const applied = Array.isArray(data.appliedPaths) ? data.appliedPaths : [];
    showComposerStatus(`Aplicado: ${applied.length} arquivo(s).`, "ok");
    composerUndoBtn.hidden = applied.length === 0;
    if (activeModel && data.model) activeModel.textContent = data.model;
  }
});

function renderComposerProposal(data) {
  const files = Array.isArray(data.files) ? data.files : [];
  composerResult.hidden = false;
  composerUndoBtn.hidden = true;
  showComposerStatus("", "");
  composerSummary.textContent = data.summary || "Proposta gerada.";
  composerModel.textContent = data.model || "";
  const add = files.reduce((sum, file) => sum + (file.additions || 0), 0);
  const del = files.reduce((sum, file) => sum + (file.deletions || 0), 0);
  composerStats.textContent = `${files.length} arquivo(s) · +${add} −${del}`;
  composerSelectAll.checked = files.every((file) => file.selected);
  renderComposerFiles(files);
  const commands = Array.isArray(data.commands) ? data.commands : [];
  composerCommands.hidden = commands.length === 0;
  composerCommands.replaceChildren();
  if (commands.length) {
    const title = document.createElement("span");
    title.className = "composer-commands-title";
    title.textContent = "Validacao sugerida:";
    composerCommands.appendChild(title);
    for (const command of commands) {
      const chip = document.createElement("code");
      chip.textContent = command;
      composerCommands.appendChild(chip);
    }
  }
}

function renderSharedHistory(entries) {
  memoryHistory.replaceChildren();
  selectedSharedTask = "";
  resumeTask.disabled = true;
  memoryPanel.hidden = false;
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum registro compartilhado foi encontrado.";
    memoryHistory.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `memory-entry ${["pending", "received", "briefing", "blocked"].includes(entry.status) ? "pending" : ""}`;
    const meta = document.createElement("span");
    meta.className = "memory-entry-meta";
    meta.textContent = `${entry.source} · ${entry.status}`;
    const summary = document.createElement("span");
    summary.textContent = entry.summary;
    item.append(meta, summary);
    item.addEventListener("click", () => {
      memoryHistory.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
      item.classList.add("selected");
      selectedSharedTask = entry.task || entry.summary;
      resumeTask.disabled = false;
    });
    memoryHistory.appendChild(item);
  }
}

function renderAttachments(files) {
  attachments.replaceChildren();
  attachments.hidden = files.length === 0;
  if (!files.length) return;
  const label = document.createElement("span");
  label.textContent = files.map((name) => `📎 ${name}`).join("  ");
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Limpar";
  clear.addEventListener("click", () => vscode.postMessage({ type: "clearAttachments" }));
  attachments.append(label, clear);
}

function addMessage(kind, text, persist = true) {
  if (typeof text !== "string" || !text.trim()) return;
  history.querySelector(".empty-state")?.remove();
  const item = document.createElement("article");
  item.className = `message ${kind}`;
  const label = document.createElement("strong");
  label.textContent = kind === "user" ? "Você" : kind === "assistant" ? "AdoneX" : "Erro";
  const content = document.createElement("pre");
  content.textContent = text;
  item.append(label, content);
  history.appendChild(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
  if (persist) {
    const current = vscode.getState() || {};
    const saved = Array.isArray(current.messages)
      ? current.messages.filter((entry) => entry && ["user", "assistant", "error"].includes(entry.kind)).slice(-99)
      : [];
    saved.push({ kind, text });
    vscode.setState({ messages: saved });
  }
}

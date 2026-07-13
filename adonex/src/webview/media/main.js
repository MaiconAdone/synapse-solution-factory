const vscode = acquireVsCodeApi();
const prompt = document.getElementById("prompt");
const mode = document.getElementById("mode");
const estimate = document.getElementById("estimate");
const history = document.getElementById("history");
const planSection = document.getElementById("plan");
const planText = document.getElementById("planText");
const diffSection = document.getElementById("diff");
const diffText = document.getElementById("diffText");
const validationSection = document.getElementById("validation");
const validationText = document.getElementById("validationText");
const fixFromError = document.getElementById("fixFromError");
const finalSection = document.getElementById("final");
const lifecycleSection = document.getElementById("lifecycle");
const lifecycleSteps = document.getElementById("lifecycleSteps");
const synapseStatus = document.getElementById("synapseStatus");
const vickCockpit = document.getElementById("vickCockpit");
const vickState = document.getElementById("vickState");
const stateBadge = document.createElement("div");
stateBadge.id = "stateBadge";
stateBadge.className = "state-badge";
stateBadge.textContent = "Ready";
const header = document.querySelector("header");
if (header) {
  header.appendChild(stateBadge);
}

prompt.addEventListener("input", () => {
  estimate.textContent = `Estimated input: ${Math.max(1, Math.ceil(prompt.value.length / 4))} tokens before workspace context`;
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const task = prompt.value.trim();
    if (!task) return;
    addMessage("user", task);
    vscode.postMessage({
      type: "plan",
      task,
      action: button.dataset.action,
      mode: mode.value
    });
  });
});

document.getElementById("approve").addEventListener("click", () => {
  vscode.postMessage({ type: "approve" });
});
document.getElementById("reject").addEventListener("click", () => {
  vscode.postMessage({ type: "reject" });
  planSection.hidden = true;
});
document.getElementById("cancelPlan").addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
});
document.getElementById("vickStart").addEventListener("click", () => {
  vscode.postMessage({ type: "vickStart" });
});
document.getElementById("vickStop").addEventListener("click", () => {
  vscode.postMessage({ type: "vickStop" });
});
document.getElementById("vickMute").addEventListener("click", () => {
  vscode.postMessage({ type: "vickMute" });
});
document.getElementById("vickSimulate").addEventListener("click", () => {
  const task = prompt.value.trim();
  if (!task) return;
  addMessage("user", `Vick ${task}`);
  vscode.postMessage({ type: "vickSimulate", task: `Vick ${task}` });
});
document.getElementById("previewPatch").addEventListener("click", () => {
  vscode.postMessage({ type: "previewPatch" });
});
document.getElementById("applyPatch").addEventListener("click", () => {
  vscode.postMessage({ type: "applyPatch" });
});
document.getElementById("undoPatch").addEventListener("click", () => {
  vscode.postMessage({ type: "undoPatch" });
});
document.getElementById("runTests").addEventListener("click", () => {
  vscode.postMessage({ type: "runTests" });
});
document.getElementById("runTestsStandalone").addEventListener("click", () => {
  vscode.postMessage({ type: "runTests" });
});
fixFromError.addEventListener("click", () => {
  vscode.postMessage({ type: "fixFromError" });
});

window.addEventListener("message", ({ data }) => {
  if (data.type === "plan") {
    setState("Planned", "info");
    planSection.hidden = false;
    planText.textContent = JSON.stringify(data.plan, null, 2);
    if (data.synapse?.active) {
      synapseStatus.hidden = false;
      synapseStatus.textContent = data.synapse.detected
        ? `Synapse Mode detected (${Math.round(data.synapse.confidence * 100)}%): ${data.synapse.signals.join(", ")}`
        : "Synapse Mode explicitly active. Workspace assumptions will be validated.";
    } else {
      synapseStatus.hidden = true;
    }
  } else if (data.type === "response") {
    setState("Responded", "success");
    const proposalSummary = data.proposalSummary ? `\n\nProposal summary: ${data.proposalSummary}` : "";
    const spoken = data.spokenDiffSummary ? `\n\nVoice summary: ${data.spokenDiffSummary}` : "";
    addMessage("assistant", `${data.text}\n\nProvider: ${data.provider} / ${data.model}${proposalSummary}${spoken}`);
    validationSection.hidden = false;
    if (data.hasPatch) {
      diffSection.hidden = false;
      renderDiff(data.diff || "");
    }
  } else if (data.type === "diff") {
    setState("Patch preview", "info");
    addMessage("status", "Patch preview ready. Review the diff before applying it.");
    diffSection.hidden = false;
    renderDiff(data.text);
  } else if (data.type === "testResult") {
    setState(data.result.exitCode === 0 ? "Validated" : "Validation failed", data.result.exitCode === 0 ? "success" : "error");
    validationSection.hidden = false;
    validationText.textContent = [
      `Command: ${data.result.command}`,
      `Exit code: ${data.result.exitCode}`,
      `Duration: ${data.result.durationMs} ms`,
      "",
      data.result.stdout,
      data.result.stderr
    ].filter(Boolean).join("\n");
  } else if (data.type === "testFailure") {
    setState("Needs fix", "error");
    validationSection.hidden = false;
    fixFromError.hidden = false;
    validationText.textContent = `Failed: ${data.command}\n\n${data.text}`;
  } else if (data.type === "final") {
    setState("Completed", "success");
    finalSection.hidden = false;
    document.getElementById("finalSummary").textContent = data.summary || "";
    document.getElementById("commitSuggestion").textContent =
      data.commitSuggestion || "No commit suggested.";
    document.getElementById("taskCost").textContent =
      `Task cost: $${Number(data.cost.actualEstimatedCostUsd || 0).toFixed(6)} ` +
      `(${data.cost.actualInputTokens || 0} input / ${data.cost.actualOutputTokens || 0} output tokens)`;
    fixFromError.hidden = true;
  } else if (data.type === "error") {
    setState("Error", "error");
    addMessage("error", data.text);
  } else if (data.type === "lifecycle") {
    renderLifecycle(data.lifecycle || []);
  } else if (data.type === "status") {
    addMessage("status", data.text);
  } else if (data.type === "voiceState") {
    setState(data.state || "Ready", stateTone(data.state));
    addMessage("status", data.text);
  } else if (data.type === "vickState") {
    setVickState(data);
  }
});

function setState(label, tone) {
  if (!stateBadge) return;
  stateBadge.textContent = label;
  stateBadge.className = `state-badge ${tone}`;
}

function stateTone(state) {
  if (state === "awaiting_confirmation") return "info";
  if (state === "cancelled") return "error";
  if (state === "editing" || state === "validating" || state === "thinking") return "info";
  return "success";
}

function setVickState(data) {
  if (!vickCockpit || !vickState) return;
  vickState.textContent = `${data.state || "standby"} | wake: ${data.wakeWord || "Vick"} | ${data.engine || "simulated"}`;
  vickCockpit.dataset.state = data.state || "asleep";
  const muteButton = document.getElementById("vickMute");
  if (muteButton) {
    muteButton.textContent = data.muted ? "Unmute" : "Mute";
  }
  if (data.text) {
    setState(`Vick: ${data.state || "ready"}`, stateTone(data.state));
  }
}

function renderLifecycle(steps) {
  if (!lifecycleSection || !lifecycleSteps) return;
  lifecycleSection.hidden = false;
  lifecycleSteps.replaceChildren();
  for (const step of steps) {
    const item = document.createElement("article");
    item.className = `lifecycle-step ${step.state || "pending"}`;
    const title = document.createElement("strong");
    title.textContent = step.title || step.phase;
    const state = document.createElement("span");
    state.textContent = step.state || "pending";
    const detail = document.createElement("p");
    detail.textContent = step.detail || "";
    item.append(title, state, detail);
    lifecycleSteps.appendChild(item);
  }
}

function addMessage(kind, text) {
  const item = document.createElement("article");
  item.className = `message ${kind}`;
  const label = document.createElement("strong");
  label.textContent =
    kind === "user" ? "You" : kind === "assistant" ? "AdoneX" : "Status";
  const content = document.createElement("pre");
  content.textContent = text;
  item.append(label, content);
  history.appendChild(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
}

function renderDiff(diff) {
  diffText.replaceChildren();
  for (const line of String(diff).split("\n")) {
    const row = document.createElement("div");
    row.className = line.startsWith("+") && !line.startsWith("+++")
      ? "diff-add"
      : line.startsWith("-") && !line.startsWith("---")
        ? "diff-remove"
        : line.startsWith("@@")
          ? "diff-hunk"
          : "diff-meta";
    row.textContent = line || " ";
    diffText.appendChild(row);
  }
}

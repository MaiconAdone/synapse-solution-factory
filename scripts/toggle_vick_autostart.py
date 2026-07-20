"""Ativa, desativa ou consulta o autostart da Vick no VS Code."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

TASK_LABEL = "Vick: Abrir assistente web automaticamente"

def set_autostart(action: str, path: Path | None = None) -> bool:
    target = path or Path(__file__).resolve().parents[1] / ".vscode" / "tasks.json"
    data = json.loads(target.read_text(encoding="utf-8-sig"))
    task = next((item for item in data.get("tasks", []) if item.get("label") == TASK_LABEL), None)
    if task is None:
        raise RuntimeError(f'Task "{TASK_LABEL}" nao encontrada em {target}.')
    if action == "enable":
        task.setdefault("runOptions", {})["runOn"] = "folderOpen"
    elif action == "disable":
        task.get("runOptions", {}).pop("runOn", None)
        if not task.get("runOptions"):
            task.pop("runOptions", None)
    elif action != "status":
        raise ValueError(f"Acao desconhecida: {action}")
    enabled = task.get("runOptions", {}).get("runOn") == "folderOpen"
    if action != "status":
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return enabled

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("enable", "disable", "status"))
    args = parser.parse_args()
    print(json.dumps({"enabled": set_autostart(args.action), "task": TASK_LABEL}, ensure_ascii=False))

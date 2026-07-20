import json

from scripts.toggle_vick_autostart import TASK_LABEL, set_autostart


def test_toggle_vick_autostart(tmp_path):
    target = tmp_path / "tasks.json"
    target.write_text(json.dumps({"tasks": [{"label": TASK_LABEL}]}), encoding="utf-8")
    assert set_autostart("enable", target) is True
    assert json.loads(target.read_text(encoding="utf-8"))["tasks"][0]["runOptions"] == {"runOn": "folderOpen"}
    assert set_autostart("disable", target) is False
    assert "runOptions" not in json.loads(target.read_text(encoding="utf-8"))["tasks"][0]


def test_status_does_not_rewrite_file(tmp_path):
    target = tmp_path / "tasks.json"
    original = json.dumps({"tasks": [{"label": TASK_LABEL, "runOptions": {"runOn": "folderOpen"}}]}, indent=4)
    target.write_text(original, encoding="utf-8")
    assert set_autostart("status", target) is True
    assert target.read_text(encoding="utf-8") == original

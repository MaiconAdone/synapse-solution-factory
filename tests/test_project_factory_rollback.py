"""Rollback/compensation tests for the project-factory creation transaction.

If a build phase fails after scaffolding started, create_ai_project.ps1 must
remove the partial project directory instead of leaving a half-built project.
A build against an empty template deterministically fails at the AdoneX runtime
copy (after the destination was created), which must trigger the rollback.
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "create_ai_project.ps1"


def test_create_ai_project_rolls_back_partial_directory_on_failure(tmp_path):
    empty_template = tmp_path / "empty_template"
    empty_template.mkdir()
    dest_base = tmp_path / "dest"
    dest_base.mkdir()

    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-NomeProjeto",
            "rollback_probe",
            "-TipoProjeto",
            "IA",
            "-DestinoBase",
            str(dest_base),
            "-Template",
            str(empty_template),
            "-SkipValidation",
            "-SkipActivation",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )

    output = completed.stdout + completed.stderr
    assert completed.returncode != 0, output
    assert not (dest_base / "rollback_probe").exists(), "partial project was not rolled back"
    assert "Rollback" in output


def test_create_ai_project_preserves_preexisting_directory_on_failure(tmp_path):
    empty_template = tmp_path / "empty_template"
    empty_template.mkdir()
    dest_base = tmp_path / "dest"
    dest_base.mkdir()
    preexisting = dest_base / "rollback_probe"
    preexisting.mkdir()
    sentinel = preexisting / "keep.txt"
    sentinel.write_text("do not delete", encoding="utf-8")

    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-NomeProjeto",
            "rollback_probe",
            "-TipoProjeto",
            "IA",
            "-DestinoBase",
            str(dest_base),
            "-Template",
            str(empty_template),
            "-SkipValidation",
            "-SkipActivation",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )

    output = completed.stdout + completed.stderr
    assert completed.returncode != 0, output
    # A destination that already existed must never be deleted by rollback.
    assert sentinel.exists(), "rollback deleted a pre-existing directory"
    assert sentinel.read_text(encoding="utf-8") == "do not delete"

"""Unit tests for the extracted project-factory universe logic.

Resolve-ProjectUniverse was pulled out of the oversized create_ai_project.ps1
into scripts/project_factory/ProjectFactory.Common.ps1 precisely so this pure
decision function can be exercised in isolation, without generating a project.
"""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / "scripts" / "project_factory" / "ProjectFactory.Common.ps1"


def _resolve(universe_input: str) -> dict:
    command = (
        f". '{COMMON}'; "
        f"Resolve-ProjectUniverse '{universe_input}' | ConvertTo-Json -Compress"
    )
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize(
    ("requested", "expected_universe", "expected_caps"),
    [
        ("ML", "ml", {"ml_enabled": True, "ai_enabled": False, "rag_enabled": False}),
        ("IA", "ia", {"ml_enabled": False, "ai_enabled": True, "rag_enabled": True}),
        (
            "ML + IA (Hibrido)",
            "hybrid",
            {"ml_enabled": True, "ai_enabled": True, "rag_enabled": True},
        ),
        ("Chatbolt", "chatbolt", {"ml_enabled": False, "ai_enabled": True, "rag_enabled": True}),
    ],
)
def test_resolve_project_universe_maps_capabilities(requested, expected_universe, expected_caps):
    result = _resolve(requested)

    assert result["universe"] == expected_universe
    for key, value in expected_caps.items():
        assert result[key] == value
    assert result["data_treatment_enabled"] is True
    assert result["ruflo_core_agents"] == 15
    assert result["ruflo_max_agents"] == 60
    assert result["ruflo_specialist_agents"] == 45


def test_resolve_project_universe_rejects_unknown_universe():
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            f". '{COMMON}'; Resolve-ProjectUniverse 'universo-invalido'",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode != 0
    assert "Universo do projeto invalido" in (completed.stdout + completed.stderr)

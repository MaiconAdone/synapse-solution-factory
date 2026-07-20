from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROGRESS_ROUTE = ROOT / "frontend" / "app" / "api" / "vick" / "progress" / "route.ts"
PAGE = ROOT / "frontend" / "app" / "page.tsx"
QUALITY = ROOT / "config" / "voice_agent_quality_gates.json"


def test_progress_route_uses_only_allowlisted_summaries():
    source = PROGRESS_ROUTE.read_text(encoding="utf-8")
    assert "SAFE_TOOL_STAGES" in source
    assert "Conteudo livre do transcript nunca e exposto" in source
    assert "payload.arguments" not in source
    assert "item.input" not in source
    assert "task.objective" not in source
    assert "task.commands" not in source


def test_voice_reports_low_confidence_and_progress_within_target():
    source = PAGE.read_text(encoding="utf-8")
    assert "confidence < 0.6" in source
    assert "Não entendi a solicitação" in source
    assert "/api/vick/progress?since=" in source
    assert "}, 1250);" in source
    assert "announceProgress" in source


def test_high_risk_voice_quality_gates_are_declared():
    import json

    gates = json.loads(QUALITY.read_text(encoding="utf-8"))["release_gates"]
    assert gates["progress_narration_p95_ms"]["target"] == 3000
    assert gates["low_confidence_notice_rate"]["target"] == 1.0
    assert gates["unsafe_spoken_content_rate"]["target"] == 0.0

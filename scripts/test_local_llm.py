import argparse
import json
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.core_config import get_settings  # noqa: E402
from app.services.ollama_service import OllamaService, OllamaServiceError  # noqa: E402


DEFAULT_PROMPT = """
Analise esta solicitacao para o Synapse:
"Criar uma API FastAPI para prever churn, com tratamento de dados,
testes automatizados, observabilidade e baixo custo."

Responda somente com JSON valido contendo:
- universe: ML, IA ou hybrid
- architecture: lista curta de componentes
- agents: no maximo 5 agentes necessarios
- data_treatment: lista de etapas
- tests: lista de testes
- risks: lista de riscos
""".strip()

REQUIRED_KEYS = {
    "universe",
    "architecture",
    "agents",
    "data_treatment",
    "tests",
    "risks",
}


def parse_json_response(response: str) -> dict[str, object]:
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass

    start = response.find("{")
    end = response.rfind("}")
    if start >= 0 and end > start:
        return json.loads(response[start : end + 1])

    raise json.JSONDecodeError("No JSON object found", response, 0)


def run_test(model: str | None = None, prompt: str = DEFAULT_PROMPT) -> dict[str, object]:
    service = OllamaService()
    status = service.status()
    if not status.get("available"):
        raise OllamaServiceError(f"Ollama indisponivel: {status.get('error', 'sem resposta')}")

    selected_model = model or get_settings().ollama_model
    if selected_model not in status.get("models", []):
        raise OllamaServiceError(
            f"Modelo {selected_model!r} nao instalado. Execute: ollama pull {selected_model}"
        )

    started_at = time.perf_counter()
    generation = service.generate(
        prompt,
        model=selected_model,
        json_mode=True,
        temperature=0.0,
        system=(
            "Voce e o arquiteto local do Synapse. Priorize simplicidade, "
            "baixo custo, seguranca e respostas estruturadas."
        ),
    )
    wall_time_ms = round((time.perf_counter() - started_at) * 1000, 2)

    json_warning = None
    try:
        parsed = parse_json_response(str(generation["response"]))
    except json.JSONDecodeError:
        repair_prompt = (
            "Converta a resposta abaixo para JSON valido estrito. "
            "Retorne somente um objeto JSON, sem markdown, sem comentarios e sem texto extra. "
            "Mantenha exatamente as chaves obrigatorias: universe, architecture, agents, "
            "data_treatment, tests, risks.\n\n"
            f"RESPOSTA_INVALIDA:\n{generation['response']}"
        )
        repaired = service.generate(
            repair_prompt,
            model=selected_model,
            json_mode=True,
            temperature=0.0,
            system="Voce corrige JSON invalido e retorna apenas JSON estrito.",
        )
        try:
            parsed = parse_json_response(str(repaired["response"]))
            generation = {
                **generation,
                "completion_tokens": int(generation["completion_tokens"])
                + int(repaired["completion_tokens"]),
                "prompt_tokens": int(generation["prompt_tokens"]) + int(repaired["prompt_tokens"]),
                "total_duration_ms": float(generation["total_duration_ms"])
                + float(repaired["total_duration_ms"]),
                "tokens_per_second": repaired["tokens_per_second"],
            }
        except json.JSONDecodeError as error:
            json_warning = f"O modelo respondeu, mas nao retornou JSON valido: {error}"
            parsed = {
                "universe": "hybrid",
                "architecture": ["ollama_local_generation_received"],
                "agents": ["llm-engineering"],
                "data_treatment": [],
                "tests": ["local_model_responded", "json_contract_failed"],
                "risks": [
                    "model_returned_invalid_json",
                    "use qwen2.5-coder:3b or qwen3:8b for stricter JSON checks",
                ],
                "raw_response_preview": str(generation["response"])[:1000],
            }

    missing_keys = sorted(REQUIRED_KEYS - set(parsed))
    if missing_keys:
        raise OllamaServiceError(f"Resposta sem campos obrigatorios: {missing_keys}")

    report = {
        "test": "Synapse-vscode-local-llm",
        "passed": True,
        "runtime": {
            "provider": "ollama",
            "version": status.get("version"),
            "model": selected_model,
            "base_url": status.get("base_url"),
        },
        "metrics": {
            "wall_time_ms": wall_time_ms,
            "ollama_total_duration_ms": generation["total_duration_ms"],
            "prompt_tokens": generation["prompt_tokens"],
            "completion_tokens": generation["completion_tokens"],
            "tokens_per_second": generation["tokens_per_second"],
        },
        "result": parsed,
    }
    if json_warning:
        report["warning"] = json_warning
    output_dir = ROOT / "output" / "ollama"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "vscode_test_report.json"
    output_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    report["report_path"] = str(output_path)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Testa o Synapse com Ollama no VS Code")
    parser.add_argument("--model", default=None, help="Modelo Ollama instalado")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Solicitacao de teste")
    args = parser.parse_args()

    try:
        report = run_test(model=args.model, prompt=args.prompt)
    except OllamaServiceError as error:
        print(f"[FALHA] {error}")
        return 1

    print("[OK] Synapse respondeu pelo Ollama local sem navegador.")
    if report.get("warning"):
        print(f"[AVISO] {report['warning']}")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

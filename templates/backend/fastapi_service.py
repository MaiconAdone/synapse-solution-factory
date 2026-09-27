"""FastAPI service template for a generated solution (requires: pip install fastapi uvicorn).

Endpoints adapt to the project universe (config/project_universe.json):
- GET  /health               always;
- POST /v1/predict           ML and Hybrid: ModelService (scripts/synapse_lib/model_service.py);
- POST /v1/answer            IA, Chatbolt and Hybrid: LlmGateway with guardrails and trace
                             (scripts/synapse_lib/llm_gateway.py).

Inputs are validated at the edge with Pydantic; model access never bypasses the
gateway. Run: uvicorn templates.backend.fastapi_service:create_app --factory --port 8000
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def project_universe(root: Path = ROOT) -> str:
    profile = root / "config" / "project_universe.json"
    if profile.exists():
        return json.loads(profile.read_text(encoding="utf-8-sig")).get("universe", "hybrid")
    return "hybrid"


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    task_type: str = Field(default="rag_answering", max_length=64)
    context: list[str] = Field(default_factory=list, max_length=20)
    sources: list[str] = Field(default_factory=list, max_length=20)


class PredictRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=128)
    features: dict[str, Any]


def create_app(gateway: Any = None, root: Path = ROOT) -> FastAPI:
    universe = project_universe(root)
    app = FastAPI(title="Synapse solution service", version="1.0.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "universe": universe}

    if universe in {"ml", "hybrid"}:
        from scripts.synapse_lib.model_service import ModelNotFoundError, ModelService  # noqa: PLC0415
        from scripts.synapse_lib.schemas.models import ModelPredictionRequest  # noqa: PLC0415

        models = ModelService(root=root)

        @app.post("/v1/predict")
        def predict(request: PredictRequest) -> dict[str, Any]:
            try:
                return models.predict(request.model_id, ModelPredictionRequest(features=request.features))
            except ModelNotFoundError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error

    if universe in {"ia", "chatbolt", "hybrid"}:
        from scripts.synapse_lib.llm_gateway import AnthropicAdapter, LlmGateway, LlmRequest  # noqa: PLC0415

        llm = gateway or LlmGateway({"anthropic": AnthropicAdapter()}, root=root)

        @app.post("/v1/answer")
        def answer(request: AnswerRequest) -> dict[str, Any]:
            result = llm.complete(
                LlmRequest(
                    task_type=request.task_type,
                    user_message=request.question,
                    stable_context="Answer only from the provided context and cite source ids.",
                    dynamic_context=request.context,
                    sources=request.sources,
                    agent_id="fastapi-service",
                    prompt_id="service_answer",
                    prompt_version="v1",
                )
            )
            if result["outcome"].startswith("blocked"):
                raise HTTPException(status_code=422, detail={"outcome": result["outcome"]})
            return {key: result.get(key) for key in ("outcome", "text", "model", "request_id")}

    return app


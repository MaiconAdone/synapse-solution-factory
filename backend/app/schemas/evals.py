from typing import Literal

from pydantic import BaseModel, Field


class MlEvalRequest(BaseModel):
    model_id: str | None = None
    cases_path: str = "evals/ml_cases.jsonl"


class AiEvalRequest(BaseModel):
    cases_path: str = "evals/prompt_cases.jsonl"
    eval_type: Literal["prompt"] = "prompt"


class EvalCaseResult(BaseModel):
    id: str
    passed: bool
    checks: dict[str, bool]
    metrics: dict[str, float] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class EvalRunResponse(BaseModel):
    eval_type: str
    passed: bool
    pass_rate: float
    cases_total: int
    cases_passed: int
    metrics: dict[str, float]
    quality_gates: dict[str, object]
    results: list[EvalCaseResult]
    mlflow: dict[str, object] | None = None

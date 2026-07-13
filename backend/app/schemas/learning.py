from typing import Literal

from pydantic import BaseModel, Field


class LearningFeedbackRequest(BaseModel):
    execution_id: str = Field(min_length=1, max_length=100)
    project_id: str = Field(default="synapse-ai", min_length=1, max_length=100)
    approved: bool
    score: float = Field(ge=0.0, le=1.0)
    notes: str = Field(default="", max_length=4000)
    scope: Literal["project", "fleet", "global"] = "project"
    approver: str | None = Field(
        default=None,
        max_length=120,
        description="Deprecated: approver identity is derived from authentication.",
    )

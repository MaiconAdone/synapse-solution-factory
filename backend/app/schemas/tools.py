from typing import Any

from pydantic import BaseModel, Field


class ContextFilterRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)
    max_chars: int = Field(default=12_000, ge=200, le=100_000)


class DataTreatmentRequest(BaseModel):
    records: list[dict[str, Any]] = Field(min_length=1, max_length=50_000)
    winsorize_outliers: bool = False


class MarketRadarRequest(BaseModel):
    offline: bool = False

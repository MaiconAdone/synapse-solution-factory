from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelTrainingRequest(BaseModel):
    model_name: str = Field(min_length=1)
    feature_columns: list[str] = Field(default_factory=list)
    target_column: str = Field(min_length=1)
    dataset: list[dict[str, Any]] | None = None
    dataset_path: str | None = None
    problem_type: Literal["regression", "classification", "forecasting"] = "regression"
    algorithm: Literal[
        "linear_regression",
        "ridge_regression",
        "logistic_regression",
        "moving_average_forecast",
        "seasonal_naive_forecast",
        "neural_network_regression",
        "neural_network_classifier",
    ] = "linear_regression"
    time_column: str | None = None
    forecast_window: int = Field(default=3, ge=1)
    season_length: int = Field(default=1, ge=1)
    neural_hidden_units: int = Field(default=8, ge=2, le=64)
    max_iterations: int = Field(default=600, ge=50, le=5000)
    learning_rate: float = Field(default=0.05, gt=0, le=1)


class ModelPredictionRequest(BaseModel):
    features: dict[str, float | int] | list[float | int]


class ModelTrainingResponse(BaseModel):
    model_id: str
    model_name: str
    version: str
    artifact_path: str
    metrics: dict[str, float]
    mlflow: dict[str, object] | None = None


class ModelPredictionResponse(BaseModel):
    model_id: str
    prediction: float | int | str
    features: dict[str, float]
    details: dict[str, Any] = Field(default_factory=dict)

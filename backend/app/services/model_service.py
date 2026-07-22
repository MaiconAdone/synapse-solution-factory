import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from app.schemas.models import ModelPredictionRequest, ModelTrainingRequest


class ModelServiceError(ValueError):
    pass


class ModelNotFoundError(ModelServiceError):
    pass


class ModelService:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[3]
        self.models_dir = self.root / "artifacts" / "models"
        self.registry_path = self.models_dir / "registry.json"

    def list_models(self) -> dict[str, Any]:
        registry = self._load_registry()
        return {
            "registry_path": str(self.registry_path.relative_to(self.root)),
            "models": registry["models"],
        }

    def get_model(self, model_id: str) -> dict[str, Any]:
        return self._find_model(model_id)

    def train(self, request: ModelTrainingRequest) -> dict[str, Any]:
        records = self._load_records(request)
        if request.problem_type == "forecasting":
            artifact, metrics = self._train_forecast(request, records)
        elif request.problem_type == "classification":
            artifact, metrics = self._train_classifier(request, records)
        else:
            artifact, metrics = self._train_regressor(request, records)

        now = datetime.now(timezone.utc)
        version = now.strftime("%Y%m%d%H%M%S")
        model_slug = self._slugify(request.model_name)
        model_id = f"{model_slug}-{version}"
        artifact.update(
            {
                "id": model_id,
                "name": request.model_name,
                "version": version,
                "problem_type": request.problem_type,
                "algorithm": request.algorithm,
                "feature_columns": request.feature_columns,
                "target_column": request.target_column,
                "created_at": now.isoformat(),
            }
        )
        artifact_path = self.models_dir / f"{model_id}.json"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

        model_summary = {
            "id": model_id,
            "name": request.model_name,
            "version": version,
            "problem_type": request.problem_type,
            "algorithm": request.algorithm,
            "feature_columns": request.feature_columns,
            "target_column": request.target_column,
            "metrics": metrics,
            "artifact_path": str(artifact_path.relative_to(self.root)),
            "created_at": artifact["created_at"],
        }
        registry = self._load_registry()
        registry["models"] = [model for model in registry["models"] if model["id"] != model_id]
        registry["models"].append(model_summary)
        self._save_registry(registry)
        return {
            "model_id": model_id,
            "model_name": request.model_name,
            "version": version,
            "artifact_path": model_summary["artifact_path"],
            "metrics": metrics,
        }

    def predict(self, model_id: str, request: ModelPredictionRequest) -> dict[str, Any]:
        model = self._find_model(model_id)
        artifact_path = self.root / model["artifact_path"]
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        features = self._normalize_features(request.features, artifact.get("feature_columns", []))

        if artifact["problem_type"] == "forecasting":
            forecast = artifact["forecast"]
            prediction = float(forecast[0])
            return {"model_id": model_id, "prediction": prediction, "features": features, "details": {"forecast": forecast}}

        x = np.array([features[column] for column in artifact["feature_columns"]], dtype=float)
        if artifact["algorithm"] in {"linear_regression", "ridge_regression"}:
            prediction = float(artifact["intercept"] + np.dot(np.array(artifact["weights"], dtype=float), x))
            return {"model_id": model_id, "prediction": prediction, "features": features, "details": {}}

        if artifact["algorithm"] == "neural_network_regression":
            prediction = float(self._mlp_forward(x, artifact)[0])
            return {"model_id": model_id, "prediction": prediction, "features": features, "details": {}}

        if artifact["algorithm"] in {"logistic_regression", "neural_network_classifier"}:
            probability = float(self._classification_probability(x, artifact))
            labels = artifact["classes"]
            prediction = labels[1] if probability >= 0.5 else labels[0]
            return {
                "model_id": model_id,
                "prediction": prediction,
                "features": features,
                "details": {"probability": probability, "positive_class": labels[1]},
            }

        raise ModelServiceError(f"Unsupported algorithm: {artifact['algorithm']}")

    def _train_regressor(
        self,
        request: ModelTrainingRequest,
        records: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, float]]:
        self._require_features(request)
        x = self._feature_matrix(records, request.feature_columns)
        y = np.array([float(record[request.target_column]) for record in records], dtype=float)
        if len(records) < 2:
            raise ModelServiceError("At least two training records are required")

        if request.algorithm == "neural_network_regression":
            artifact, predictions = self._fit_mlp(x, y, request, classification=False)
            metrics = self._regression_metrics(y, predictions)
            return artifact, metrics

        design = np.column_stack([np.ones(x.shape[0]), x])
        if request.algorithm == "ridge_regression":
            penalty = np.eye(design.shape[1]) * 1.0
            penalty[0, 0] = 0.0
            weights = np.linalg.solve(design.T @ design + penalty, design.T @ y)
        elif request.algorithm == "linear_regression":
            weights, *_ = np.linalg.lstsq(design, y, rcond=None)
        else:
            raise ModelServiceError(f"Unsupported regression algorithm: {request.algorithm}")

        predictions = design @ weights
        metrics = self._regression_metrics(y, predictions)
        coefficients = {
            column: float(weight)
            for column, weight in zip(request.feature_columns, weights[1:], strict=True)
        }
        artifact = {
            "intercept": float(weights[0]),
            "weights": [float(weight) for weight in weights[1:]],
            "coefficients": coefficients,
            "metrics": metrics,
        }
        return artifact, metrics

    def _train_classifier(
        self,
        request: ModelTrainingRequest,
        records: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, float]]:
        self._require_features(request)
        x = self._feature_matrix(records, request.feature_columns)
        labels = [record[request.target_column] for record in records]
        classes = sorted({str(label) for label in labels})
        if len(classes) != 2:
            raise ModelServiceError("Classification currently supports exactly two classes")
        y = np.array([1.0 if str(label) == classes[1] else 0.0 for label in labels], dtype=float)

        if request.algorithm == "neural_network_classifier":
            artifact, probabilities = self._fit_mlp(x, y, request, classification=True)
        elif request.algorithm == "logistic_regression":
            x_scaled, scaler = self._scale_matrix(x)
            weights = np.zeros(x_scaled.shape[1])
            bias = 0.0
            for _ in range(request.max_iterations):
                logits = x_scaled @ weights + bias
                probabilities = self._sigmoid(logits)
                error = probabilities - y
                weights -= request.learning_rate * (x_scaled.T @ error / x_scaled.shape[0])
                bias -= request.learning_rate * float(error.mean())
            artifact = {
                "weights": [float(weight) for weight in weights],
                "intercept": float(bias),
                "scaler": scaler,
            }
            probabilities = self._sigmoid(x_scaled @ weights + bias)
        else:
            raise ModelServiceError(f"Unsupported classification algorithm: {request.algorithm}")

        predictions = (probabilities >= 0.5).astype(float)
        metrics = self._classification_metrics(y, predictions, probabilities)
        artifact.update({"classes": classes, "metrics": metrics})
        return artifact, metrics

    def _train_forecast(
        self,
        request: ModelTrainingRequest,
        records: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, float]]:
        series_records = sorted(records, key=lambda item: str(item.get(request.time_column or "", "")))
        y = np.array([float(record[request.target_column]) for record in series_records], dtype=float)
        if y.shape[0] < 2:
            raise ModelServiceError("At least two observations are required for forecasting")

        if request.algorithm == "moving_average_forecast":
            window = min(request.forecast_window, y.shape[0])
            forecast_value = float(np.mean(y[-window:]))
            fitted = np.array([
                float(np.mean(y[max(0, index - window):index])) if index else float(y[0])
                for index in range(y.shape[0])
            ])
            forecast = [forecast_value for _ in range(request.forecast_window)]
        elif request.algorithm == "seasonal_naive_forecast":
            season = min(request.season_length, y.shape[0])
            pattern = y[-season:]
            fitted = np.array([float(y[index - season]) if index >= season else float(y[index]) for index in range(y.shape[0])])
            forecast = [float(pattern[index % season]) for index in range(request.forecast_window)]
        else:
            raise ModelServiceError(f"Unsupported forecasting algorithm: {request.algorithm}")

        metrics = self._regression_metrics(y, fitted)
        artifact = {
            "forecast": forecast,
            "history": [float(value) for value in y],
            "time_column": request.time_column,
            "forecast_window": request.forecast_window,
            "season_length": request.season_length,
            "metrics": metrics,
        }
        return artifact, metrics

    def _fit_mlp(
        self,
        x: np.ndarray,
        y: np.ndarray,
        request: ModelTrainingRequest,
        *,
        classification: bool,
    ) -> tuple[dict[str, Any], np.ndarray]:
        x_scaled, scaler = self._scale_matrix(x)
        rng = np.random.default_rng(42)
        hidden = request.neural_hidden_units
        w1 = rng.normal(0, 0.1, size=(x_scaled.shape[1], hidden))
        b1 = np.zeros(hidden)
        w2 = rng.normal(0, 0.1, size=hidden)
        b2 = 0.0
        target = y.astype(float)
        if not classification:
            y_mean = float(target.mean())
            y_std = float(target.std()) or 1.0
            target = (target - y_mean) / y_std
        else:
            y_mean = 0.0
            y_std = 1.0

        for _ in range(request.max_iterations):
            hidden_values = np.tanh(x_scaled @ w1 + b1)
            output = hidden_values @ w2 + b2
            prediction = self._sigmoid(output) if classification else output
            error = prediction - target
            if classification:
                grad_output = error / x_scaled.shape[0]
            else:
                grad_output = 2 * error / x_scaled.shape[0]
            grad_w2 = hidden_values.T @ grad_output
            grad_b2 = float(grad_output.sum())
            grad_hidden = np.outer(grad_output, w2) * (1 - hidden_values**2)
            grad_w1 = x_scaled.T @ grad_hidden
            grad_b1 = grad_hidden.sum(axis=0)
            w2 -= request.learning_rate * grad_w2
            b2 -= request.learning_rate * grad_b2
            w1 -= request.learning_rate * grad_w1
            b1 -= request.learning_rate * grad_b1

        artifact = {
            "scaler": scaler,
            "hidden_units": hidden,
            "classification": classification,
            "w1": w1.tolist(),
            "b1": b1.tolist(),
            "w2": w2.tolist(),
            "b2": float(b2),
            "target_mean": y_mean,
            "target_std": y_std,
        }
        hidden_values = np.tanh(x_scaled @ w1 + b1)
        output = hidden_values @ w2 + b2
        predictions = self._sigmoid(output) if classification else output * y_std + y_mean
        return artifact, np.array(predictions, dtype=float)

    def _mlp_forward(self, x: np.ndarray, artifact: dict[str, Any]) -> np.ndarray:
        scaler = artifact["scaler"]
        x_scaled = (x - np.array(scaler["mean"], dtype=float)) / np.array(scaler["std"], dtype=float)
        hidden = np.tanh(x_scaled @ np.array(artifact["w1"], dtype=float) + np.array(artifact["b1"], dtype=float))
        output = hidden @ np.array(artifact["w2"], dtype=float) + float(artifact["b2"])
        if artifact.get("classification"):
            return np.array([float(self._sigmoid(output))])
        return np.array([float(output) * float(artifact["target_std"]) + float(artifact["target_mean"])])

    def _classification_probability(self, x: np.ndarray, artifact: dict[str, Any]) -> float:
        if artifact["algorithm"] == "neural_network_classifier":
            return float(self._mlp_forward(x, artifact)[0])
        scaler = artifact["scaler"]
        x_scaled = (x - np.array(scaler["mean"], dtype=float)) / np.array(scaler["std"], dtype=float)
        return float(self._sigmoid(x_scaled @ np.array(artifact["weights"], dtype=float) + float(artifact["intercept"])))

    def _load_records(self, request: ModelTrainingRequest) -> list[dict[str, Any]]:
        if request.dataset is not None:
            records = request.dataset
        elif request.dataset_path:
            dataset_path = self._resolve_dataset_path(request.dataset_path)
            if not dataset_path.exists():
                raise ModelServiceError(f"Dataset file not found: {request.dataset_path}")
            try:
                records = [
                    json.loads(line)
                    for line in dataset_path.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
            except json.JSONDecodeError as error:
                raise ModelServiceError(f"Invalid JSONL dataset: {request.dataset_path}") from error
        else:
            raise ModelServiceError("Provide dataset or dataset_path")

        required_columns = [*request.feature_columns, request.target_column]
        if request.problem_type == "forecasting" and request.time_column:
            required_columns.append(request.time_column)
        for index, record in enumerate(records):
            missing = [column for column in required_columns if column not in record]
            if missing:
                raise ModelServiceError(f"Record {index} missing columns: {missing}")
        return records

    def _resolve_dataset_path(self, dataset_path: str) -> Path:
        candidate = (self.root / dataset_path).resolve()
        data_root = (self.root / "data").resolve()
        try:
            candidate.relative_to(data_root)
        except ValueError as error:
            raise ModelServiceError("dataset_path must be inside the data directory") from error
        return candidate

    def _normalize_features(
        self,
        features: dict[str, float | int] | list[float | int],
        feature_columns: list[str],
    ) -> dict[str, float]:
        if not feature_columns:
            return {}
        if isinstance(features, list):
            if len(features) != len(feature_columns):
                raise ModelServiceError("Feature list length does not match model schema")
            return {
                column: float(value)
                for column, value in zip(feature_columns, features, strict=True)
            }

        missing = [column for column in feature_columns if column not in features]
        if missing:
            raise ModelServiceError(f"Missing prediction features: {missing}")
        return {column: float(features[column]) for column in feature_columns}

    def _feature_matrix(self, records: list[dict[str, Any]], columns: list[str]) -> np.ndarray:
        return np.array([[float(record[column]) for column in columns] for record in records], dtype=float)

    def _require_features(self, request: ModelTrainingRequest) -> None:
        if not request.feature_columns:
            raise ModelServiceError("feature_columns are required for regression and classification")

    @staticmethod
    def _scale_matrix(x: np.ndarray) -> tuple[np.ndarray, dict[str, list[float]]]:
        mean = x.mean(axis=0)
        std = x.std(axis=0)
        std[std == 0] = 1.0
        return (x - mean) / std, {"mean": mean.tolist(), "std": std.tolist()}

    @staticmethod
    def _sigmoid(value: np.ndarray | float) -> np.ndarray | float:
        return 1 / (1 + np.exp(-np.clip(value, -60, 60)))

    @staticmethod
    def _regression_metrics(y: np.ndarray, predictions: np.ndarray) -> dict[str, float]:
        residuals = predictions - y
        baseline = y - float(y.mean())
        ss_res = float(np.sum(residuals**2))
        ss_tot = float(np.sum(baseline**2))
        return {
            "rmse": float(np.sqrt(np.mean(residuals**2))),
            "mae": float(np.mean(np.abs(residuals))),
            "r2": 1.0 - ss_res / ss_tot if ss_tot else 1.0,
            "training_rows": float(y.shape[0]),
        }

    @staticmethod
    def _classification_metrics(y: np.ndarray, predictions: np.ndarray, probabilities: np.ndarray) -> dict[str, float]:
        tp = float(np.sum((predictions == 1) & (y == 1)))
        tn = float(np.sum((predictions == 0) & (y == 0)))
        fp = float(np.sum((predictions == 1) & (y == 0)))
        fn = float(np.sum((predictions == 0) & (y == 1)))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        log_loss = -float(np.mean(y * np.log(np.clip(probabilities, 1e-9, 1)) + (1 - y) * np.log(np.clip(1 - probabilities, 1e-9, 1))))
        return {
            "accuracy": float((tp + tn) / y.shape[0]),
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "log_loss": log_loss,
            "training_rows": float(y.shape[0]),
        }

    def _load_registry(self) -> dict[str, Any]:
        if not self.registry_path.exists():
            return {"version": 1, "models": []}
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def _save_registry(self, registry: dict[str, Any]) -> None:
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.registry_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def _find_model(self, model_id: str) -> dict[str, Any]:
        registry = self._load_registry()
        for model in registry["models"]:
            if model["id"] == model_id:
                return model
        raise ModelNotFoundError(f"Model not found: {model_id}")

    def _slugify(self, value: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
        return slug or "model"

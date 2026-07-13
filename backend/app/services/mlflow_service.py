from __future__ import annotations

import importlib
import json
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from app.core_config import Settings, get_settings


class MlflowService:
    def __init__(self, settings: Settings | None = None, root: Path | None = None) -> None:
        self.settings = settings or get_settings()
        self.root = root or Path(__file__).resolve().parents[3]

    def status(self) -> dict[str, Any]:
        module = self._load_mlflow()
        if not self.settings.mlflow_enabled:
            return self._unavailable("disabled")
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")

        try:
            self._configure(module)
            experiment = module.get_experiment_by_name(self.settings.mlflow_experiment_name)
            return {
                "available": True,
                "tracking_uri": module.get_tracking_uri(),
                "registry_uri": module.get_registry_uri(),
                "experiment_name": self.settings.mlflow_experiment_name,
                "experiment_id": experiment.experiment_id if experiment else None,
                "ui_url": self.settings.mlflow_tracking_uri,
            }
        except Exception as error:  # MLflow raises provider-specific exceptions.
            return self._unavailable(str(error))

    def list_experiments(self) -> dict[str, Any]:
        module = self._load_mlflow()
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")
        try:
            self._configure(module)
            client = module.tracking.MlflowClient()
            experiments = [
                {
                    "experiment_id": experiment.experiment_id,
                    "name": experiment.name,
                    "lifecycle_stage": experiment.lifecycle_stage,
                    "artifact_location": experiment.artifact_location,
                }
                for experiment in client.search_experiments()
            ]
            return {"available": True, "experiments": experiments}
        except Exception as error:
            return self._unavailable(str(error))

    def list_runs(self, max_results: int = 20) -> dict[str, Any]:
        module = self._load_mlflow()
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")
        try:
            self._configure(module)
            experiment = self._ensure_experiment(module)
            client = module.tracking.MlflowClient()
            runs = client.search_runs(
                experiment_ids=[experiment.experiment_id],
                order_by=["attributes.start_time DESC"],
                max_results=max_results,
            )
            return {
                "available": True,
                "experiment_id": experiment.experiment_id,
                "runs": [
                    {
                        "run_id": run.info.run_id,
                        "status": run.info.status,
                        "start_time": run.info.start_time,
                        "end_time": run.info.end_time,
                        "params": dict(run.data.params),
                        "metrics": dict(run.data.metrics),
                        "tags": dict(run.data.tags),
                    }
                    for run in runs
                ],
            }
        except Exception as error:
            return self._unavailable(str(error))

    def list_registered_models(self) -> dict[str, Any]:
        module = self._load_mlflow()
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")
        try:
            self._configure(module)
            client = module.tracking.MlflowClient()
            models = []
            for model in client.search_registered_models():
                aliases = getattr(model, "aliases", {}) or {}
                models.append(
                    {
                        "name": model.name,
                        "aliases": dict(aliases),
                        "latest_versions": [
                            {
                                "name": version.name,
                                "version": version.version,
                                "status": version.status,
                                "run_id": version.run_id,
                            }
                            for version in getattr(model, "latest_versions", [])
                        ],
                    }
                )
            return {"available": True, "models": models}
        except Exception as error:
            return self._unavailable(str(error))

    def log_training_run(
        self,
        *,
        model_id: str,
        model_name: str,
        artifact_path: Path,
        params: dict[str, Any],
        metrics: dict[str, float],
        tags: dict[str, str],
        pyfunc_model: Any | None = None,
    ) -> dict[str, Any]:
        module = self._load_mlflow()
        if not self.settings.mlflow_enabled:
            return self._unavailable("disabled")
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")

        try:
            self._configure(module)
            self._ensure_experiment(module)
            with module.start_run(run_name=model_id) as run:
                module.log_params(params)
                module.log_metrics(metrics)
                module.set_tags(tags)
                module.log_artifact(str(artifact_path), artifact_path="model-artifacts")
                model_uri = None
                registered_model = self._registered_model_name(model_name)

                if pyfunc_model is not None:
                    try:
                        class SynapsePyFunc(module.pyfunc.PythonModel):
                            def predict(self, context, model_input):
                                return pyfunc_model.predict(context, model_input)

                        module.pyfunc.log_model(
                            artifact_path="model",
                            python_model=SynapsePyFunc(),
                            registered_model_name=registered_model,
                        )
                        model_uri = f"runs:/{run.info.run_id}/model"
                    except Exception as error:
                        module.set_tag("Synapse.mlflow_model_warning", str(error))

                return {
                    "available": True,
                    "run_id": run.info.run_id,
                    "experiment_name": self.settings.mlflow_experiment_name,
                    "tracking_uri": module.get_tracking_uri(),
                    "registered_model_name": registered_model if model_uri else None,
                    "model_uri": model_uri,
                }
        except Exception as error:
            return self._unavailable(str(error))

    def set_model_alias(self, model_name: str, version: str, alias: str) -> dict[str, Any]:
        module = self._load_mlflow()
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")
        try:
            self._configure(module)
            client = module.tracking.MlflowClient()
            client.set_registered_model_alias(model_name, alias, version)
            return {
                "available": True,
                "model_name": model_name,
                "version": version,
                "alias": alias,
            }
        except Exception as error:
            return self._unavailable(str(error))

    def log_eval_run(
        self,
        *,
        eval_type: str,
        metrics: dict[str, float],
        params: dict[str, Any],
        tags: dict[str, str],
        results: dict[str, Any],
    ) -> dict[str, Any]:
        module = self._load_mlflow()
        if not self.settings.mlflow_enabled:
            return self._unavailable("disabled")
        if module is None:
            return self._unavailable("mlflow package is not installed")
        if not self._tracking_server_reachable():
            return self._unavailable("mlflow tracking server is not reachable")

        try:
            self._configure(module)
            self._ensure_experiment(module)
            with module.start_run(run_name=f"{eval_type}-eval") as run:
                module.log_params(params)
                module.log_metrics(metrics)
                module.set_tags({"Synapse.eval_type": eval_type, **tags})
                with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
                    json.dump(results, handle, indent=2)
                    artifact_path = handle.name
                module.log_artifact(artifact_path, artifact_path="eval-results")
                return {
                    "available": True,
                    "run_id": run.info.run_id,
                    "experiment_name": self.settings.mlflow_experiment_name,
                    "tracking_uri": module.get_tracking_uri(),
                }
        except Exception as error:
            return self._unavailable(str(error))

    def _configure(self, module: Any) -> None:
        module.set_tracking_uri(self.settings.mlflow_tracking_uri)
        module.set_registry_uri(self.settings.mlflow_registry_uri)
        module.set_experiment(self.settings.mlflow_experiment_name)

    def _ensure_experiment(self, module: Any) -> Any:
        experiment = module.get_experiment_by_name(self.settings.mlflow_experiment_name)
        if experiment is not None:
            return experiment

        artifact_root = (self.root / self.settings.mlflow_artifact_root).resolve()
        artifact_root.mkdir(parents=True, exist_ok=True)
        experiment_id = module.create_experiment(
            self.settings.mlflow_experiment_name,
            artifact_location=artifact_root.as_uri(),
        )
        return module.get_experiment(experiment_id)

    def _registered_model_name(self, model_name: str) -> str:
        cleaned = "-".join(model_name.lower().split())
        return f"Synapse-{cleaned or 'model'}"

    def _load_mlflow(self) -> Any | None:
        self._ensure_utf8_console()
        try:
            return importlib.import_module("mlflow")
        except ImportError:
            return None

    def _ensure_utf8_console(self) -> None:
        for stream in (sys.stdout, sys.stderr):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure is None:
                continue
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass

    def _tracking_server_reachable(self) -> bool:
        parsed = urlparse(self.settings.mlflow_tracking_uri)
        if parsed.scheme not in ("http", "https"):
            return True

        health_url = self.settings.mlflow_tracking_uri.rstrip("/") + "/health"
        try:
            with urllib.request.urlopen(
                health_url,
                timeout=self.settings.mlflow_request_timeout_seconds,
            ) as response:
                return response.status < 500
        except (OSError, urllib.error.URLError):
            return False

    def _unavailable(self, reason: str) -> dict[str, Any]:
        return {
            "available": False,
            "reason": reason,
            "tracking_uri": self.settings.mlflow_tracking_uri,
            "registry_uri": self.settings.mlflow_registry_uri,
            "experiment_name": self.settings.mlflow_experiment_name,
        }

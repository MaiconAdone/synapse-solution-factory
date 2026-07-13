from typing import Any

import httpx

from app.core_config import Settings, get_settings


class OllamaServiceError(RuntimeError):
    pass


class OllamaService:
    MODEL_PROFILES = (
        "fast",
        "general",
        "balanced",
        "code_review",
        "code_strong",
        "planning_strong",
        "reasoning_strong",
        "code_critical",
        "large",
        "embeddings",
    )

    def __init__(
        self,
        settings: Settings | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._owns_client = client is None
        self.client = client or httpx.Client(
            base_url=self.settings.ollama_base_url.rstrip("/"),
            timeout=self.settings.ollama_timeout_seconds,
        )

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def model_for_profile(self, profile: str = "fast") -> str:
        models = {
            "fast": self.settings.ollama_model,
            "general": self.settings.ollama_general_model,
            "balanced": self.settings.ollama_balanced_model,
            "code_review": self.settings.ollama_code_review_model,
            "code_strong": self.settings.ollama_code_strong_model,
            "planning_strong": self.settings.ollama_planning_strong_model,
            "reasoning_strong": self.settings.ollama_reasoning_strong_model,
            "code_critical": self.settings.ollama_code_critical_model,
            "large": self.settings.ollama_large_model,
            "embeddings": self.settings.ollama_embedding_model,
        }
        try:
            return models[profile]
        except KeyError as error:
            raise OllamaServiceError(
                f"Unknown Ollama model profile {profile!r}; use one of {self.MODEL_PROFILES}"
            ) from error

    def model_profiles(self, installed_models: list[str] | None = None) -> dict[str, dict[str, Any]]:
        installed = set(installed_models or [])
        return {
            profile: {
                "model": self.model_for_profile(profile),
                "installed": self.model_for_profile(profile) in installed,
            }
            for profile in self.MODEL_PROFILES
        }

    def status(self) -> dict[str, Any]:
        if not self.settings.local_llm_enabled:
            return {
                "enabled": False,
                "provider": "ollama",
                "available": False,
                "base_url": self.settings.ollama_base_url,
                "default_model": self.settings.ollama_model,
                "general_model": self.settings.ollama_general_model,
                "balanced_model": self.settings.ollama_balanced_model,
                "code_review_model": self.settings.ollama_code_review_model,
                "code_strong_model": self.settings.ollama_code_strong_model,
                "planning_strong_model": self.settings.ollama_planning_strong_model,
                "reasoning_strong_model": self.settings.ollama_reasoning_strong_model,
                "code_critical_model": self.settings.ollama_code_critical_model,
                "large_model": self.settings.ollama_large_model,
                "embedding_model": self.settings.ollama_embedding_model,
                "model_profiles": self.model_profiles(),
                "models": [],
            }

        try:
            version_response = self.client.get("/api/version")
            version_response.raise_for_status()
            tags_response = self.client.get("/api/tags")
            tags_response.raise_for_status()
        except httpx.HTTPError as error:
            return {
                "enabled": True,
                "provider": "ollama",
                "available": False,
                "base_url": self.settings.ollama_base_url,
                "default_model": self.settings.ollama_model,
                "general_model": self.settings.ollama_general_model,
                "balanced_model": self.settings.ollama_balanced_model,
                "code_review_model": self.settings.ollama_code_review_model,
                "code_strong_model": self.settings.ollama_code_strong_model,
                "planning_strong_model": self.settings.ollama_planning_strong_model,
                "reasoning_strong_model": self.settings.ollama_reasoning_strong_model,
                "code_critical_model": self.settings.ollama_code_critical_model,
                "large_model": self.settings.ollama_large_model,
                "embedding_model": self.settings.ollama_embedding_model,
                "model_profiles": self.model_profiles(),
                "models": [],
                "error": str(error),
            }

        models = [
            model.get("name", "")
            for model in tags_response.json().get("models", [])
            if model.get("name")
        ]
        return {
            "enabled": True,
            "provider": "ollama",
            "available": True,
            "version": version_response.json().get("version", "unknown"),
            "base_url": self.settings.ollama_base_url,
            "default_model": self.settings.ollama_model,
            "default_model_installed": self.settings.ollama_model in models,
            "general_model": self.settings.ollama_general_model,
            "general_model_installed": self.settings.ollama_general_model in models,
            "balanced_model": self.settings.ollama_balanced_model,
            "balanced_model_installed": self.settings.ollama_balanced_model in models,
            "code_review_model": self.settings.ollama_code_review_model,
            "code_review_model_installed": self.settings.ollama_code_review_model in models,
            "code_strong_model": self.settings.ollama_code_strong_model,
            "code_strong_model_installed": self.settings.ollama_code_strong_model in models,
            "planning_strong_model": self.settings.ollama_planning_strong_model,
            "planning_strong_model_installed": self.settings.ollama_planning_strong_model in models,
            "reasoning_strong_model": self.settings.ollama_reasoning_strong_model,
            "reasoning_strong_model_installed": self.settings.ollama_reasoning_strong_model in models,
            "code_critical_model": self.settings.ollama_code_critical_model,
            "code_critical_model_installed": self.settings.ollama_code_critical_model in models,
            "large_model": self.settings.ollama_large_model,
            "large_model_installed": self.settings.ollama_large_model in models,
            "embedding_model": self.settings.ollama_embedding_model,
            "embedding_model_installed": self.settings.ollama_embedding_model in models,
            "model_profiles": self.model_profiles(models),
            "models": models,
        }

    def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str | None = None,
        model_profile: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        seed: int | None = None,
        context_window: int | None = None,
        max_output_tokens: int | None = None,
    ) -> dict[str, Any]:
        if not self.settings.local_llm_enabled:
            raise OllamaServiceError("Local LLM is disabled")

        if model and model_profile:
            raise OllamaServiceError("Use model or model_profile, not both")
        selected_model = model or self.model_for_profile(model_profile or "fast")
        payload: dict[str, Any] = {
            "model": selected_model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_ctx": context_window or self.settings.ollama_context_window,
                "num_predict": max_output_tokens or self.settings.ollama_max_output_tokens,
            },
        }
        if seed is not None or json_mode or temperature == 0.0:
            payload["options"]["seed"] = self.settings.ollama_seed if seed is None else seed
        if system:
            payload["system"] = system
        if json_mode:
            payload["format"] = "json"

        try:
            response = self.client.post("/api/generate", json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = error.response.text.strip() or str(error)
            raise OllamaServiceError(f"Ollama rejected the request: {detail}") from error
        except httpx.HTTPError as error:
            raise OllamaServiceError(
                f"Unable to reach Ollama at {self.settings.ollama_base_url}: {error}"
            ) from error

        result = response.json()
        eval_count = int(result.get("eval_count", 0))
        eval_duration = int(result.get("eval_duration", 0))
        tokens_per_second = (
            eval_count / (eval_duration / 1_000_000_000)
            if eval_count and eval_duration
            else 0.0
        )
        return {
            "provider": "ollama",
            "model": result.get("model", selected_model),
            "response": result.get("response", ""),
            "done": bool(result.get("done", False)),
            "prompt_tokens": int(result.get("prompt_eval_count", 0)),
            "completion_tokens": eval_count,
            "total_duration_ms": round(int(result.get("total_duration", 0)) / 1_000_000, 2),
            "tokens_per_second": round(tokens_per_second, 2),
        }

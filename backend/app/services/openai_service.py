from typing import Any

import httpx

from app.core_config import Settings, get_settings


class OpenAiServiceError(RuntimeError):
    pass


class OpenAiService:
    def __init__(
        self,
        settings: Settings | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._owns_client = client is None
        self.client = client or httpx.Client(
            base_url=self.settings.openai_base_url.rstrip("/"),
            timeout=self.settings.openai_timeout_seconds,
        )

    @property
    def configured(self) -> bool:
        return bool(self.settings.openai_api_key.strip())

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        model: str | None = None,
        reasoning_effort: str = "low",
    ) -> dict[str, Any]:
        if not self.configured:
            raise OpenAiServiceError("OPENAI_API_KEY is not configured")

        selected_model = model or self.settings.openai_model
        payload: dict[str, Any] = {
            "model": selected_model,
            "input": prompt,
            "reasoning": {"effort": reasoning_effort},
            "text": {"verbosity": "low"},
        }
        if system:
            payload["instructions"] = system

        try:
            response = self.client.post(
                "/responses",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self.settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail = error.response.text.strip() or str(error)
            raise OpenAiServiceError(f"OpenAI rejected the request: {detail}") from error
        except httpx.HTTPError as error:
            raise OpenAiServiceError(f"Unable to reach OpenAI: {error}") from error

        result = response.json()
        usage = result.get("usage") or {}
        return {
            "provider": "openai",
            "model": result.get("model", selected_model),
            "response": self._output_text(result),
            "done": result.get("status") == "completed",
            "prompt_tokens": int(usage.get("input_tokens", 0)),
            "completion_tokens": int(usage.get("output_tokens", 0)),
            "total_tokens": int(usage.get("total_tokens", 0)),
            "response_id": result.get("id"),
        }

    @staticmethod
    def _output_text(payload: dict[str, Any]) -> str:
        direct = payload.get("output_text")
        if isinstance(direct, str):
            return direct
        parts: list[str] = []
        for item in payload.get("output", []):
            for content in item.get("content", []):
                text = content.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)

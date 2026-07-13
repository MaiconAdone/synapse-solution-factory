from pydantic import BaseModel, Field


class LocalLlmGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=24000)
    system: str | None = Field(default=None, max_length=12000)
    model: str | None = Field(default=None, max_length=120)
    model_profile: str | None = Field(default=None, pattern="^(fast|balanced|code_review|large)$")
    json_mode: bool = False
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    seed: int = Field(default=42, ge=0)
    context_window: int = Field(default=4096, ge=512, le=32768)
    max_output_tokens: int = Field(default=512, ge=16, le=4096)


class LocalLlmGenerateResponse(BaseModel):
    provider: str
    model: str
    response: str
    done: bool
    prompt_tokens: int
    completion_tokens: int
    total_duration_ms: float
    tokens_per_second: float

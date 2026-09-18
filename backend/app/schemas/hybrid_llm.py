from pydantic import BaseModel, Field


class HybridLlmRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=120000)
    system: str | None = Field(default=None, max_length=24000)
    json_mode: bool = False
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    min_response_chars: int = Field(default=40, ge=1, le=4000)
    project_id: str = Field(default="synapse-ai", min_length=1, max_length=120)
    agent_id: str = Field(default="direct-request", min_length=1, max_length=120)
    tool_name: str = Field(default="hybrid_llm.generate", min_length=1, max_length=160)

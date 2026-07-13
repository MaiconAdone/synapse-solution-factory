from pydantic import BaseModel, Field


class GovernedSwarmExecutionRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=120000)
    universe: str = "hybrid"
    allow_cloud: bool = False
    activate_all_60: bool = False
    human_approved: bool = False
    json_mode: bool = False
    min_response_chars: int = Field(default=40, ge=1, le=4000)
    project_id: str = Field(default="synapse-ai", min_length=1, max_length=100)

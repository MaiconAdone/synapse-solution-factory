from pydantic import BaseModel, Field


class WorkflowExecutionRequest(BaseModel):
    agent_ids: list[str] | None = Field(default=None)
    parallel_execution: bool = True

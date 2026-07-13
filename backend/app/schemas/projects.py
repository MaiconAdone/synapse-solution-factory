from pydantic import BaseModel, Field


class ProjectBriefingRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    project_goal: str | None = Field(default=None, max_length=4000)
    business_problem: str | None = Field(default=None, max_length=4000)
    solution_focus: str = "ai-ml-agents"
    success_metric_or_acceptance_criteria: str | None = Field(default=None, max_length=4000)
    available_data_or_knowledge_sources: str | None = Field(default=None, max_length=4000)
    risk_level: str | None = Field(default=None, max_length=120)


class ProjectBriefingResponse(BaseModel):
    agent: str
    phase: str
    message: str
    llm_response: str
    suggested_project_name: str
    solution_focus: str
    next_question: str
    missing_questions: list[str]
    ready_to_create: bool
    required_fields: list[str]
    recommendations: list[str]
    foundation_principles: list[str]
    parallel_agents: list[str]
    execution_plan: list[str]
    token_strategy: str
    cost_aware_activation: dict[str, object]
    agentic_mesh: dict[str, object]
    agent_blueprint: dict[str, object]
    business_solution_analysis: dict[str, object]
    enterprise_spec: dict[str, object]
    ai_framework_selection: dict[str, object]
    ruflo: dict[str, object]


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    project_type: str = "b2b2c-ai-ml-agentic-saas"
    activate_ruflo: bool = True
    project_goal: str | None = Field(default=None, max_length=4000)
    business_problem: str | None = Field(default=None, max_length=4000)
    solution_focus: str = "ai-ml-agents"
    success_metric_or_acceptance_criteria: str | None = Field(default=None, max_length=4000)
    available_data_or_knowledge_sources: str | None = Field(default=None, max_length=4000)
    risk_level: str | None = Field(default=None, max_length=120)
    require_business_problem: bool = False


class ProjectCreateResponse(BaseModel):
    project: str
    project_type: str
    destination: str
    context_path: str | None = None
    returncode: int
    created: bool
    stdout: str
    stderr: str
    storage_backend: str = "local"
    storage_bucket: str | None = None
    storage_prefix: str | None = None
    data_storage_prefix: str | None = None
    repository_url: str | None = None
    enterprise_spec: dict[str, object] | None = None
    project_universe: dict[str, object] | None = None
    cost_aware_activation: dict[str, object] | None = None
    agentic_mesh: dict[str, object] | None = None
    agent_blueprint: dict[str, object] | None = None
    business_solution_analysis: dict[str, object] | None = None
    ruflo_activation: dict[str, object] | None = None
    synapse_project_index: dict[str, object] | None = None


class ProjectSummary(BaseModel):
    name: str
    project_type: str
    status: str = "created"
    destination: str
    storage_backend: str
    storage_bucket: str | None = None
    storage_prefix: str
    data_storage_prefix: str
    repository_url: str | None = None
    created_by_synapse: bool = False
    synapse_registered_at: str | None = None


class ProjectDetail(ProjectSummary):
    project_goal: str | None = None
    business_problem: str | None = None
    solution_focus: str = "ai-ml-agents"
    success_metric_or_acceptance_criteria: str | None = None
    available_data_or_knowledge_sources: str | None = None
    risk_level: str | None = None


class ProjectAttachmentRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=20_000_000)

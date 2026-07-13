from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class WorkflowStatus(str, Enum):
    CREATED = "created"
    RUNNING = "running"
    APPROVAL_REQUIRED = "approval_required"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"


class BusinessObjective(BaseModel):
    """Business result that the transformation workflow must pursue."""

    id: str = Field(default_factory=lambda: new_id("objective"))
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=6000)
    business_area: str = Field(min_length=2, max_length=160)
    expected_outcome: str = Field(min_length=3, max_length=2000)
    constraints: list[str] = Field(default_factory=list)
    priority: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    available_data: list[str] = Field(default_factory=list)
    involved_systems: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


class ProcessStep(BaseModel):
    """One human, system or hybrid activity in the current process."""

    id: str = Field(default_factory=lambda: new_id("step"))
    name: str
    actor: str
    activity_type: str = Field(pattern="^(human|system|hybrid)$")
    pain_points: list[str] = Field(default_factory=list)
    decision_point: bool = False
    automatable: bool = False


class BusinessProcess(BaseModel):
    """Current-state business process affected by the objective."""

    id: str = Field(default_factory=lambda: new_id("process"))
    name: str
    area: str
    steps: list[ProcessStep]
    bottlenecks: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)


class TransformationOpportunity(BaseModel):
    """Prioritized application of agents, automation, RAG or ML."""

    id: str = Field(default_factory=lambda: new_id("opportunity"))
    process_id: str
    opportunity_type: str
    description: str
    expected_impact: str
    impact_score: float = Field(ge=0, le=10)
    complexity_score: float = Field(ge=0, le=10)
    risk_level: RiskLevel
    required_data: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    human_approval_required: bool = False
    priority_score: float = Field(ge=0, le=10)


class AgentTask(BaseModel):
    """Traceable unit of work assigned to a governed agent profile."""

    id: str = Field(default_factory=lambda: new_id("task"))
    agent: str
    objective: str
    status: str = "planned"
    output: dict[str, Any] = Field(default_factory=dict)


class AgentDecision(BaseModel):
    """Decision produced by an agent with rationale and evidence."""

    id: str = Field(default_factory=lambda: new_id("decision"))
    agent: str
    decision: str
    rationale: str
    evidence: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.LOW
    created_at: datetime = Field(default_factory=utc_now)


class KPI(BaseModel):
    """Business indicator used to compare baseline and target performance."""

    name: str
    description: str
    unit: str
    baseline: float | None = None
    target: float | None = None
    direction: str = Field(default="increase", pattern="^(increase|decrease|maintain)$")
    measurement_frequency: str = "monthly"


class RiskAssessment(BaseModel):
    """Governance classification and the controls required to proceed."""

    level: RiskLevel
    reasons: list[str]
    controls: list[str]
    human_approval_required: bool
    external_actions_allowed: bool


class HumanApprovalRequest(BaseModel):
    """Human authorization required for high-risk workflow stages."""

    id: str = Field(default_factory=lambda: new_id("approval"))
    workflow_id: str
    requested_action: str
    risk_level: RiskLevel
    rationale: str
    status: str = Field(default="pending", pattern="^(pending|approved|rejected)$")
    approver: str | None = None
    notes: str | None = None
    decided_at: datetime | None = None


class ExecutionPlan(BaseModel):
    """Technical and organizational plan for the selected opportunities."""

    agents: list[str]
    tools: list[str]
    required_data: list[str]
    integrations: list[str]
    technical_steps: list[str]
    approval_points: list[str]
    owners: list[str]
    timeline: list[str]


class ToolExecutionResult(BaseModel):
    """Auditable result returned by a simulated or real tool."""

    tool: str
    success: bool
    simulated: bool = True
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class BusinessImpact(BaseModel):
    """Expected impact and assumptions used to validate business value."""

    summary: str
    expected_benefits: list[str]
    estimated_value_score: float = Field(ge=0, le=10)
    confidence: float = Field(ge=0, le=1)
    assumptions: list[str]


class AuditEvent(BaseModel):
    """Immutable workflow event used for operational traceability."""

    id: str = Field(default_factory=lambda: new_id("event"))
    workflow_id: str
    event_type: str
    actor: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class WorkflowState(BaseModel):
    """Complete state of an enterprise transformation workflow."""

    workflow_id: str = Field(default_factory=lambda: new_id("transformation"))
    status: WorkflowStatus = WorkflowStatus.CREATED
    objective: BusinessObjective
    diagnosis: dict[str, Any] = Field(default_factory=dict)
    process_map: BusinessProcess | None = None
    opportunities: list[TransformationOpportunity] = Field(default_factory=list)
    agent_tasks: list[AgentTask] = Field(default_factory=list)
    decisions: list[AgentDecision] = Field(default_factory=list)
    execution_plan: ExecutionPlan | None = None
    risk_assessment: RiskAssessment | None = None
    approval: HumanApprovalRequest | None = None
    tool_results: list[ToolExecutionResult] = Field(default_factory=list)
    kpis: list[KPI] = Field(default_factory=list)
    expected_business_impact: BusinessImpact | None = None
    next_steps: list[str] = Field(default_factory=list)
    audit: list[AuditEvent] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utc_now)


class ApprovalDecision(BaseModel):
    approved: bool
    approver: str | None = Field(
        default=None,
        max_length=160,
        description="Deprecated: approver identity is derived from authentication.",
    )
    notes: str = Field(default="", max_length=2000)

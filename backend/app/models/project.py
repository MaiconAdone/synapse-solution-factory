from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    project_type: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="created")
    storage_backend: Mapped[str] = mapped_column(String(40), nullable=False, default="supabase")
    storage_bucket: Mapped[str | None] = mapped_column(String(120), nullable=True)
    storage_prefix: Mapped[str] = mapped_column(String(240), nullable=False)
    data_storage_prefix: Mapped[str] = mapped_column(String(260), nullable=False)
    repository_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_problem: Mapped[str | None] = mapped_column(Text, nullable=True)
    solution_focus: Mapped[str] = mapped_column(String(80), nullable=False, default="ai-ml-agents")
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

from typing import Any

from pydantic import BaseModel, Field


class RagDocument(BaseModel):
    id: str | None = None
    source_id: str | None = None
    text: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagIndexRequest(BaseModel):
    index_name: str = Field(default="default", min_length=1)
    documents: list[RagDocument] = Field(min_length=1)
    chunk_size: int = Field(default=160, ge=40, le=1200)
    chunk_overlap: int = Field(default=30, ge=0, le=400)


class RagQueryRequest(BaseModel):
    index_name: str = Field(default="default", min_length=1)
    query: str = Field(min_length=1)
    top_k: int = Field(default=4, ge=1, le=12)

from typing import Literal

from pydantic import BaseModel, Field


class ModelAliasRequest(BaseModel):
    model_name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    alias: Literal["candidate", "challenger", "champion", "archived"]

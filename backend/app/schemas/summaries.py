from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

SummaryType = Literal["repo_overview", "contributor_activity", "health_explanation"]


class GenerateSummaryRequest(BaseModel):
    summary_type: SummaryType
    repo_id: Optional[uuid.UUID] = None
    contributor_id: Optional[uuid.UUID] = None


class SummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    repo_id: Optional[uuid.UUID] = None
    contributor_id: Optional[uuid.UUID] = None
    summary_type: str
    content: str
    model_used: str
    generated_at: datetime

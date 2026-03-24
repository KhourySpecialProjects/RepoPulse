from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class HealthBreakdown(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    commit_frequency: float
    recency: float
    distribution: float
    branch_activity: float
    commit_message_quality: float
    participation: Optional[float] = None
    composite: float
    status: str

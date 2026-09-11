from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class HealthzResponse(BaseModel):
    """Liveness and schema-readiness of the API process.

    Distinct from `schemas/health.py`, which describes a *repository's* health
    score. This one answers "can this container serve requests".
    """

    status: str
    database: str
    schema_revision: Optional[str] = None
    detail: Optional[str] = None

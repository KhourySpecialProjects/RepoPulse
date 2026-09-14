from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# The two LLM-derived per-commit dimensions, cached in commit_classifications.
# Kept in sync with COMMIT_TYPES / QUALITY_SCORES in
# app/models/commit_classification.py, which back the table's CHECK constraints.
CommitType = Literal["substantive", "logistical"]
QualityScore = Literal["good", "ok", "bad"]

# "unclassified" is a *filter* value only — it means "no commit_type yet" and
# must never reach the column, whose CHECK allows only COMMIT_TYPES or NULL.
CommitTypeFilter = Literal["substantive", "logistical", "unclassified"]


class CommitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    hash: str
    author_name: str
    author_email: str
    date: datetime
    message: str
    # Every branch containing the commit. Good for "where can I find this",
    # useless for filtering: a trunk commit is contained in every branch cut
    # from it.
    branches: list[str]
    # The single branch the work was done on. This is what the branch filter
    # matches against.
    origin_branch: str
    insertions: int
    deletions: int
    files_changed: int
    # Both default to None: a commit with no sidecar row is genuinely
    # unclassified, and a default verdict would be indistinguishable from a
    # real one. Defaulted rather than required because CommitRead is exported
    # and constructed elsewhere.
    commit_type: CommitType | None = None
    quality_score: QualityScore | None = None


class PaginatedCommits(BaseModel):
    items: list[CommitRead]
    total: int
    limit: int
    offset: int

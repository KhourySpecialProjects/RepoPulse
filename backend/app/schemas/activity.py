from pydantic import BaseModel
from app.schemas.collections import CommitActivityPoint

class StudentActivity(BaseModel):
    id: str
    name: str
    activity: list[CommitActivityPoint]

class RepositoryActivity(BaseModel):
    id: str
    name: str
    available: bool
    # True when the stored history may be behind the remote: the last sync
    # failed, or there is no clone to sync into. Defaulted, so current
    # responses need not say so.
    stale: bool = False
    activity: list[CommitActivityPoint]
    students: list[StudentActivity]

class ContextualActivity(BaseModel):
    repositories: list[RepositoryActivity]

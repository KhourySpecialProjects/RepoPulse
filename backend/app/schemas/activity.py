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
    # True when `activity` came from the last sync's snapshot because the clone
    # could not be read. Defaulted, so live responses need not say so.
    stale: bool = False
    activity: list[CommitActivityPoint]
    students: list[StudentActivity]

class ContextualActivity(BaseModel):
    repositories: list[RepositoryActivity]

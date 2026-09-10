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
    activity: list[CommitActivityPoint]
    students: list[StudentActivity]

class ContextualActivity(BaseModel):
    repositories: list[RepositoryActivity]

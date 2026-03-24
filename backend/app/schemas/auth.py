from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DevLoginRequest(BaseModel):
    user_id: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    token_type: str = "bearer"
    user_id: str
    display_name: str
    role: str

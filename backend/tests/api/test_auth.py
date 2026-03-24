"""Tests for auth endpoints."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_dev_login_success(test_client: AsyncClient, test_user) -> None:
    response = await test_client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": str(test_user.id)},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user_id"] == str(test_user.id)
    assert data["display_name"] == test_user.display_name


@pytest.mark.asyncio
async def test_dev_login_unknown_user(test_client: AsyncClient) -> None:
    import uuid
    response = await test_client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_dev_login_invalid_uuid(test_client: AsyncClient) -> None:
    response = await test_client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": "not-a-uuid"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_protected_route_requires_auth(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/collections")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_protected_route_with_valid_token(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.get("/api/v1/collections", headers=auth_headers)
    assert response.status_code == 200

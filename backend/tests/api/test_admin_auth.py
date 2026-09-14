"""Every /admin/* endpoint must be gated server-side.

The client-side guard in AdminPage.tsx reads the user's role from a
localStorage blob that is never re-verified against the server, so editing it
in devtools renders the admin page. That is a UX bug rather than a breach only
because the backend refuses the data — which is exactly what these tests pin.

ADMIN_ENDPOINTS grows as each endpoint lands. `test_every_admin_route_is_gated`
is the safety net: it fails if a route is registered under /api/v1/admin
without being listed here, so a new endpoint cannot ship without gating tests.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.main import app
from app.models.user import User

ADMIN_ENDPOINTS: list[tuple[str, str]] = [
    ("GET", "/api/v1/admin/overview"),
]


@pytest_asyncio.fixture
async def ta_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta-admin-auth@example.com",
        display_name="TA User",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def ta_auth_headers(ta_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(ta_user.id)})
    return {"Authorization": f"Bearer {token}"}


async def _call(client: AsyncClient, method: str, path: str, **kwargs: object):
    return await client.request(method, path, **kwargs)


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
async def test_admin_endpoints_401_without_a_token(
    test_client: AsyncClient, method: str, path: str
) -> None:
    response = await _call(test_client, method, path)
    assert response.status_code == 401


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
async def test_admin_endpoints_403_for_an_instructor(
    test_client: AsyncClient, auth_headers: dict[str, str], method: str, path: str
) -> None:
    response = await _call(test_client, method, path, headers=auth_headers)
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
async def test_admin_endpoints_403_for_a_ta(
    test_client: AsyncClient, ta_auth_headers: dict[str, str], method: str, path: str
) -> None:
    response = await _call(test_client, method, path, headers=ta_auth_headers)
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
async def test_admin_endpoints_admit_an_admin(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    method: str,
    path: str,
) -> None:
    """Deliberately loose so the endpoint list can grow ahead of body tests."""
    response = await _call(test_client, method, path, headers=admin_auth_headers)
    assert response.status_code not in (401, 403)


async def test_admin_endpoints_403_for_a_token_whose_user_was_deleted(
    test_client: AsyncClient,
) -> None:
    """A well-formed token for a user that no longer exists is not an admin."""
    token = create_access_token({"sub": str(uuid.uuid4())})
    response = await test_client.get(
        "/api/v1/admin/overview", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


def test_every_admin_route_is_gated() -> None:
    """Catches an admin endpoint added without a corresponding gating test."""
    registered = {
        (method, route.path)
        for route in app.routes
        if getattr(route, "path", "").startswith("/api/v1/admin")
        for method in getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}
    }
    assert registered == set(ADMIN_ENDPOINTS)

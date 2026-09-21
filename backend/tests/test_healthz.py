"""Behavioural tests for /healthz.

Written before the endpoint was refactored, because it had none: test_smoke
only asserted the path was registered. /healthz is the compose healthcheck,
so its response shape and its 200/503 split are a contract — breaking either
takes the container unhealthy rather than failing a test.

Honest limitation, stated rather than papered over: /healthz probes the
global `engine`, which is bound to DATABASE_URL, not the injected session.
Under test it therefore reads the developer's dev database and does not honour
dependency_overrides. These tests assert the contract that holds either way
and deliberately do not assert a specific revision.
"""

from __future__ import annotations

from httpx import AsyncClient

from app.schemas.meta import HealthzResponse


async def test_healthz_needs_no_auth(test_client: AsyncClient) -> None:
    """A healthcheck that required a token would be useless to compose."""
    response = await test_client.get("/healthz")

    assert response.status_code in (200, 503)


async def test_healthz_returns_the_documented_shape(
    test_client: AsyncClient,
) -> None:
    response = await test_client.get("/healthz")

    # Parses as the declared response model, whichever branch it took.
    HealthzResponse.model_validate(response.json())
    assert set(response.json()) == {
        "status",
        "database",
        "schema_revision",
        "detail",
    }


async def test_healthz_reports_a_consistent_status_and_code(
    test_client: AsyncClient,
) -> None:
    """200 means ok; 503 means the body says why."""
    response = await test_client.get("/healthz")
    body = response.json()

    if response.status_code == 200:
        assert body["status"] == "ok"
        assert body["database"] == "ok"
    else:
        assert response.status_code == 503
        assert body["status"] == "error"
        assert body["detail"]


async def test_healthz_is_not_under_the_api_prefix(
    test_client: AsyncClient,
) -> None:
    """It is mounted on the app so it needs no auth and no version prefix."""
    response = await test_client.get("/api/v1/healthz")

    assert response.status_code == 404

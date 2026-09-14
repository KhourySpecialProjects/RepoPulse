"""GET /api/v1/admin/system — environment and configuration diagnostics.

Two things this endpoint must never do: leak a secret value, and 500. It is
what an administrator opens when something is already wrong, so it degrades
in the body rather than failing the request.

Test-environment reality to design around: conftest builds the schema with
create_all, and `alembic_version` is not in Base.metadata — so drop_all never
removes it and whether it exists in TEST_DATABASE_URL depends on whether
migrations were ever run there. Assert neither branch. Pin the property that
holds either way, or the suite passes on one machine and fails on another.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


async def test_system_returns_the_documented_shape(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "status",
        "server_time",
        "database",
        "schema_revision",
        "schema_head",
        "schema_up_to_date",
        "auth_mode",
        "dev_login_enabled",
        "admin_count",
        "repo_root_dir",
        "repo_root_exists",
        "repo_root_writable",
        "anthropic_api_key_configured",
        "github_token_configured",
        "default_llm_provider",
        "default_llm_model",
        "git_version",
    }


async def test_system_reports_secrets_as_booleans_and_never_their_values(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The negative assertion is the point.

    Not the value, not a prefix, not a length — a four-character fragment of
    an API key is still key material once it reaches a log aggregator.
    """
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.ANTHROPIC_API_KEY",
        "sk-ant-supersecretvalue",
    )
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.GITHUB_TOKEN",
        "ghp_supersecrettoken",
    )

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert body["anthropic_api_key_configured"] is True
    assert body["github_token_configured"] is True
    assert "sk-ant" not in response.text
    assert "supersecret" not in response.text
    assert "ghp_" not in response.text


async def test_system_reports_unset_secrets_as_false(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.ANTHROPIC_API_KEY", ""
    )
    monkeypatch.setattr("app.services.admin_stats_service.settings.GITHUB_TOKEN", "")

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert body["anthropic_api_key_configured"] is False
    assert body["github_token_configured"] is False


async def test_system_reports_the_real_repo_root_with_exists_and_writable(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The config value, not the per-user AppSettings one.

    The System tab used to render AppSettings.repo_root_directory, which is
    per-user, display-only, and never consulted when building clone paths —
    so an admin could be shown a path clones are not in.
    """
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.REPO_ROOT_DIR", str(tmp_path)
    )

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert body["repo_root_dir"] == str(tmp_path)
    assert body["repo_root_exists"] is True
    assert body["repo_root_writable"] is True


async def test_system_flags_a_missing_repo_root_and_degrades(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.REPO_ROOT_DIR",
        "/nonexistent-mount-xyz",
    )

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert response.status_code == 200, "degraded is reported in the body, not the code"
    assert body["repo_root_exists"] is False
    assert body["repo_root_writable"] is False
    assert body["status"] == "degraded"


async def test_system_reports_the_alembic_head_from_the_migration_files(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Read from the files, so it works even where alembic_version is absent."""
    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    assert response.json()["schema_head"] is not None


async def test_system_reports_schema_state_without_guessing(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Whether alembic_version exists here is environment-dependent.

    conftest builds the schema with create_all, and `alembic_version` is not
    in Base.metadata — so drop_all never removes it and it survives if
    migrations were ever run against this database. Asserting either branch
    would make the test pass on one machine and fail on another.

    So assert the contract that holds either way: an unreadable revision
    stays null rather than being reported as up-to-date, a readable one is
    compared against the head, and the endpoint never fails the request.
    """
    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert response.status_code == 200
    assert body["database"] == "ok"

    if body["schema_revision"] is None:
        # Unknown must not be reported as either up-to-date or behind.
        assert body["schema_up_to_date"] is None
    else:
        assert body["schema_up_to_date"] == (
            body["schema_revision"] == body["schema_head"]
        )


async def test_system_flags_dev_auth_mode(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AUTH_MODE=dev serves POST /auth/dev-login, which mints a full token
    from a bare user id with no password. Surfaced, never blocked."""
    monkeypatch.setattr("app.services.admin_stats_service.settings.AUTH_MODE", "dev")

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    body = response.json()
    assert body["auth_mode"] == "dev"
    assert body["dev_login_enabled"] is True


async def test_system_does_not_flag_dev_login_in_prod_mode(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.services.admin_stats_service.settings.AUTH_MODE", "prod")

    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    assert response.json()["dev_login_enabled"] is False


async def test_system_reports_the_admin_count(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """One admin is a lockout risk; the number has to be visible somewhere."""
    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    assert response.json()["admin_count"] == 1


async def test_system_reports_the_git_version(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get("/api/v1/admin/system", headers=admin_auth_headers)

    # None is acceptable where git is unavailable; a string must look like one.
    version = response.json()["git_version"]
    assert version is None or version[0].isdigit()

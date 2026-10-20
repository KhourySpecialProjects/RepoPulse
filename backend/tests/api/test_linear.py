"""Tests for the Linear integration endpoints.

Covers the per-user Linear API key on `PATCH /users/me`, the per-repo team link
on `PATCH /repos/{id}`, `GET /linear/teams`, and `GET /repos/{id}/linear`.
`LinearService`'s network methods are mocked — nothing here calls Linear.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.repo import Repo
from app.models.user import User
from app.services.linear_service import (
    LinearAPIError,
    LinearAuthError,
    LinearService,
    LinearTeam,
    summarize_team,
)

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)

FALCON = LinearTeam(id="t-falcon", key="FAL", name="Falcon")
HAWK = LinearTeam(id="t-hawk", key="HAW", name="Hawk")
STATS = summarize_team(
    [
        {"state": {"type": "started"}, "assignee": None, "completedAt": None, "cycle": None},
        {
            "state": {"type": "completed"},
            "assignee": {"id": "u1", "name": "Alice"},
            "completedAt": "2026-10-19T09:00:00.000Z",
            "cycle": None,
        },
    ],
    None,
    now=NOW,
)


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def _mock_linear(teams=None, stats=STATS, teams_error=None, stats_error=None):
    """Patch LinearService's two network calls; returns (list_teams, fetch_team_stats)."""
    list_teams = AsyncMock(return_value=teams or [], side_effect=teams_error)
    fetch_stats = AsyncMock(return_value=stats, side_effect=stats_error)
    return (
        patch.object(LinearService, "list_teams", list_teams),
        patch.object(LinearService, "fetch_team_stats", fetch_stats),
        list_teams,
        fetch_stats,
    )


@pytest_asyncio.fixture
async def collection(db_session: AsyncSession, test_user: User) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Linear Collection",
        local_folder_name="linear-col",
        owner_id=test_user.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, collection: Collection) -> Repo:
    r = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/org/team-falcon",
        name="team-falcon",
    )
    db_session.add(r)
    await db_session.flush()
    return r


@pytest_asyncio.fixture
async def linear_user(db_session: AsyncSession, test_user: User) -> User:
    """test_user (the collection owner) with a Linear key configured."""
    test_user.linear_api_key = "lin_api_owner"
    await db_session.flush()
    return test_user


@pytest_asyncio.fixture
async def ta(db_session: AsyncSession, collection: Collection) -> User:
    user = User(
        id=uuid.uuid4(),
        email="linear_ta@example.com",
        display_name="Linear TA",
        role="ta",
        linear_api_key="lin_api_ta",
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        CollectionAccess(
            collection_id=collection.id, user_id=user.id, access_role=CollectionRole.ta
        )
    )
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def outsider(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="linear_outsider@example.com",
        display_name="Outsider",
        role="instructor",
        linear_api_key="lin_api_outsider",
    )
    db_session.add(user)
    await db_session.flush()
    return user


# ---------------------------------------------------------------------------
# PATCH /users/me — the Linear key
# ---------------------------------------------------------------------------


class TestLinearApiKey:
    async def test_profile_reports_key_not_configured_by_default(
        self, test_client: AsyncClient, test_user: User
    ):
        resp = await test_client.get("/api/v1/users/me", headers=_headers(test_user))
        assert resp.status_code == 200
        assert resp.json()["linear_api_key_configured"] is False

    async def test_user_can_set_key_and_it_is_never_returned(
        self, test_client: AsyncClient, test_user: User, db_session: AsyncSession
    ):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"linear_api_key": "lin_api_abc"},
            headers=_headers(test_user),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["linear_api_key_configured"] is True
        assert "linear_api_key" not in data
        await db_session.refresh(test_user)
        assert test_user.linear_api_key == "lin_api_abc"

    async def test_empty_string_clears_key(
        self, test_client: AsyncClient, linear_user: User, db_session: AsyncSession
    ):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"linear_api_key": ""},
            headers=_headers(linear_user),
        )
        assert resp.status_code == 200
        assert resp.json()["linear_api_key_configured"] is False
        await db_session.refresh(linear_user)
        assert linear_user.linear_api_key is None

    async def test_omitting_key_leaves_it_alone(
        self, test_client: AsyncClient, linear_user: User, db_session: AsyncSession
    ):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"display_name": "Renamed"},
            headers=_headers(linear_user),
        )
        assert resp.status_code == 200
        await db_session.refresh(linear_user)
        assert linear_user.linear_api_key == "lin_api_owner"


# ---------------------------------------------------------------------------
# PATCH /repos/{id} — the team link
# ---------------------------------------------------------------------------


class TestLinkRepoToTeam:
    async def test_owner_can_link_a_team(
        self, test_client: AsyncClient, test_user: User, repo: Repo, db_session: AsyncSession
    ):
        resp = await test_client.patch(
            f"/api/v1/repos/{repo.id}",
            json={"linear_team_id": "t-hawk"},
            headers=_headers(test_user),
        )
        assert resp.status_code == 200
        assert resp.json()["linear_team_id"] == "t-hawk"
        await db_session.refresh(repo)
        assert repo.linear_team_id == "t-hawk"

    async def test_null_returns_repo_to_auto_match(
        self, test_client: AsyncClient, test_user: User, repo: Repo, db_session: AsyncSession
    ):
        repo.linear_team_id = "t-hawk"
        await db_session.flush()
        resp = await test_client.patch(
            f"/api/v1/repos/{repo.id}",
            json={"linear_team_id": None},
            headers=_headers(test_user),
        )
        assert resp.status_code == 200
        assert resp.json()["linear_team_id"] is None

    async def test_ta_cannot_change_the_link(
        self, test_client: AsyncClient, ta: User, repo: Repo
    ):
        resp = await test_client.patch(
            f"/api/v1/repos/{repo.id}",
            json={"linear_team_id": "t-hawk"},
            headers=_headers(ta),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /linear/teams
# ---------------------------------------------------------------------------


class TestListLinearTeams:
    async def test_without_a_key_is_a_400(self, test_client: AsyncClient, test_user: User):
        resp = await test_client.get("/api/v1/linear/teams", headers=_headers(test_user))
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "linear_not_configured"

    async def test_lists_teams_sorted_by_name_in_envelope(
        self, test_client: AsyncClient, linear_user: User
    ):
        p_teams, p_stats, list_teams, _ = _mock_linear(teams=[HAWK, FALCON])
        with p_teams, p_stats:
            resp = await test_client.get("/api/v1/linear/teams", headers=_headers(linear_user))
        assert resp.status_code == 200
        data = resp.json()
        assert [t["name"] for t in data["items"]] == ["Falcon", "Hawk"]
        assert data["items"][0] == {"id": "t-falcon", "key": "FAL", "name": "Falcon"}
        assert data["total"] == 2
        assert data["offset"] == 0
        list_teams.assert_awaited_once()

    async def test_rejected_key_is_reported(self, test_client: AsyncClient, linear_user: User):
        p_teams, p_stats, _, _ = _mock_linear(teams_error=LinearAuthError("bad key"))
        with p_teams, p_stats:
            resp = await test_client.get("/api/v1/linear/teams", headers=_headers(linear_user))
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "linear_key_invalid"

    async def test_requires_auth(self, test_client: AsyncClient):
        resp = await test_client.get("/api/v1/linear/teams")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /repos/{id}/linear
# ---------------------------------------------------------------------------


class TestRepoLinear:
    async def test_without_a_key_reports_not_configured(
        self, test_client: AsyncClient, test_user: User, repo: Repo
    ):
        p_teams, p_stats, list_teams, _ = _mock_linear(teams=[FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(test_user)
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "not_configured"
        assert data["team"] is None
        assert data["stats"] is None
        list_teams.assert_not_awaited()

    async def test_auto_matches_team_by_repo_name(
        self, test_client: AsyncClient, linear_user: User, repo: Repo
    ):
        p_teams, p_stats, _, fetch_stats = _mock_linear(teams=[HAWK, FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["matched_by"] == "auto"
        assert data["team"] == {"id": "t-falcon", "key": "FAL", "name": "Falcon"}
        assert data["stats"]["total_issues"] == 2
        assert data["stats"]["status_counts"]["completed"] == 1
        assert data["stats"]["members"][0]["name"] == "Alice"
        assert len(data["stats"]["completed_per_week"]) == 6
        fetch_stats.assert_awaited_once_with("t-falcon")

    async def test_no_matching_team_reports_no_team(
        self, test_client: AsyncClient, linear_user: User, repo: Repo
    ):
        p_teams, p_stats, _, fetch_stats = _mock_linear(teams=[HAWK])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "no_team"
        assert data["team"] is None
        assert data["stats"] is None
        fetch_stats.assert_not_awaited()

    async def test_manual_link_overrides_auto_match(
        self,
        test_client: AsyncClient,
        linear_user: User,
        repo: Repo,
        db_session: AsyncSession,
    ):
        repo.linear_team_id = "t-hawk"
        await db_session.flush()
        p_teams, p_stats, _, fetch_stats = _mock_linear(teams=[HAWK, FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        data = resp.json()
        assert data["status"] == "ok"
        assert data["matched_by"] == "manual"
        assert data["team"]["id"] == "t-hawk"
        fetch_stats.assert_awaited_once_with("t-hawk")

    async def test_linked_team_outside_viewers_workspace_reports_no_team(
        self,
        test_client: AsyncClient,
        linear_user: User,
        repo: Repo,
        db_session: AsyncSession,
    ):
        # Linked by someone whose key sees a different workspace. Falling back
        # to a name match here would show a different team than the one chosen.
        repo.linear_team_id = "t-elsewhere"
        await db_session.flush()
        p_teams, p_stats, _, fetch_stats = _mock_linear(teams=[FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        data = resp.json()
        assert data["status"] == "no_team"
        assert data["matched_by"] == "manual"
        fetch_stats.assert_not_awaited()

    async def test_rejected_key_is_reported(
        self, test_client: AsyncClient, linear_user: User, repo: Repo
    ):
        p_teams, p_stats, _, _ = _mock_linear(teams_error=LinearAuthError("bad key"))
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "linear_key_invalid"

    async def test_linear_outage_is_a_502(
        self, test_client: AsyncClient, linear_user: User, repo: Repo
    ):
        p_teams, p_stats, _, _ = _mock_linear(
            teams=[FALCON], stats_error=LinearAPIError("timeout")
        )
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        assert resp.status_code == 502
        assert resp.json()["error_code"] == "linear_unavailable"

    async def test_owner_can_change_team(
        self, test_client: AsyncClient, linear_user: User, repo: Repo
    ):
        p_teams, p_stats, _, _ = _mock_linear(teams=[FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(linear_user)
            )
        assert resp.json()["can_change_team"] is True

    async def test_ta_sees_stats_but_cannot_change_team(
        self, test_client: AsyncClient, ta: User, repo: Repo
    ):
        p_teams, p_stats, _, _ = _mock_linear(teams=[FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(ta)
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["can_change_team"] is False

    async def test_outsider_gets_404(
        self, test_client: AsyncClient, outsider: User, repo: Repo
    ):
        p_teams, p_stats, list_teams, _ = _mock_linear(teams=[FALCON])
        with p_teams, p_stats:
            resp = await test_client.get(
                f"/api/v1/repos/{repo.id}/linear", headers=_headers(outsider)
            )
        assert resp.status_code == 404
        list_teams.assert_not_awaited()

    async def test_unknown_repo_is_404(self, test_client: AsyncClient, linear_user: User):
        resp = await test_client.get(
            f"/api/v1/repos/{uuid.uuid4()}/linear", headers=_headers(linear_user)
        )
        assert resp.status_code == 404

"""Repo lifecycle, health and pull-request events reach collection members.

These are the course-activity notifications: the things an instructor wants to
hear about without having to open the dashboard.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.notification import Notification, NotificationType
from app.models.pull_request import PullRequest
from app.models.repo import Repo
from app.models.user import User


@pytest_asyncio.fixture
async def owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="prof@example.edu",
        display_name="Prof Owner",
        role="instructor",
        password_hash=None,
        github_token="ghp_token",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta(db_session: AsyncSession, collection: Collection) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta@example.edu",
        display_name="Dana TA",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        CollectionAccess(
            id=uuid.uuid4(),
            collection_id=collection.id,
            user_id=user.id,
            access_role=CollectionRole.ta,
        )
    )
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def collection(db_session: AsyncSession, owner: User) -> Collection:
    coll = Collection(
        id=uuid.uuid4(),
        name="CS 3200",
        local_folder_name="cs3200",
        owner_id=owner.id,
    )
    db_session.add(coll)
    await db_session.flush()
    return coll


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, collection: Collection) -> Repo:
    row = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/team-4",
        name="team-4",
        local_path="/repos/cs3200/team-4",
        health_status="green",
    )
    db_session.add(row)
    await db_session.flush()
    return row


@pytest.fixture
def owner_headers(owner: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(owner.id)})}"}


async def _notifications_of(
    db_session: AsyncSession, type: NotificationType
) -> list[Notification]:
    result = await db_session.execute(
        select(Notification).where(Notification.type == type)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Repo added / removed
# ---------------------------------------------------------------------------


async def test_adding_a_repo_notifies_other_collection_members(
    test_client: AsyncClient,
    db_session: AsyncSession,
    collection: Collection,
    owner: User,
    ta: User,
    owner_headers: dict[str, str],
) -> None:
    response = await test_client.post(
        f"/api/v1/collections/{collection.id}/repos",
        json={"urls": ["https://github.com/example/team-9"]},
        headers=owner_headers,
    )
    assert response.status_code == 201, response.text

    added = await _notifications_of(db_session, NotificationType.repo_added)
    recipients = {n.recipient_id for n in added}

    assert ta.id in recipients
    # The person who added it does not need telling.
    assert owner.id not in recipients
    assert "team-9" in added[0].subject


async def test_removing_a_repo_notifies_and_survives_the_cascade(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    owner: User,
    ta: User,
    owner_headers: dict[str, str],
) -> None:
    """The notification must outlive the repo it announces."""
    repo_name = repo.name

    response = await test_client.delete(
        f"/api/v1/repos/{repo.id}", headers=owner_headers
    )
    assert response.status_code == 200, response.text

    removed = await _notifications_of(db_session, NotificationType.repo_removed)
    assert [n.recipient_id for n in removed] == [ta.id]
    # repo_id is deliberately NULL — the FK cascade would have deleted this row.
    assert removed[0].repo_id is None
    assert repo_name in removed[0].subject


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


async def test_health_falling_into_red_notifies_members(
    db_session: AsyncSession, repo: Repo, owner: User, ta: User
) -> None:
    from app.services.notification_service import notify_health_change

    repo.health_status = "green"
    await db_session.flush()

    await notify_health_change(db_session, repo=repo, previous_status="green", new_status="red")
    await db_session.commit()

    declined = await _notifications_of(
        db_session, NotificationType.repo_health_declined
    )
    recipients = {n.recipient_id for n in declined}

    # Nobody is excluded here: a health change has no actor.
    assert recipients == {owner.id, ta.id}
    assert "team-4" in declined[0].subject


async def test_health_staying_red_does_not_re_notify(
    db_session: AsyncSession, repo: Repo
) -> None:
    """Only the transition into red is news; every later sync is not."""
    from app.services.notification_service import notify_health_change

    await notify_health_change(db_session, repo=repo, previous_status="red", new_status="red")
    await db_session.commit()

    assert await _notifications_of(db_session, NotificationType.repo_health_declined) == []


async def test_health_improving_does_not_notify(
    db_session: AsyncSession, repo: Repo
) -> None:
    from app.services.notification_service import notify_health_change

    await notify_health_change(db_session, repo=repo, previous_status="red", new_status="green")
    await db_session.commit()

    assert await _notifications_of(db_session, NotificationType.repo_health_declined) == []


async def test_first_ever_score_of_red_notifies(
    db_session: AsyncSession, repo: Repo, owner: User
) -> None:
    """A repo whose very first indexing comes back red is worth knowing about."""
    from app.services.notification_service import notify_health_change

    await notify_health_change(
        db_session, repo=repo, previous_status="unknown", new_status="red"
    )
    await db_session.commit()

    declined = await _notifications_of(
        db_session, NotificationType.repo_health_declined
    )
    assert len(declined) >= 1


# ---------------------------------------------------------------------------
# Pull requests
# ---------------------------------------------------------------------------


async def test_pr_sync_notifies_for_newly_opened_and_merged(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    owner: User,
    ta: User,
    owner_headers: dict[str, str],
) -> None:
    # PR 1 is already known and open; the sync will report it merged.
    db_session.add(
        PullRequest(
            id=uuid.uuid4(),
            repo_id=repo.id,
            pr_number=1,
            title="Add login",
            state="open",
            author_login="student-a",
            html_url="https://github.com/example/team-4/pull/1",
            reviews_requested=0,
            draft=False,
            fetched_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    await db_session.flush()

    raw = [
        {
            "number": 1,
            "title": "Add login",
            "state": "closed",
            "user": {"login": "student-a"},
            "created_at": "2026-09-01T00:00:00Z",
            "merged_at": "2026-09-10T00:00:00Z",
            "closed_at": "2026-09-10T00:00:00Z",
            "html_url": "https://github.com/example/team-4/pull/1",
            "requested_reviewers": [],
            "draft": False,
        },
        {
            "number": 2,
            "title": "Refactor db layer",
            "state": "open",
            "user": {"login": "student-b"},
            "created_at": "2026-09-12T00:00:00Z",
            "merged_at": None,
            "closed_at": None,
            "html_url": "https://github.com/example/team-4/pull/2",
            "requested_reviewers": [],
            "draft": False,
        },
    ]

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new=AsyncMock(return_value=raw),
    ):
        response = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync", headers=owner_headers
        )
    assert response.status_code == 200, response.text

    opened = await _notifications_of(db_session, NotificationType.pr_opened)
    merged = await _notifications_of(db_session, NotificationType.pr_merged)

    # PR 2 is new and open; PR 1 transitioned open -> merged.
    assert {n.recipient_id for n in opened} == {owner.id, ta.id}
    assert all("#2" in n.subject for n in opened)
    assert {n.recipient_id for n in merged} == {owner.id, ta.id}
    assert all("#1" in n.subject for n in merged)


async def test_first_ever_pr_sync_backfills_silently(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    owner: User,
    ta: User,
    owner_headers: dict[str, str],
) -> None:
    """A repo with no synced PRs is being backfilled, not reporting news.

    Without this, the first Sync on a semester-old repo would raise one
    notification per open PR per recipient — dozens of rows about things that
    happened weeks ago.
    """
    raw = [
        {
            "number": n,
            "title": f"Feature {n}",
            "state": "open",
            "user": {"login": "student-a"},
            "created_at": "2026-08-01T00:00:00Z",
            "merged_at": None,
            "closed_at": None,
            "html_url": f"https://github.com/example/team-4/pull/{n}",
            "requested_reviewers": [],
            "draft": False,
        }
        for n in range(1, 13)
    ]

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new=AsyncMock(return_value=raw),
    ):
        response = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync", headers=owner_headers
        )
    assert response.status_code == 200, response.text
    assert response.json()["synced"] == 12

    # The PRs are stored...
    stored = await db_session.execute(
        select(PullRequest).where(PullRequest.repo_id == repo.id)
    )
    assert len(list(stored.scalars().all())) == 12
    # ...but nobody was notified about any of them.
    assert await _notifications_of(db_session, NotificationType.pr_opened) == []


async def test_pr_sync_is_quiet_when_nothing_changed(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    owner: User,
    owner_headers: dict[str, str],
) -> None:
    """Re-syncing unchanged PRs must not re-announce them."""
    db_session.add(
        PullRequest(
            id=uuid.uuid4(),
            repo_id=repo.id,
            pr_number=1,
            title="Add login",
            state="open",
            author_login="student-a",
            html_url="https://github.com/example/team-4/pull/1",
            reviews_requested=0,
            draft=False,
            fetched_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    await db_session.flush()

    raw = [
        {
            "number": 1,
            "title": "Add login",
            "state": "open",
            "user": {"login": "student-a"},
            "created_at": "2026-09-01T00:00:00Z",
            "merged_at": None,
            "closed_at": None,
            "html_url": "https://github.com/example/team-4/pull/1",
            "requested_reviewers": [],
            "draft": False,
        }
    ]

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new=AsyncMock(return_value=raw),
    ):
        response = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync", headers=owner_headers
        )
    assert response.status_code == 200, response.text

    assert await _notifications_of(db_session, NotificationType.pr_opened) == []
    assert await _notifications_of(db_session, NotificationType.pr_merged) == []

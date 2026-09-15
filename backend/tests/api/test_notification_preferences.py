"""The read/write side of per-user notification subscriptions.

Subscriptions belong to a user, not to the instance: a TA muting pull request
notifications must leave the professor's own choices untouched. Every test that
involves two people asserts that separation directly.
"""
from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.notification_preference import (
    DEFAULT_SUBSCRIBED_EVENTS,
    NotificationPreference,
)
from app.models.user import User

URL = "/api/v1/notifications/preferences"


@pytest_asyncio.fixture
async def other_user(db_session: AsyncSession) -> User:
    """A second account, for asserting one user's choices do not leak."""
    user = User(
        id=uuid.uuid4(),
        email="ta@example.edu",
        display_name="Dana TA",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def other_headers(other_user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(other_user.id)})}"}


async def test_defaults_to_every_event_subscribed(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A user who has never touched this gets everything, not nothing."""
    res = await test_client.get(URL, headers=auth_headers)

    assert res.status_code == 200
    assert res.json()["subscribed_events"] == DEFAULT_SUBSCRIBED_EVENTS


async def test_reading_preferences_does_not_require_a_saved_row(
    test_client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """The default is computed, so a GET alone stays a read."""
    await test_client.get(URL, headers=auth_headers)

    rows = await db_session.execute(
        NotificationPreference.__table__.select()
    )
    assert rows.first() is None


async def test_muting_one_event_leaves_the_rest_alone(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A client sends only what it changed; the server must not reset the rest."""
    res = await test_client.put(
        URL,
        headers=auth_headers,
        json={"subscribed_events": {"pr_opened": False}},
    )

    assert res.status_code == 200
    events = res.json()["subscribed_events"]
    assert events["pr_opened"] is False
    assert all(value for key, value in events.items() if key != "pr_opened")


async def test_successive_updates_accumulate(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"pr_opened": False}}
    )
    res = await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"repo_added": False}}
    )

    events = res.json()["subscribed_events"]
    assert events["pr_opened"] is False
    assert events["repo_added"] is False
    assert events["mention"] is True


async def test_a_muted_event_can_be_turned_back_on(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"mention": False}}
    )
    res = await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"mention": True}}
    )

    assert res.json()["subscribed_events"]["mention"] is True


async def test_unknown_event_names_are_rejected(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A typo would otherwise save a key nothing ever reads."""
    res = await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"pr_opend": False}}
    )

    assert res.status_code == 422


async def test_each_user_keeps_their_own_subscriptions(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    """The professor muting PRs must not mute them for the TA as well."""
    await test_client.put(
        URL, headers=auth_headers, json={"subscribed_events": {"pr_opened": False}}
    )
    await test_client.put(
        URL, headers=other_headers, json={"subscribed_events": {"repo_removed": False}}
    )

    mine = (await test_client.get(URL, headers=auth_headers)).json()
    theirs = (await test_client.get(URL, headers=other_headers)).json()

    assert mine["subscribed_events"]["pr_opened"] is False
    assert mine["subscribed_events"]["repo_removed"] is True
    assert theirs["subscribed_events"]["pr_opened"] is True
    assert theirs["subscribed_events"]["repo_removed"] is False


async def test_preferences_require_authentication(test_client: AsyncClient) -> None:
    assert (await test_client.get(URL)).status_code == 401

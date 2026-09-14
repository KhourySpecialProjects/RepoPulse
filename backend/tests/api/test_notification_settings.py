"""The email relay settings endpoints.

Covers the two things that are easy to get wrong here: never handing stored
credentials back out, and not wiping a saved secret when the client submits the
form without re-typing it.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_setting import NotificationSetting
from app.models.user import User
from app.services.email.base import EmailDeliveryError

SETTINGS_URL = "/api/v1/notifications/settings"
TEST_EMAIL_URL = "/api/v1/notifications/settings/test-email"


@pytest_asyncio.fixture
async def relay(db_session: AsyncSession, test_user: User) -> NotificationSetting:
    setting = NotificationSetting(
        id=uuid.uuid4(),
        user_id=test_user.id,
        email_enabled=True,
        transport="smtp",
        from_email="repopulse@example.edu",
        from_name="RepoPulse",
        smtp_host="smtp.example.edu",
        smtp_port=587,
        smtp_username="relay-user",
        smtp_password="super-secret",
        smtp_encryption="starttls",
    )
    db_session.add(setting)
    await db_session.flush()
    return setting


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


async def test_get_requires_auth(test_client: AsyncClient) -> None:
    response = await test_client.get(SETTINGS_URL)
    assert response.status_code == 401


async def test_get_returns_defaults_when_never_configured(
    test_client: AsyncClient, auth_headers: dict[str, str], test_user: User
) -> None:
    """A user who has never opened the panel still gets a usable shape."""
    response = await test_client.get(SETTINGS_URL, headers=auth_headers)
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["email_enabled"] is False
    assert body["transport"] == "smtp"
    assert body["deliverable"] is False
    assert body["smtp_password_set"] is False
    assert body["resend_api_key_set"] is False
    # Every event defaults to subscribed, so enabling the relay just works.
    assert body["subscribed_events"]["mention"] is True
    assert body["subscribed_events"]["repo_health_declined"] is True


async def test_get_never_returns_stored_secrets(
    test_client: AsyncClient, auth_headers: dict[str, str], relay: NotificationSetting
) -> None:
    response = await test_client.get(SETTINGS_URL, headers=auth_headers)
    assert response.status_code == 200

    body = response.json()
    assert "smtp_password" not in body
    assert "resend_api_key" not in body
    assert "super-secret" not in response.text
    # The UI still needs to know a password exists, to render "saved".
    assert body["smtp_password_set"] is True
    assert body["deliverable"] is True


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


async def test_put_creates_a_row_on_first_save(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    test_user: User,
) -> None:
    response = await test_client.put(
        SETTINGS_URL,
        json={
            "email_enabled": True,
            "transport": "resend",
            "from_email": "noreply@example.edu",
            "from_name": "CS 3200 Bot",
            "resend_api_key": "re_live_key",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["resend_api_key_set"] is True

    stored = (
        await db_session.execute(
            select(NotificationSetting).where(
                NotificationSetting.user_id == test_user.id
            )
        )
    ).scalar_one()
    assert stored.transport == "resend"
    assert stored.resend_api_key == "re_live_key"


async def test_put_omitting_a_secret_keeps_the_stored_one(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    relay: NotificationSetting,
) -> None:
    """The form never receives the password, so submitting it must not clear it."""
    response = await test_client.put(
        SETTINGS_URL,
        json={"from_name": "Renamed"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    await db_session.refresh(relay)
    assert relay.from_name == "Renamed"
    assert relay.smtp_password == "super-secret"


async def test_put_can_explicitly_clear_a_secret(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    relay: NotificationSetting,
) -> None:
    """An empty string is how the UI says "forget this credential"."""
    response = await test_client.put(
        SETTINGS_URL, json={"smtp_password": ""}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["smtp_password_set"] is False

    await db_session.refresh(relay)
    assert relay.smtp_password is None


async def test_put_updates_event_subscriptions(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    relay: NotificationSetting,
) -> None:
    response = await test_client.put(
        SETTINGS_URL,
        json={"subscribed_events": {"mention": False, "pr_merged": True}},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    events = response.json()["subscribed_events"]
    assert events["mention"] is False
    assert events["pr_merged"] is True


async def test_put_rejects_an_unknown_transport(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await test_client.put(
        SETTINGS_URL, json={"transport": "carrier-pigeon"}, headers=auth_headers
    )
    assert response.status_code == 422


async def test_put_rejects_an_unknown_encryption(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await test_client.put(
        SETTINGS_URL, json={"smtp_encryption": "rot13"}, headers=auth_headers
    )
    assert response.status_code == 422


async def test_put_rejects_an_unknown_event_key(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A typo'd event name would silently never send."""
    response = await test_client.put(
        SETTINGS_URL,
        json={"subscribed_events": {"mentiond": False}},
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_put_rejects_an_out_of_range_port(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await test_client.put(
        SETTINGS_URL, json={"smtp_port": 70000}, headers=auth_headers
    )
    assert response.status_code == 422


async def test_put_reports_not_deliverable_when_config_is_incomplete(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Saving a half-filled relay is allowed, but must be flagged."""
    response = await test_client.put(
        SETTINGS_URL,
        json={"email_enabled": True, "transport": "smtp", "from_email": "a@b.edu"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["deliverable"] is False


async def test_settings_are_per_user(
    test_client: AsyncClient,
    db_session: AsyncSession,
    relay: NotificationSetting,
) -> None:
    from app.core.auth import create_access_token

    other = User(
        id=uuid.uuid4(),
        email="other@example.edu",
        display_name="Other",
        role="instructor",
    )
    db_session.add(other)
    await db_session.flush()

    response = await test_client.get(
        SETTINGS_URL,
        headers={"Authorization": f"Bearer {create_access_token({'sub': str(other.id)})}"},
    )
    assert response.status_code == 200
    # Must not see the fixture user's relay.
    assert response.json()["email_enabled"] is False
    assert response.json()["smtp_password_set"] is False


# ---------------------------------------------------------------------------
# Test email
# ---------------------------------------------------------------------------


async def test_test_email_sends_to_the_current_user(
    test_client: AsyncClient, auth_headers: dict[str, str], relay: NotificationSetting
) -> None:
    with patch(
        "app.api.routes.notifications.send_test_email", new=AsyncMock()
    ) as send:
        response = await test_client.post(TEST_EMAIL_URL, headers=auth_headers)

    assert response.status_code == 200, response.text
    send.assert_awaited_once()
    assert send.await_args.args[1] == "test@example.com"


async def test_test_email_400s_when_the_relay_is_not_configured(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await test_client.post(TEST_EMAIL_URL, headers=auth_headers)

    assert response.status_code == 400
    assert response.json()["error_code"] == "email_relay_not_configured"


async def test_test_email_502s_and_reports_why_on_failure(
    test_client: AsyncClient, auth_headers: dict[str, str], relay: NotificationSetting
) -> None:
    """The provider's reason is the whole value of a test button."""
    with patch(
        "app.api.routes.notifications.send_test_email",
        new=AsyncMock(side_effect=EmailDeliveryError("SMTP delivery failed: auth failed")),
    ):
        response = await test_client.post(TEST_EMAIL_URL, headers=auth_headers)

    assert response.status_code == 502
    assert "auth failed" in response.json()["detail"]
    assert response.json()["error_code"] == "email_delivery_failed"

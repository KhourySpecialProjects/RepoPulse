"""The email relay transports.

No test here touches the network. The SMTP adapter's `aiosmtplib.send` and the
Resend adapter's HTTP client are both patched, and the assertions are about the
envelope and payload each transport builds.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.email import get_email_service
from app.services.email.base import EmailDeliveryError, OutboundEmail
from app.services.email.resend_adapter import ResendAdapter
from app.services.email.smtp_adapter import SMTPAdapter


@pytest.fixture
def message() -> OutboundEmail:
    return OutboundEmail(
        to="ta@example.edu",
        subject="You were mentioned",
        text="Spiros mentioned you on team-4.",
    )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def test_factory_returns_smtp_adapter_for_smtp_transport() -> None:
    service = get_email_service(
        "smtp", from_email="noreply@example.edu", smtp_host="smtp.example.edu", smtp_port=587
    )
    assert isinstance(service, SMTPAdapter)


def test_factory_returns_resend_adapter_for_resend_transport() -> None:
    service = get_email_service(
        "resend", from_email="noreply@example.edu", resend_api_key="re_test"
    )
    assert isinstance(service, ResendAdapter)


def test_factory_defaults_to_smtp_for_an_unknown_transport() -> None:
    """An unrecognised transport must not silently drop mail."""
    service = get_email_service(
        "carrier-pigeon",
        from_email="noreply@example.edu",
        smtp_host="smtp.example.edu",
        smtp_port=587,
    )
    assert isinstance(service, SMTPAdapter)


# ---------------------------------------------------------------------------
# SMTP
# ---------------------------------------------------------------------------


async def test_smtp_sends_with_the_configured_envelope(message: OutboundEmail) -> None:
    service = SMTPAdapter(
        host="smtp.example.edu",
        port=587,
        username="relay-user",
        password="relay-pass",
        encryption="starttls",
        from_email="noreply@example.edu",
        from_name="RepoPulse",
    )

    with patch("aiosmtplib.send", new=AsyncMock()) as send:
        await service.send(message)

    send.assert_awaited_once()
    sent_message = send.await_args.args[0]
    kwargs = send.await_args.kwargs

    assert sent_message["To"] == "ta@example.edu"
    assert sent_message["Subject"] == "You were mentioned"
    # A display name must be quoted into the From header, not replace the address.
    assert sent_message["From"] == "RepoPulse <noreply@example.edu>"

    assert kwargs["hostname"] == "smtp.example.edu"
    assert kwargs["port"] == 587
    assert kwargs["username"] == "relay-user"
    assert kwargs["password"] == "relay-pass"


async def test_smtp_starttls_uses_start_tls_not_implicit_tls(message: OutboundEmail) -> None:
    service = SMTPAdapter(
        host="smtp.example.edu", port=587, encryption="starttls", from_email="a@b.edu"
    )

    with patch("aiosmtplib.send", new=AsyncMock()) as send:
        await service.send(message)

    assert send.await_args.kwargs["start_tls"] is True
    assert send.await_args.kwargs["use_tls"] is False


async def test_smtp_tls_uses_implicit_tls(message: OutboundEmail) -> None:
    """Port 465 style: the connection is TLS from the first byte."""
    service = SMTPAdapter(
        host="smtp.example.edu", port=465, encryption="tls", from_email="a@b.edu"
    )

    with patch("aiosmtplib.send", new=AsyncMock()) as send:
        await service.send(message)

    assert send.await_args.kwargs["use_tls"] is True
    assert send.await_args.kwargs["start_tls"] is False


async def test_smtp_none_disables_both_tls_modes(message: OutboundEmail) -> None:
    service = SMTPAdapter(
        host="localhost", port=1025, encryption="none", from_email="a@b.edu"
    )

    with patch("aiosmtplib.send", new=AsyncMock()) as send:
        await service.send(message)

    assert send.await_args.kwargs["use_tls"] is False
    assert send.await_args.kwargs["start_tls"] is False


async def test_smtp_omits_credentials_when_unauthenticated(message: OutboundEmail) -> None:
    """A local relay with no auth must not be sent empty-string credentials."""
    service = SMTPAdapter(
        host="localhost", port=1025, encryption="none", from_email="a@b.edu"
    )

    with patch("aiosmtplib.send", new=AsyncMock()) as send:
        await service.send(message)

    assert send.await_args.kwargs["username"] is None
    assert send.await_args.kwargs["password"] is None


async def test_smtp_wraps_transport_failures(message: OutboundEmail) -> None:
    """Callers must see one error type regardless of transport."""
    service = SMTPAdapter(
        host="smtp.example.edu", port=587, encryption="starttls", from_email="a@b.edu"
    )

    with patch("aiosmtplib.send", new=AsyncMock(side_effect=OSError("connection refused"))):
        with pytest.raises(EmailDeliveryError) as exc:
            await service.send(message)

    assert "connection refused" in str(exc.value)


# ---------------------------------------------------------------------------
# Resend
# ---------------------------------------------------------------------------


async def test_resend_posts_the_expected_payload(message: OutboundEmail) -> None:
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "email_123"})

    service = ResendAdapter(
        api_key="re_test_key",
        from_email="noreply@example.edu",
        from_name="RepoPulse",
        transport=httpx.MockTransport(handler),
    )
    await service.send(message)

    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["auth"] == "Bearer re_test_key"
    assert captured["body"]["from"] == "RepoPulse <noreply@example.edu>"
    assert captured["body"]["to"] == ["ta@example.edu"]
    assert captured["body"]["subject"] == "You were mentioned"
    assert captured["body"]["text"] == "Spiros mentioned you on team-4."


async def test_resend_sends_a_bare_address_without_a_display_name(
    message: OutboundEmail,
) -> None:
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "email_123"})

    service = ResendAdapter(
        api_key="re_test_key",
        from_email="noreply@example.edu",
        transport=httpx.MockTransport(handler),
    )
    await service.send(message)

    assert captured["body"]["from"] == "noreply@example.edu"


async def test_resend_raises_on_api_error(message: OutboundEmail) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"message": "from address not verified"})

    service = ResendAdapter(
        api_key="re_test_key",
        from_email="noreply@example.edu",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(EmailDeliveryError) as exc:
        await service.send(message)

    # The provider's reason has to survive, or a misconfigured relay is
    # undiagnosable from the settings page.
    assert "from address not verified" in str(exc.value)

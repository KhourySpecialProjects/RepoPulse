from __future__ import annotations

from app.services.email.base import (
    EmailDeliveryError,
    EmailService,
    OutboundEmail,
)
from app.services.email.resend_adapter import ResendAdapter
from app.services.email.smtp_adapter import SMTPAdapter

__all__ = [
    "EmailDeliveryError",
    "EmailService",
    "OutboundEmail",
    "ResendAdapter",
    "SMTPAdapter",
    "get_email_service",
]


def get_email_service(
    transport: str,
    *,
    from_email: str,
    from_name: str | None = None,
    smtp_host: str | None = None,
    smtp_port: int | None = None,
    smtp_username: str | None = None,
    smtp_password: str | None = None,
    smtp_encryption: str = "starttls",
    resend_api_key: str | None = None,
) -> EmailService:
    """Factory: return the right EmailService based on transport.

    Unknown transports fall through to SMTP rather than raising, matching
    `get_llm_service`. A stored transport string that no longer maps to an
    adapter is a config problem, and failing to build the service here would
    turn it into a 500 on every notification instead of one delivery error.
    """
    if transport == "resend":
        return ResendAdapter(
            api_key=resend_api_key or "",
            from_email=from_email,
            from_name=from_name,
        )
    return SMTPAdapter(
        host=smtp_host or "",
        port=smtp_port or 587,
        from_email=from_email,
        from_name=from_name,
        username=smtp_username,
        password=smtp_password,
        encryption=smtp_encryption,
    )

"""SMTP transport, for university relays and anything Gmail/Outlook-shaped."""
from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib

from app.services.email.base import (
    EmailDeliveryError,
    EmailService,
    OutboundEmail,
    format_sender,
)


class SMTPAdapter(EmailService):
    def __init__(
        self,
        *,
        host: str,
        port: int,
        from_email: str,
        from_name: str | None = None,
        username: str | None = None,
        password: str | None = None,
        encryption: str = "starttls",
    ) -> None:
        self.host = host
        self.port = port
        self.from_email = from_email
        self.from_name = from_name
        self.username = username or None
        self.password = password or None
        self.encryption = encryption

    def _build(self, message: OutboundEmail) -> EmailMessage:
        msg = EmailMessage()
        msg["From"] = format_sender(self.from_email, self.from_name)
        msg["To"] = message.to
        msg["Subject"] = message.subject
        msg.set_content(message.text)
        if message.html:
            # The plain part stays as the fallback for text-only clients.
            msg.add_alternative(message.html, subtype="html")
        return msg

    async def send(self, message: OutboundEmail) -> None:
        # The two TLS modes are mutually exclusive: `use_tls` wraps the socket
        # from the first byte (port 465), `start_tls` upgrades a plaintext
        # connection with STARTTLS (port 587). Passing both makes aiosmtplib
        # raise, so the encryption setting maps to exactly one of them.
        try:
            await aiosmtplib.send(
                self._build(message),
                hostname=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                use_tls=self.encryption == "tls",
                start_tls=self.encryption == "starttls",
                timeout=20,
            )
        except Exception as exc:  # aiosmtplib raises OSError subclasses too
            raise EmailDeliveryError(f"SMTP delivery failed: {exc}") from exc

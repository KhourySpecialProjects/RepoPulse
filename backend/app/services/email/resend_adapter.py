"""Resend transport — an HTTP API, so no SMTP ports to unblock."""
from __future__ import annotations

import httpx

from app.services.email.base import (
    EmailDeliveryError,
    EmailService,
    OutboundEmail,
    format_sender,
)


class ResendAdapter(EmailService):
    API_URL = "https://api.resend.com/emails"

    def __init__(
        self,
        *,
        api_key: str,
        from_email: str,
        from_name: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.from_email = from_email
        self.from_name = from_name
        # Injected only by tests, so a send never reaches the real API.
        self._transport = transport

    async def send(self, message: OutboundEmail) -> None:
        payload: dict[str, object] = {
            "from": format_sender(self.from_email, self.from_name),
            "to": [message.to],
            "subject": message.subject,
            "text": message.text,
        }
        if message.html:
            payload["html"] = message.html

        try:
            async with httpx.AsyncClient(
                timeout=20, transport=self._transport
            ) as client:
                response = await client.post(
                    self.API_URL,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                )
                if response.status_code >= 400:
                    raise EmailDeliveryError(
                        f"Resend rejected the message ({response.status_code}): "
                        f"{_reason(response)}"
                    )
        except httpx.HTTPError as exc:
            raise EmailDeliveryError(f"Resend request failed: {exc}") from exc


def _reason(response: httpx.Response) -> str:
    """Resend's error text, falling back to the raw body if it is not JSON."""
    try:
        body = response.json()
    except ValueError:
        return response.text
    if isinstance(body, dict):
        return str(body.get("message") or body.get("name") or body)
    return str(body)

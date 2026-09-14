"""The transport-agnostic email interface.

Mirrors `app/services/llm/base.py`: callers depend on this interface only, so
adding a transport never touches the notification dispatcher.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.utils import formataddr


class EmailDeliveryError(Exception):
    """A send failed.

    Every transport raises this and nothing else, so the dispatcher can treat a
    refused SMTP connection and a rejected Resend API call identically. The
    provider's own message is preserved in the string: a bad relay is otherwise
    impossible to diagnose from the settings page.
    """


@dataclass
class OutboundEmail:
    """One message to one recipient.

    Named to stay clear of `email.message.EmailMessage`, which the SMTP adapter
    builds from this.
    """

    to: str
    subject: str
    text: str
    html: str | None = None


def format_sender(from_email: str, from_name: str | None) -> str:
    """Render a From value, quoting the display name when there is one.

    `formataddr` handles the quoting rules: a name containing a comma or a
    period would otherwise produce a header that some relays reject outright.
    """
    if from_name:
        return formataddr((from_name, from_email))
    return from_email


class EmailService(ABC):
    @abstractmethod
    async def send(self, message: OutboundEmail) -> None:
        """Deliver `message`, or raise `EmailDeliveryError`."""
        ...

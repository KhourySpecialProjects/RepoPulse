"""A notification has to say *what* it is about, not just which repo.

Clicking a mention dropped you on the repo page with no indication of which
note or commit raised it — on a repo with hundreds of commits and a drawer full
of notes, that is barely better than not linking at all.

The note behind a notification already knows: it carries `repo_id` and, when it
was written against a commit, `commit_hash`. Both belong in the payload so the
client can build a deep link instead of guessing.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.note import Note
from app.models.notification import Notification, NotificationType
from app.models.repo import Repo
from app.models.user import User

COMMIT_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"


@pytest_asyncio.fixture
async def linker(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="deeplink@example.com",
        display_name="Deep Linker",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def headers(linker: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(linker.id)})}"}


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, linker: User) -> Repo:
    col = Collection(
        id=uuid.uuid4(),
        name="Deep Link Collection",
        local_folder_name=f"deep-{uuid.uuid4().hex[:6]}",
        owner_id=linker.id,
    )
    db_session.add(col)
    await db_session.flush()

    r = Repo(
        id=uuid.uuid4(),
        collection_id=col.id,
        github_url="https://github.com/test/deep-link",
        name="deep-link-repo",
        local_path="/repos/deep/deep-link-repo",
        health_status="unknown",
    )
    db_session.add(r)
    await db_session.flush()
    return r


async def _notify(
    db: AsyncSession,
    *,
    recipient: User,
    note: Note,
    kind: NotificationType = NotificationType.mention,
) -> Notification:
    notif = Notification(
        id=uuid.uuid4(),
        recipient_id=recipient.id,
        type=kind,
        note_id=note.id,
        is_read=False,
    )
    db.add(notif)
    await db.flush()
    return notif


async def _only_item(client: AsyncClient, headers: dict) -> dict:
    resp = await client.get("/api/v1/notifications", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    return items[0]


@pytest.mark.asyncio
async def test_a_mention_on_a_commit_note_exposes_the_commit(
    test_client: AsyncClient,
    db_session: AsyncSession,
    linker: User,
    repo: Repo,
    headers: dict,
) -> None:
    note = Note(
        id=uuid.uuid4(),
        author_id=linker.id,
        repo_id=repo.id,
        commit_hash=COMMIT_SHA,
        content="@DeepLinker look at this commit",
    )
    db_session.add(note)
    await db_session.flush()
    await _notify(db_session, recipient=linker, note=note)

    item = await _only_item(test_client, headers)

    assert item["repo_id"] == str(repo.id)
    assert item["note_id"] == str(note.id)
    assert item["commit_hash"] == COMMIT_SHA


@pytest.mark.asyncio
async def test_a_mention_on_a_plain_note_has_no_commit(
    test_client: AsyncClient,
    db_session: AsyncSession,
    linker: User,
    repo: Repo,
    headers: dict,
) -> None:
    """A repo-level note still links, just to the note rather than a commit."""
    note = Note(
        id=uuid.uuid4(),
        author_id=linker.id,
        repo_id=repo.id,
        content="@DeepLinker general thought",
    )
    db_session.add(note)
    await db_session.flush()
    await _notify(db_session, recipient=linker, note=note)

    item = await _only_item(test_client, headers)

    assert item["repo_id"] == str(repo.id)
    assert item["note_id"] == str(note.id)
    assert item["commit_hash"] is None


@pytest.mark.asyncio
async def test_a_reminder_keeps_its_commit(
    test_client: AsyncClient,
    db_session: AsyncSession,
    linker: User,
    repo: Repo,
    headers: dict,
) -> None:
    """Reminders are notes too, so a reminder set on a commit links to it."""
    reminder = Note(
        id=uuid.uuid4(),
        author_id=linker.id,
        repo_id=repo.id,
        commit_hash=COMMIT_SHA,
        content="Check this before grading",
        is_reminder=True,
    )
    db_session.add(reminder)
    await db_session.flush()
    await _notify(db_session, recipient=linker, note=reminder, kind=NotificationType.reminder)

    item = await _only_item(test_client, headers)

    assert item["commit_hash"] == COMMIT_SHA
    assert item["repo_id"] == str(repo.id)


@pytest.mark.asyncio
async def test_the_single_notification_endpoint_agrees_with_the_list(
    test_client: AsyncClient,
    db_session: AsyncSession,
    linker: User,
    repo: Repo,
    headers: dict,
) -> None:
    """Marking one read returns a payload too, and it must carry the link."""
    note = Note(
        id=uuid.uuid4(),
        author_id=linker.id,
        repo_id=repo.id,
        commit_hash=COMMIT_SHA,
        content="@DeepLinker here",
    )
    db_session.add(note)
    await db_session.flush()
    notif = await _notify(db_session, recipient=linker, note=note)

    resp = await test_client.patch(
        f"/api/v1/notifications/{notif.id}/read", headers=headers
    )

    assert resp.status_code == 200
    assert resp.json()["commit_hash"] == COMMIT_SHA

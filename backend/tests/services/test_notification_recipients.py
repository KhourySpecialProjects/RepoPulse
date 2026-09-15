"""Who a repo-scoped event reaches.

`recipients_for_repo` is the audience rule for every repo-scoped notification,
so it is tested directly rather than through each event that calls it.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.repo import Repo
from app.models.user import User
from app.services.notification_service import recipients_for_repo


async def test_recipients_for_repo_covers_owner_access_and_admins(
    db_session: AsyncSession,
) -> None:
    owner = User(id=uuid.uuid4(), email="owner@example.edu", display_name="Owner", role="instructor")
    co = User(id=uuid.uuid4(), email="co@example.edu", display_name="Co Instructor", role="instructor")
    ta = User(id=uuid.uuid4(), email="ta2@example.edu", display_name="Tam TA", role="ta")
    admin = User(id=uuid.uuid4(), email="admin@example.edu", display_name="Admin", role="admin")
    outsider = User(id=uuid.uuid4(), email="nope@example.edu", display_name="Outsider", role="instructor")
    db_session.add_all([owner, co, ta, admin, outsider])
    await db_session.flush()

    collection = Collection(
        id=uuid.uuid4(),
        name="CS 3200",
        local_folder_name="cs3200",
        owner_id=owner.id,
    )
    db_session.add(collection)
    await db_session.flush()

    db_session.add_all(
        [
            CollectionAccess(
                id=uuid.uuid4(),
                collection_id=collection.id,
                user_id=co.id,
                access_role=CollectionRole.co_instructor,
            ),
            CollectionAccess(
                id=uuid.uuid4(),
                collection_id=collection.id,
                user_id=ta.id,
                access_role=CollectionRole.ta,
            ),
        ]
    )
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/team-4",
        name="team-4",
        local_path="/repos/cs3200/team-4",
        health_status="green",
    )
    db_session.add(repo)
    await db_session.flush()

    recipients = await recipients_for_repo(db_session, repo)
    ids = {user.id for user in recipients}

    assert owner.id in ids
    assert co.id in ids
    assert ta.id in ids
    # Admins can reach every collection, so they are legitimate recipients.
    assert admin.id in ids
    assert outsider.id not in ids


async def test_recipients_for_repo_deduplicates_an_admin_who_also_owns(
    db_session: AsyncSession,
) -> None:
    admin_owner = User(
        id=uuid.uuid4(), email="both@example.edu", display_name="Admin Owner", role="admin"
    )
    db_session.add(admin_owner)
    await db_session.flush()

    collection = Collection(
        id=uuid.uuid4(), name="CS 4500", local_folder_name="cs4500", owner_id=admin_owner.id
    )
    db_session.add(collection)
    await db_session.flush()

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/solo",
        name="solo",
        local_path="/repos/cs4500/solo",
        health_status="green",
    )
    db_session.add(repo)
    await db_session.flush()

    recipients = await recipients_for_repo(db_session, repo)

    assert [user.id for user in recipients].count(admin_owner.id) == 1

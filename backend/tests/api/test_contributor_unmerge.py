"""Merge history survives requests and unwinds one group at a time."""
import uuid

import pytest

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.summary import Summary
from app.core.auth import create_access_token


async def make_contributors(db, user):
    collection = Collection(name="Unmerge", local_folder_name="unmerge", owner_id=user.id)
    db.add(collection)
    await db.flush()
    repo = Repo(name="example", github_url="https://github.com/test/example", collection_id=collection.id)
    db.add(repo)
    await db.flush()
    contributors = []
    for index, name in enumerate(["Alice", "Bob", "Charlie"]):
        c = Contributor(repo_id=repo.id, display_name=name, commit_count=index + 1,
                        total_insertions=(index + 1) * 10, total_deletions=index)
        db.add(c)
        await db.flush()
        db.add(ContributorAlias(contributor_id=c.id, git_email=f"{name}@example.com", git_name=name))
        contributors.append(c)
    await db.commit()
    return repo, contributors


@pytest.mark.asyncio
@pytest.mark.parametrize("nested_primary", [True, False])
async def test_nested_merges_restore_original_groups(test_client, db_session, test_user, auth_headers, nested_primary):
    repo, people = await make_contributors(db_session, test_user)
    a, b, c = [str(p.id) for p in people]
    note = Note(contributor_id=people[1].id, author_id=test_user.id, content="Keep this note")
    summary = Summary(contributor_id=people[1].id, summary_type="contributor_activity", content="Keep summary", model_used="mock")
    db_session.add_all([note, summary])
    await db_session.commit()

    async def merge(ids, name):
        response = await test_client.post('/api/v1/contributors/merge', headers=auth_headers,
                                         json={"contributor_ids": ids, "display_name": name})
        assert response.status_code == 200, response.text
        assert response.json()["can_unmerge"] is True
        db_session.expunge_all()  # history must survive a fresh load
        return response.json()

    first = await merge([a, b], "AB")
    assert first['commit_count'] == 3
    final = await merge([a, c] if nested_primary else [c, a], "ABC")
    assert final['commit_count'] == 6
    response = await test_client.post(f'/api/v1/contributors/{final["id"]}/unmerge', headers=auth_headers)
    assert response.status_code == 200, response.text
    restored = {p['id']: p for p in response.json()['contributors']}
    assert set(restored) == {a, c}
    assert restored[a]['display_name'] == 'AB'
    assert restored[a]['can_unmerge'] is True
    assert restored[c]['can_unmerge'] is False
    db_session.expunge_all()
    response = await test_client.post(f'/api/v1/contributors/{a}/unmerge', headers=auth_headers)
    assert response.status_code == 200, response.text
    restored = {p['id']: p for p in response.json()['contributors']}
    assert restored[a]['display_name'] == 'Alice'
    assert restored[b]['display_name'] == 'Bob'
    assert restored[a]['commit_count'] == 1
    assert restored[b]['commit_count'] == 2
    assert restored[b]['aliases'][0]['git_email'] == 'Bob@example.com'
    assert not any(p['can_unmerge'] for p in restored.values())
    db_session.expunge_all()
    assert (await db_session.get(Note, note.id)).contributor_id == uuid.UUID(b)
    assert (await db_session.get(Summary, summary.id)).contributor_id == uuid.UUID(b)
    listed = await test_client.get(f'/api/v1/repos/{repo.id}/contributors', headers=auth_headers)
    assert len(listed.json()) == 3
    assert all(not p['can_unmerge'] for p in listed.json())


@pytest.mark.asyncio
async def test_no_history_and_invalid_merges(test_client, db_session, test_user, auth_headers):
    _, people = await make_contributors(db_session, test_user)
    a = str(people[0].id)
    response = await test_client.post(f'/api/v1/contributors/{a}/unmerge', headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["error_code"] == "NO_MERGE_HISTORY"
    response = await test_client.post('/api/v1/contributors/merge', headers=auth_headers,
                                     json={"contributor_ids": [a, a], "display_name": "Duplicate"})
    assert response.status_code == 400
    _, others = await make_contributors(db_session, test_user)
    response = await test_client.post('/api/v1/contributors/merge', headers=auth_headers,
                                     json={"contributor_ids": [a, str(others[0].id)], "display_name": "Different repos"})
    assert response.status_code == 400
    outsider = {"Authorization": f"Bearer {create_access_token({'sub': str(uuid.uuid4())})}"}
    response = await test_client.post(f'/api/v1/contributors/{a}/unmerge', headers=outsider)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_unmerge_keeps_new_records_and_refreshes_stats(test_client, db_session, test_user, auth_headers, monkeypatch):
    from unittest.mock import AsyncMock
    from datetime import datetime, timezone
    from app.services.git_service import GitService

    repo, people = await make_contributors(db_session, test_user)
    a, b = people[:2]
    response = await test_client.post('/api/v1/contributors/merge', headers=auth_headers,
                                     json={"contributor_ids": [str(a.id), str(b.id)], "display_name": "AB"})
    assert response.status_code == 200
    new_note = Note(contributor_id=a.id, author_id=test_user.id, content="After merge")
    new_alias = ContributorAlias(contributor_id=a.id, git_email="new@example.com", git_name="New alias")
    db_session.add_all([new_note, new_alias])
    repo.local_path = '/mock/repo'
    await db_session.commit()
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(GitService, 'parse_commits', AsyncMock(return_value=[
        {"author_email": "Alice@example.com", "insertions": 11, "deletions": 2, "date": now},
        {"author_email": "Bob@example.com", "insertions": 20, "deletions": 3, "date": now},
        {"author_email": "Bob@example.com", "insertions": 5, "deletions": 1, "date": now},
        {"author_email": "new@example.com", "insertions": 4, "deletions": 0, "date": now},
    ]))
    response = await test_client.post(f'/api/v1/contributors/{a.id}/unmerge', headers=auth_headers)
    assert response.status_code == 200
    restored = {p['id']: p for p in response.json()['contributors']}
    assert restored[str(a.id)]['commit_count'] == 2
    assert restored[str(a.id)]['total_insertions'] == 15
    assert restored[str(b.id)]['total_insertions'] == 25
    assert len(restored[str(a.id)]['aliases']) == 2
    await db_session.refresh(new_note)
    assert new_note.contributor_id == a.id

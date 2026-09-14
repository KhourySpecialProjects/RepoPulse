"""Removal must work for synced repositories with dependent records."""
import pytest
from sqlalchemy import select

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.note_comment import NoteComment
from app.models.notification import Notification, NotificationType
from app.models.summary import Summary
from app.models.pull_request import PullRequest
from app.models.commit_classification import CommitClassification


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_at_end", [False, True])
async def test_remove_synced_repo_cleans_only_its_records(test_client, db_session, test_user, auth_headers, tmp_path, monkeypatch, fail_at_end):
    collection = Collection(name='Removal test', local_folder_name='removal', owner_id=test_user.id)
    db_session.add(collection)
    await db_session.flush()
    clone = tmp_path / 'local-repo'
    clone.mkdir()
    marker = clone / 'keep.txt'
    marker.write_text('Local files must remain')
    removed = []
    kept = []
    for name, records in [('remove', removed), ('keep', kept)]:
        repo = Repo(name=name, github_url=f'https://github.com/test/{name}', collection_id=collection.id, local_path=str(clone))
        db_session.add(repo)
        await db_session.flush()
        contributor = Contributor(repo_id=repo.id, display_name=name)
        db_session.add(contributor)
        await db_session.flush()
        alias = ContributorAlias(contributor_id=contributor.id, git_email=f'{name}@example.com', git_name=name)
        # Include both repo notes and contributor-only notes.
        note = Note(repo_id=repo.id, author_id=test_user.id, content=name)
        contributor_note = Note(contributor_id=contributor.id, author_id=test_user.id, content='Student note')
        summary = Summary(repo_id=repo.id, summary_type='repo_overview', content=name, model_used='mock')
        contributor_summary = Summary(contributor_id=contributor.id, summary_type='contributor_activity', content=name, model_used='mock')
        pr = PullRequest(repo_id=repo.id, pr_number=1, title=name, state='open')
        quality = CommitClassification(repo_id=repo.id, commit_hash='a'*40, score='good', model_used='mock')
        db_session.add_all([alias, note, contributor_note, summary, contributor_summary, pr, quality])
        await db_session.flush()
        comment = NoteComment(note_id=contributor_note.id, author_id=test_user.id, content='Comment')
        db_session.add(comment)
        await db_session.flush()
        notification = Notification(recipient_id=test_user.id, type=NotificationType.note_comment, note_id=contributor_note.id, comment_id=comment.id)
        db_session.add(notification)
        await db_session.flush()
        records.extend((type(row), row.id) for row in [repo, contributor, alias, note, contributor_note, summary, contributor_summary, pr, quality, comment, notification])
    await db_session.commit()
    if fail_at_end:
        from sqlalchemy.sql.dml import Delete
        execute = db_session.execute

        async def fail_final_delete(statement, *args, **kwargs):
            if isinstance(statement, Delete) and statement.table.name == 'repos':
                raise RuntimeError('Simulated deletion failure')
            return await execute(statement, *args, **kwargs)

        with monkeypatch.context() as patch:
            patch.setattr(db_session, 'execute', fail_final_delete)
            with pytest.raises(RuntimeError, match='Simulated deletion failure'):
                await test_client.delete(f'/api/v1/repos/{removed[0][1]}', headers=auth_headers)
        for model, row_id in removed + kept:
            assert await db_session.scalar(select(model.id).where(model.id == row_id)) == row_id
        assert marker.exists()
        return
    response = await test_client.delete(f'/api/v1/repos/{removed[0][1]}', headers=auth_headers)
    assert response.status_code == 200, response.text
    for model, row_id in removed:
        assert await db_session.scalar(select(model.id).where(model.id == row_id)) is None
    for model, row_id in kept:
        assert await db_session.scalar(select(model.id).where(model.id == row_id)) == row_id
    assert marker.read_text() == 'Local files must remain'
    listed = await test_client.get(f'/api/v1/collections/{collection.id}/repos', headers=auth_headers)
    assert listed.json()['total'] == 1
    again = await test_client.delete(f'/api/v1/repos/{removed[0][1]}', headers=auth_headers)
    assert again.status_code == 404

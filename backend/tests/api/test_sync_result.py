import uuid
from unittest.mock import AsyncMock, patch
import pytest
from app.models.collection import Collection
from app.models.repo import Repo

@pytest.mark.asyncio
@pytest.mark.parametrize('fails', [False, True])
async def test_sync_reports_completed_result(test_client, db_session, test_user, auth_headers, fails):
    test_user.github_token = 'test-private-token'
    collection = Collection(id=uuid.uuid4(), name='Private', local_folder_name='private-test', owner_id=test_user.id)
    db_session.add(collection)
    await db_session.flush()
    repo = Repo(id=uuid.uuid4(), collection_id=collection.id, name='private', github_url='https://github.com/owner/private', local_path='/clone')
    db_session.add(repo)
    await db_session.flush()
    with patch('app.api.routes.repos._fetch_and_recompute', new=AsyncMock(side_effect=RuntimeError('private failure') if fails else None)) as sync:
        response = await test_client.post(f'/api/v1/repos/{repo.id}/sync', headers=auth_headers)
    if fails:
        assert response.status_code == 502
        assert response.json()['error_code'] == 'REPO_SYNC_FAILED'
        assert 'private failure' not in response.text
    else:
        assert response.status_code == 200
        assert response.json()['detail'] == 'Sync completed'
    sync.assert_awaited_once_with(repo.id, 'test-private-token')

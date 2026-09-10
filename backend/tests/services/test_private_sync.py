from unittest.mock import MagicMock, patch
import pytest
from app.services.git_service import GitService

@pytest.mark.parametrize('url', ['git@github.com:owner/private.git', 'ssh://git@github.com/owner/private.git'])
def test_private_ssh_remote_uses_saved_https_token(url):
    assert GitService._inject_token(url, 'fresh-token') == 'https://x-access-token:fresh-token@github.com/owner/private.git'

def test_fetch_disables_interactive_auth_and_refreshes_credentials():
    repo = MagicMock()
    remote = repo.remotes.__iter__.return_value = [MagicMock(url='https://x-access-token:expired@github.com/owner/private.git')]
    with patch('app.services.git_service.git.Repo', return_value=repo):
        GitService()._fetch_repo_sync('/clone', 'fresh-token')
    remote[0].set_url.assert_called_once_with('https://x-access-token:fresh-token@github.com/owner/private.git')
    repo.git.custom_environment.assert_called_once_with(GIT_TERMINAL_PROMPT='0')
    remote[0].fetch.assert_called_once()

@pytest.mark.asyncio
async def test_indexing_does_not_swallow_manual_sync_failure():
    from unittest.mock import AsyncMock
    from app.api.routes.repos import _fetch_and_recompute
    db = AsyncMock()
    db.get.return_value = MagicMock(local_path='/clone', id='repo')
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=db)
    context.__aexit__ = AsyncMock(return_value=False)
    with patch('app.db.database.async_session_maker', return_value=context), patch('app.api.routes.repos.Path.exists', return_value=True), patch('app.api.routes.repos._git_service.fetch_repo', new=AsyncMock(side_effect=RuntimeError('secret-token'))):
        with pytest.raises(RuntimeError, match='Repository sync failed') as error:
            await _fetch_and_recompute('repo', 'fresh-token')
    assert 'secret-token' not in str(error.value)
    db.commit.assert_not_awaited()

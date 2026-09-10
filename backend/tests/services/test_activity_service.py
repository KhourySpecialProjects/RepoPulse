from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.services.activity_service import collect_activity

@pytest.mark.asyncio
async def test_collect_activity_keeps_repo_counts_and_merged_student_aliases():
    student = SimpleNamespace(id='student', display_name='Alice', aliases=[SimpleNamespace(git_email='A@EXAMPLE.COM'), SimpleNamespace(git_email='other@example.com')])
    repos = [SimpleNamespace(id='one', name='One', local_path='/one', contributors=[student]), SimpleNamespace(id='two', name='Two', local_path='/two', contributors=[])]
    commits = [{'hash': 'a', 'date': '2026-09-01T12:00:00Z', 'author_email': 'a@example.com'}, {'hash': 'b', 'date': '2026-09-01T12:00:00Z', 'author_email': 'other@example.com'}]
    git = SimpleNamespace(parse_commits=AsyncMock(return_value=commits + [commits[0]]))
    result = await collect_activity(repos, git)
    assert result[0].activity[0].count == 2
    assert result[1].activity[0].count == 2
    assert result[0].students[0].activity[0].count == 2

@pytest.mark.asyncio
async def test_unreadable_repository_is_explicitly_unavailable():
    repos = [SimpleNamespace(id='one', name='One', local_path='/one', contributors=[])]
    result = await collect_activity(repos, SimpleNamespace(parse_commits=AsyncMock(side_effect=RuntimeError('broken'))))
    assert result[0].available is False
    assert result[0].activity == []

@pytest.mark.asyncio
async def test_activity_uses_utc_dates_and_complete_history():
    repo = SimpleNamespace(id='one', name='One', local_path='/one', contributors=[])
    commits = [{'hash': str(i), 'date': '2026-09-02T00:30:00+02:00', 'author_email': 'a@example.com'} for i in range(600)]
    result = await collect_activity([repo], SimpleNamespace(parse_commits=AsyncMock(return_value=commits)))
    assert result[0].activity[0].date == '2026-09-01'
    assert result[0].activity[0].count == 600

"""Clone sizes are measured at the end of every sync.

`AdminStatsService.recalculate_repo_sizes` used to be the only writer of
`repos.size_bytes`, and nothing in the application invoked it, so the admin
Storage tab reported "0 repos measured / 0 B" on a perfectly healthy instance
and no amount of syncing changed that. Measuring at the end of an index run
makes the figures self-maintaining: the tree has just been cloned or fetched,
so it is still in page cache and the walk costs a fraction of what it would
standalone.

These tests drive `_measure_clone_size` directly rather than through
`_index_repo`. `_index_repo` deliberately bypasses the injected session and
opens its own against the app's global `async_session_maker`, which is exactly
why the autouse `no_background_indexing` fixture in conftest neutralises it —
see that fixture's docstring. The measurement therefore lives in a helper with
no session of its own, which is both the testable shape and the one that keeps
the write inside the transaction `_index_repo` already commits.

Note that no new background function is introduced here. Adding one would
escape `no_background_indexing` and open a session against DATABASE_URL,
writing to the developer's real database from the test suite.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from app.api.routes import repos
from app.models.repo import Repo


def _repo(**overrides: Any) -> Repo:
    """An unsaved Repo. Never added to a session, so no database is involved."""
    fields: dict[str, Any] = {
        "id": uuid.uuid4(),
        "collection_id": uuid.uuid4(),
        "name": "project",
        "github_url": "https://github.com/test/project",
        "local_path": "/repos/cs3200-s26/project",
    }
    fields.update(overrides)
    return Repo(**fields)


class _FakeGit:
    """Stands in for the module-level GitService during a measurement."""

    def __init__(
        self,
        result: dict[str, int] | None = None,
        error: Exception | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self.calls: list[str] = []

    async def get_repo_size(self, local_path: str) -> dict[str, int] | None:
        self.calls.append(local_path)
        if self._error is not None:
            raise self._error
        return self._result


@pytest.fixture
def fake_git(monkeypatch: pytest.MonkeyPatch):
    def install(**kwargs: Any) -> _FakeGit:
        git = _FakeGit(**kwargs)
        monkeypatch.setattr(repos, "_git_service", git)
        return git

    return install


async def test_a_sync_records_the_clone_size(fake_git) -> None:
    git = fake_git(result={"total": 5_000, "git": 3_000, "worktree": 2_000})
    repo = _repo()

    await repos._measure_clone_size(repo)

    assert repo.size_bytes == 5_000
    assert repo.git_size_bytes == 3_000
    assert git.calls == ["/repos/cs3200-s26/project"]


async def test_the_measurement_timestamp_is_timezone_aware(fake_git) -> None:
    """`size_computed_at` is `DateTime(timezone=True)`.

    `last_synced_at` two lines away in `_index_repo` is written naive with
    `datetime.utcnow()`; copying that here would store a naive value in an
    aware column and shift the displayed staleness by the server's offset.
    """
    fake_git(result={"total": 1, "git": 0, "worktree": 1})
    repo = _repo()

    await repos._measure_clone_size(repo)

    assert repo.size_computed_at is not None
    assert repo.size_computed_at.tzinfo is not None


async def test_an_empty_clone_records_zero_rather_than_staying_unmeasured(
    fake_git,
) -> None:
    """0 and NULL are different facts: "measured, empty" vs "never measured"."""
    fake_git(result={"total": 0, "git": 0, "worktree": 0})
    repo = _repo()

    await repos._measure_clone_size(repo)

    assert repo.size_bytes == 0
    assert repo.size_computed_at is not None


async def test_a_vanished_clone_keeps_its_previous_measurement(fake_git) -> None:
    """`None` from get_repo_size means "the path is not there", never "zero".

    Same rule the recalculate path follows: an unmounted volume must not wipe
    the fleet's measurement history.
    """
    fake_git(result=None)
    earlier = datetime(2026, 9, 1, tzinfo=timezone.utc)
    repo = _repo(size_bytes=900, git_size_bytes=400, size_computed_at=earlier)

    await repos._measure_clone_size(repo)

    assert repo.size_bytes == 900
    assert repo.git_size_bytes == 400
    assert repo.size_computed_at == earlier


async def test_a_measurement_failure_does_not_fail_the_sync(fake_git) -> None:
    """By this point health, contributors and sync state are already computed.

    Losing all of that to a failed stat on one directory would be a bad trade,
    so the helper contains its own errors instead of propagating into
    `_index_repo`'s except branch, which would mark the whole sync failed.
    """
    fake_git(error=OSError("input/output error"))
    repo = _repo(size_bytes=900)

    await repos._measure_clone_size(repo)

    assert repo.size_bytes == 900
    assert repo.size_computed_at is None


async def test_an_unexpected_error_is_contained_too(fake_git) -> None:
    """Broader than the OSError the recalculate path catches, deliberately.

    A size number is worth strictly less than the data already in hand, so
    there is no failure mode here worth escalating into a failed sync.
    """
    fake_git(error=RuntimeError("boom"))
    repo = _repo()

    await repos._measure_clone_size(repo)

    assert repo.size_bytes is None


async def test_a_repo_with_no_local_path_is_not_measured(fake_git) -> None:
    git = fake_git(result={"total": 1, "git": 1, "worktree": 0})
    repo = _repo(local_path=None)

    await repos._measure_clone_size(repo)

    assert git.calls == []
    assert repo.size_computed_at is None


def test_the_index_path_actually_calls_the_measurement() -> None:
    """A guard against the exact failure this feature exists to fix.

    `useRecalculateAdminStorage` was written, tested, and never called from any
    component — the endpoint behind it worked perfectly while the UI reported
    zero, because nothing reached the writer. A helper no caller invokes is the
    same bug, and every test above would still pass with the call site deleted.
    Reading the bytecode's global names is cheap and catches the wiring being
    dropped in a refactor.
    """
    assert "_measure_clone_size" in repos._index_repo.__code__.co_names

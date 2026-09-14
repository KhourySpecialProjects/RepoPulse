"""Tests for POST /repos/{repo_id}/commits/classify.

Two patch targets matter here and are easy to get wrong:

* `app.api.routes.commit_classification._git_service.parse_commits` — this
  module owns its own GitService instance, so patching the one in
  `app.api.routes.repos` does nothing, and the autouse `no_background_indexing`
  fixture only neutralises `repos`.
* `app.services.commit_classifier_service.get_llm_service` — patched at the
  service, not the route, because `build_classifier` closes over it lazily.
  Asserting it was *never called* is how we prove no LLM was constructed.

`PREVIEW_THRESHOLD` / `MAX_LLM_PER_REQUEST` / `WAVE_SIZE` are monkeypatched
small rather than building 500-commit fixtures; the route reads them as module
globals for exactly this reason.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes import commit_classification as cc
from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sha(i: int) -> str:
    return f"{i:040d}"


def _commit(sha: str, message: str, *, day: int = 1, paths: list[str] | None = None) -> dict:
    return {
        "hash": sha,
        "author_name": "Alice",
        "author_email": "alice@example.com",
        "date": datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(hours=day),
        "message": message,
        "branches": ["main"],
        "insertions": 120,
        "deletions": 15,
        "files_changed": 4,
        "file_paths": paths if paths is not None else ["app/main.py"],
        "file_paths_truncated": False,
        "diffstat_available": True,
    }


def _substantive(n: int, start: int = 0) -> list[dict]:
    """Commits the rules prefilter cannot decide — they must reach the LLM."""
    return [
        _commit(_sha(i), f"Add feature {i}", day=i)
        for i in range(start, start + n)
    ]


def _logistical(n: int, start: int = 0) -> list[dict]:
    """Commits the rules prefilter decides on its own, with no LLM call."""
    return [
        _commit(_sha(i), f"docs: update section {i}", day=i, paths=["README.md"])
        for i in range(start, start + n)
    ]


def _llm_json(n: int = 40, *, t: str = "substantive", s: str = "good") -> str:
    """A response covering more indices than any chunk will use.

    `_parse_response` looks up `by_index.get(i)` for i in range(chunk_size), so
    extra entries are harmless and this works for any chunk size <= n.
    """
    return json.dumps([{"i": i, "s": s, "t": t} for i in range(n)])


def _patch_parse(commits: list[dict]):
    return patch(
        "app.api.routes.commit_classification._git_service.parse_commits",
        new=AsyncMock(return_value=commits),
    )


def _patch_llm(generate):
    """Patch the LLM factory; `generate` may be a coroutine fn or a value."""
    mock_factory = patch("app.services.commit_classifier_service.get_llm_service")
    return mock_factory, generate


class _LLM:
    """Records call count so "the model was never asked" is assertable."""

    def __init__(self, responder) -> None:
        self._responder = responder
        self.calls = 0

    async def generate(self, prompt: str, **kwargs) -> str:
        self.calls += 1
        if callable(self._responder):
            return self._responder(prompt)
        return self._responder


async def _make_collection(db: AsyncSession, owner_id: uuid.UUID) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Classify Collection",
        local_folder_name=f"classify-{uuid.uuid4().hex[:6]}",
        owner_id=owner_id,
    )
    db.add(col)
    await db.flush()
    return col


async def _make_repo(
    db: AsyncSession,
    collection_id: uuid.UUID,
    name: str = "classify-repo",
    local_path: str | None = "/fake/path/classify-repo",
) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection_id,
        github_url=f"https://github.com/test/{name}",
        name=name,
        local_path=local_path,
        health_status="unknown",
    )
    db.add(repo)
    await db.flush()
    return repo


async def _rows(db: AsyncSession, repo_id: uuid.UUID) -> list[CommitClassification]:
    """Re-read rows, forcing the identity map to refresh.

    The route writes via `pg_insert`, which SQLAlchemy cannot reconcile with
    objects this session already holds. Without `populate_existing` a SELECT
    returns the *stale* instance the test itself added, so an assertion that
    the route updated a row would fail even when it did.
    """
    result = await db.execute(
        select(CommitClassification)
        .where(CommitClassification.repo_id == repo_id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def _url(repo_id) -> str:
    return f"/api/v1/repos/{repo_id}/commits/classify"


@pytest_asyncio.fixture
async def outsider(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="outsider_classify@example.com",
        display_name="Outsider",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def outsider_headers(outsider: User) -> dict[str, str]:
    token = create_access_token({"sub": str(outsider.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _clear_in_flight():
    """No test may leak a held repo id into the next one."""
    cc._in_flight.clear()
    yield
    cc._in_flight.clear()


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_404_for_unknown_repo(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    resp = await test_client.post(
        _url(uuid.uuid4()), headers=auth_headers, json={"confirm": False}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_classify_404_when_collection_inaccessible(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    outsider_headers: dict,
) -> None:
    """404, not 403 — matching repos.py rather than commit_quality.py."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.post(
        _url(repo.id), headers=outsider_headers, json={"confirm": False}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_classify_400_when_repo_has_no_local_path(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, local_path=None)

    resp = await test_client.post(
        _url(repo.id), headers=auth_headers, json={"confirm": False}
    )
    assert resp.status_code == 400
    assert "no local path" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_classify_empty_repo_returns_zeros_without_building_an_llm(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse([]), patch(
        "app.services.commit_classifier_service.get_llm_service"
    ) as factory:
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert resp.status_code == 200
    assert body["status"] == "completed"
    assert body["total_commits"] == 0
    assert body["pending"] == 0
    assert body["classified"] == 0
    factory.assert_not_called()


# ---------------------------------------------------------------------------
# Happy path & counting
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_persists_types_and_counts_add_up(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(3)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["status"] == "completed"
    assert body["total_commits"] == 3
    assert body["pending"] == 3
    assert body["classified_by_llm"] == 3
    assert body["classified"] == 3
    assert body["skipped"] == 0
    # The invariant the UI phrases its sentence from.
    assert (
        body["already_classified"]
        + body["classified"]
        + body["skipped"]
        + body["remaining"]
        == body["total_commits"]
    )

    rows = await _rows(db_session, repo.id)
    assert len(rows) == 3
    assert {r.commit_type for r in rows} == {"substantive"}


@pytest.mark.asyncio
async def test_classify_is_idempotent_and_skips_the_llm_entirely(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A fully classified repo must not construct an LLM at all.

    That property is what lets a cached repo work with no API key configured.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(2)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service"
    ) as factory:
        second = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = second.json()
    assert body["already_classified"] == 2
    assert body["pending"] == 0
    assert body["classified"] == 0
    factory.assert_not_called()
    assert len(await _rows(db_session, repo.id)) == 2


@pytest.mark.asyncio
async def test_classify_resolves_rule_hits_without_any_llm_call(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """docs-only commits are decided by the prefilter, and say so in model_used."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _logistical(4)

    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service"
    ) as factory:
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["resolvable_by_rules"] == 4
    assert body["needs_llm"] == 0
    assert body["classified_by_rules"] == 4
    assert body["classified_by_llm"] == 0
    factory.assert_not_called()

    rows = await _rows(db_session, repo.id)
    assert {r.commit_type for r in rows} == {"logistical"}
    assert {r.model_used for r in rows} == {cc.RULES_MODEL}


# ---------------------------------------------------------------------------
# Partial rows — the score/type interaction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_treats_a_score_only_row_as_pending_and_keeps_its_score(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """The most important test in this file.

    The Collections page writes rows carrying a score and no type. If candidate
    selection tested row *presence* those commits would never be typed, and if
    the upsert wrote the whole row it would erase the score. Both halves are
    checked here.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(1)
    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=commits[0]["hash"],
            score="good",
            commit_type=None,
            model_used="some-older-model",
        )
    )
    await db_session.flush()

    llm = _LLM(_llm_json(t="substantive", s="bad"))
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["already_classified"] == 0, "a score-only row is not classified"
    assert body["pending"] == 1

    rows = await _rows(db_session, repo.id)
    assert len(rows) == 1, "must update the existing row, not insert a second"
    assert rows[0].commit_type == "substantive"
    assert rows[0].score == "good", "the existing score must survive"


@pytest.mark.asyncio
async def test_classify_does_not_rewrite_model_used_or_scored_at_on_update(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Both columns serve two dimensions, so a type-only update must not touch
    them — otherwise an existing score is reattributed to whatever just decided
    the type."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(1)
    original_time = datetime(2020, 1, 1, 0, 0, 0)
    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=commits[0]["hash"],
            score="good",
            commit_type=None,
            model_used="some-older-model",
            scored_at=original_time,
        )
    )
    await db_session.flush()

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    rows = await _rows(db_session, repo.id)
    assert rows[0].commit_type == "substantive", "the type was still written"
    assert rows[0].model_used == "some-older-model"
    assert rows[0].scored_at == original_time


@pytest.mark.asyncio
async def test_classify_persists_the_score_it_got_for_free(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """The prompt always returns both dimensions, so discarding the score would
    throw away something already paid for."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(2)

    llm = _LLM(_llm_json(t="substantive", s="ok"))
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    rows = await _rows(db_session, repo.id)
    assert {r.score for r in rows} == {"ok"}
    assert {r.commit_type for r in rows} == {"substantive"}


# ---------------------------------------------------------------------------
# Failure never fabricates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_persists_nothing_when_the_llm_raises(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(3)

    def _boom(prompt: str) -> str:
        raise RuntimeError("upstream is down")

    llm = _LLM(_boom)
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert resp.status_code == 200, "an LLM outage is not a request failure"
    assert body["classified"] == 0
    assert body["skipped"] == 3
    assert await _rows(db_session, repo.id) == []


@pytest.mark.asyncio
async def test_classify_persists_nothing_on_unparseable_json(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(2)

    llm = _LLM("I'm afraid I can't do that.")
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    assert resp.json()["skipped"] == 2
    assert await _rows(db_session, repo.id) == []


@pytest.mark.asyncio
async def test_classify_one_bad_chunk_does_not_lose_the_others(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Blast radius is one chunk (40 commits), not the run.

    The responder keys off prompt content rather than call order, because
    chunks are dispatched concurrently and call order is not deterministic.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(cc.BATCH_SIZE * 2)

    def _second_chunk_fails(prompt: str) -> str:
        return "garbage" if f"Add feature {cc.BATCH_SIZE}" in prompt else _llm_json()

    llm = _LLM(_second_chunk_fails)
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["classified"] == cc.BATCH_SIZE
    assert body["skipped"] == cc.BATCH_SIZE
    assert len(await _rows(db_session, repo.id)) == cc.BATCH_SIZE


# ---------------------------------------------------------------------------
# Preview, confirm, and the per-request cap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_previews_above_the_threshold_and_writes_nothing(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    monkeypatch,
) -> None:
    monkeypatch.setattr(cc, "PREVIEW_THRESHOLD", 2)
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(3)

    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service"
    ) as factory:
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["status"] == "preview"
    assert body["needs_llm"] == 3
    assert body["classified"] == 0
    assert body["threshold"] == 2
    factory.assert_not_called()
    assert await _rows(db_session, repo.id) == [], "a preview writes nothing at all"


@pytest.mark.asyncio
async def test_classify_preview_threshold_ignores_rule_hits(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    monkeypatch,
) -> None:
    """Cost is the LLM-bound count, not the unclassified count.

    A docs-heavy repo should not be gated behind a confirmation dialog for work
    the prefilter does instantly and for free.
    """
    monkeypatch.setattr(cc, "PREVIEW_THRESHOLD", 3)
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _logistical(10) + _substantive(2, start=100)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    body = resp.json()
    assert body["status"] == "completed", "12 pending but only 2 need the model"
    assert body["resolvable_by_rules"] == 10
    assert body["needs_llm"] == 2
    assert body["classified"] == 12


@pytest.mark.asyncio
async def test_classify_with_confirm_proceeds_past_the_threshold(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    monkeypatch,
) -> None:
    monkeypatch.setattr(cc, "PREVIEW_THRESHOLD", 2)
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(3)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": True}
        )

    body = resp.json()
    assert body["status"] == "completed"
    assert body["classified"] == 3
    assert len(await _rows(db_session, repo.id)) == 3


@pytest.mark.asyncio
async def test_classify_caps_work_per_request_and_reports_remaining(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    monkeypatch,
) -> None:
    """Even a confirmed run is bounded, so one request cannot run for 25 minutes."""
    monkeypatch.setattr(cc, "MAX_LLM_PER_REQUEST", 2)
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(5)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": True}
        )

    body = resp.json()
    assert body["classified"] == 2
    assert body["remaining"] == 3
    assert body["skipped"] == 0, "deferred work is not failed work"
    assert (
        body["already_classified"]
        + body["classified"]
        + body["skipped"]
        + body["remaining"]
        == body["total_commits"]
    )
    assert len(await _rows(db_session, repo.id)) == 2


@pytest.mark.asyncio
async def test_classify_commits_once_per_wave(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    monkeypatch,
) -> None:
    """Work is persisted as it lands, not accumulated to the end.

    Deliberately NOT a durability test: under the conftest's
    join_transaction_mode="create_savepoint" a route commit is a RELEASE
    SAVEPOINT inside a never-committed outer transaction, so "wave 1 survived a
    crash" is unobservable here. Counting commits is the honest proxy.
    """
    monkeypatch.setattr(cc, "WAVE_SIZE", 2)
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(5)  # no rule hits, so 3 waves: 2 + 2 + 1

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ), patch.object(
        db_session, "commit", wraps=db_session.commit
    ) as spy:
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": True}
        )

    assert resp.json()["classified"] == 5
    assert spy.call_count == 3


# ---------------------------------------------------------------------------
# Concurrent runs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classify_returns_409_while_a_run_is_in_flight(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """409 rather than a second duplicate run.

    Asserts the *body*, not just the status: a 404 here would be rewritten by
    main.py's global handler into "Resource not found", which would tell the
    user their repo doesn't exist while classification is running fine.

    Two real concurrent requests can't be used — the dependency override hands
    every request the same AsyncSession — so the in-flight set is seeded
    directly, which is what a running request does anyway.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    cc._in_flight.add(repo.id)

    resp = await test_client.post(
        _url(repo.id), headers=auth_headers, json={"confirm": False}
    )

    assert resp.status_code == 409
    assert "already" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_classify_releases_the_guard_after_success(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    llm = _LLM(_llm_json())
    with _patch_parse(_substantive(1)), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    assert repo.id not in cc._in_flight


@pytest.mark.asyncio
async def test_classify_releases_the_guard_after_a_failure(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A repo must not be permanently un-classifiable because a run blew up."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with patch(
        "app.api.routes.commit_classification._git_service.parse_commits",
        new=AsyncMock(side_effect=RuntimeError("bad clone")),
    ):
        resp = await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    assert resp.status_code == 400
    assert repo.id not in cc._in_flight


# ---------------------------------------------------------------------------
# End to end with the read path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classified_commits_disappear_from_the_unclassified_filter(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    commits = _substantive(3)

    llm = _LLM(_llm_json())
    with _patch_parse(commits), patch(
        "app.services.commit_classifier_service.get_llm_service", return_value=llm
    ):
        await test_client.post(
            _url(repo.id), headers=auth_headers, json={"confirm": False}
        )

    with patch(
        "app.api.routes.repos._git_service.parse_commits",
        new=AsyncMock(return_value=commits),
    ):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?commit_type=unclassified",
            headers=auth_headers,
        )
        all_resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?commit_type=substantive",
            headers=auth_headers,
        )

    assert resp.json()["total"] == 0
    assert all_resp.json()["total"] == 3

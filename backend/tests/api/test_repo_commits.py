"""Tests for GET /repos/{repo_id}/commits.

This endpoint had no coverage at all before M3, despite being the one the repo
Commits table renders from. These tests characterise what it does *today*, so
that adding `commit_type` / `quality_score` in the next step has a baseline to
move against.

`parse_commits` is patched throughout — it is the module-level singleton
`app.api.routes.repos._git_service`, and it shells out to a real clone
otherwise. Note the fake commits carry **full 40-character SHAs** in `hash`,
because that is what the real `parse_commits` emits and what
`commit_classifications.commit_hash` stores; the short-hash/`full_hash` shape
belongs to `get_recent_commits`, which this endpoint does not use.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers & fixtures
# ---------------------------------------------------------------------------


def _sha(seed: str) -> str:
    """A distinct, valid-length 40-char SHA for `seed`."""
    return (seed * 40)[:40]


SHA_FEATURE = _sha("a1")
SHA_DOCS = _sha("b2")
SHA_MERGE = _sha("c3")


def _commit(
    sha: str,
    message: str,
    *,
    day: int,
    branches: list[str],
    email: str = "alice@example.com",
    name: str = "Alice",
) -> dict:
    """One entry shaped like GitService.parse_commits output."""
    return {
        "hash": sha,
        "author_name": name,
        "author_email": email,
        # tz-aware: parse_commits forces UTC on naive commit dates.
        "date": datetime(2026, 1, day, 12, 0, tzinfo=timezone.utc),
        "message": message,
        "branches": branches,
        "insertions": 100,
        "deletions": 10,
        "files_changed": 5,
        "file_paths": ["app/main.py"],
        "file_paths_truncated": False,
        "diffstat_available": True,
    }


# Newest first, matching parse_commits' own ordering.
FAKE_COMMITS = [
    _commit(SHA_MERGE, "Merge branch 'feature/auth'", day=3, branches=["main"]),
    _commit(SHA_DOCS, "docs: update README", day=2, branches=["main", "feature/auth"]),
    _commit(
        SHA_FEATURE,
        "Add JWT refresh token support",
        day=1,
        branches=["feature/auth"],
        email="bob@example.com",
        name="Bob",
    ),
]


async def _make_collection(db: AsyncSession, owner_id: uuid.UUID) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Commits Collection",
        local_folder_name=f"commits-{uuid.uuid4().hex[:6]}",
        owner_id=owner_id,
    )
    db.add(col)
    await db.flush()
    return col


async def _make_repo(
    db: AsyncSession,
    collection_id: uuid.UUID,
    name: str = "commits-repo",
    local_path: str | None = "/fake/path/commits-repo",
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


async def _classify(
    db: AsyncSession,
    repo_id: uuid.UUID,
    commit_hash: str,
    *,
    commit_type: str | None = None,
    score: str | None = None,
) -> CommitClassification:
    """Write a sidecar row. Either dimension may be None — that is the whole
    point of the table, and the filter has to cope with partial rows."""
    row = CommitClassification(
        id=uuid.uuid4(),
        repo_id=repo_id,
        commit_hash=commit_hash,
        commit_type=commit_type,
        score=score,
        model_used="test-model",
    )
    db.add(row)
    await db.flush()
    return row


@pytest_asyncio.fixture
async def outsider(db_session: AsyncSession) -> User:
    """A user with no role in the collection under test."""
    user = User(
        id=uuid.uuid4(),
        email="outsider_commits@example.com",
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


def _patch_parse(commits: list[dict] | None = None, side_effect=None):
    kwargs = {"side_effect": side_effect} if side_effect else {"return_value": commits}
    return patch(
        "app.api.routes.repos._git_service.parse_commits",
        new=AsyncMock(**kwargs),
    )


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


# NOTE: main.py:79 registers a global `@app.exception_handler(404)` that
# replaces the body of *every* 404 with this, discarding whatever `detail` the
# route passed to HTTPException. So `detail="Repo not found"` in repos.py is
# dead text as far as clients are concerned. 400 and 409 have no such handler
# and do surface their own detail — see the 400 tests below.
GENERIC_404 = {"detail": "Resource not found", "error_code": "NOT_FOUND"}


@pytest.mark.asyncio
async def test_repo_commits_404_for_unknown_repo(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    resp = await test_client.get(
        f"/api/v1/repos/{uuid.uuid4()}/commits", headers=auth_headers
    )
    assert resp.status_code == 404
    assert resp.json() == GENERIC_404


@pytest.mark.asyncio
async def test_repo_commits_404_masks_an_inaccessible_repo(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
    outsider_headers: dict,
) -> None:
    """An inaccessible repo is byte-identical to a missing one.

    Repo routes 404-mask rather than 403, so collection membership cannot be
    inferred from the response. Asserting the two bodies are *equal* pins the
    property itself rather than just the status code. The classify endpoint
    added in the next step has to match this; commit_quality.py returns 403
    instead and is the wrong thing to copy.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    forbidden = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits", headers=outsider_headers
    )
    missing = await test_client.get(
        f"/api/v1/repos/{uuid.uuid4()}/commits", headers=auth_headers
    )

    assert forbidden.status_code == missing.status_code == 404
    assert forbidden.json() == missing.json() == GENERIC_404


@pytest.mark.asyncio
async def test_repo_commits_400_when_repo_has_no_local_path(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, local_path=None)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
    )
    assert resp.status_code == 400
    assert "no local path" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_repo_commits_400_when_parse_commits_raises(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A bad clone is a 400, not a 500 — the failure is reported, not swallowed."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(side_effect=RuntimeError("not a git repository")):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert resp.status_code == 400
    assert "could not read commits" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Payload shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_commits_returns_paginated_envelope(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "limit", "offset"}
    assert body["total"] == 3
    assert body["offset"] == 0
    assert len(body["items"]) == 3


@pytest.mark.asyncio
async def test_repo_commits_preserves_parse_order_and_full_sha(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Order is whatever parse_commits gave (newest first), and `hash` is the
    untruncated SHA — the join key the classification sidecar is keyed on."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    hashes = [c["hash"] for c in resp.json()["items"]]
    assert hashes == [SHA_MERGE, SHA_DOCS, SHA_FEATURE]
    assert all(len(h) == 40 for h in hashes)


@pytest.mark.asyncio
async def test_repo_commits_item_carries_diffstat_and_branches(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    item = next(c for c in resp.json()["items"] if c["hash"] == SHA_DOCS)
    assert item["author_name"] == "Alice"
    assert item["author_email"] == "alice@example.com"
    assert item["message"] == "docs: update README"
    assert item["branches"] == ["main", "feature/auth"]
    assert item["insertions"] == 100
    assert item["deletions"] == 10
    assert item["files_changed"] == 5


# ---------------------------------------------------------------------------
# Pagination & filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_commits_total_is_the_full_count_not_the_page_size(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """`total` counts everything that passed the filters; `items` is the slice.

    This is the property the `?commit_type=` filter must not break: it has to be
    applied *before* total is computed, or the count and the page disagree.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?limit=1&offset=1",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 3
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert [c["hash"] for c in body["items"]] == [SHA_DOCS]


@pytest.mark.asyncio
async def test_repo_commits_filters_by_branch(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?branch=feature/auth",
            headers=auth_headers,
        )

    body = resp.json()
    # A commit is on a branch if the name appears anywhere in its list.
    assert body["total"] == 2
    assert {c["hash"] for c in body["items"]} == {SHA_DOCS, SHA_FEATURE}


@pytest.mark.asyncio
async def test_repo_commits_filters_by_date_range(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits"
            "?date_from=2026-01-02T00:00:00Z&date_to=2026-01-02T23:59:59Z",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["hash"] == SHA_DOCS


@pytest.mark.asyncio
async def test_repo_commits_rejects_limit_above_ceiling(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """limit is capped at 500 by Query(le=500) — the client-side window the
    Commits page relies on."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits?limit=501", headers=auth_headers
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_repo_commits_empty_repo_returns_empty_envelope(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse([]):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}


# ---------------------------------------------------------------------------
# M3: commit_type / quality_score on each item
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_commits_fields_are_null_when_unclassified(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """No sidecar row means null, not a fabricated default.

    The frontend renders these as an em dash; an "ok"/"logistical" default here
    would be indistinguishable from a real verdict.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert resp.status_code == 200
    for item in resp.json()["items"]:
        assert item["commit_type"] is None
        assert item["quality_score"] is None


@pytest.mark.asyncio
async def test_repo_commits_merges_type_and_score(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    await _classify(
        db_session, repo.id, SHA_FEATURE, commit_type="substantive", score="good"
    )
    await _classify(db_session, repo.id, SHA_DOCS, commit_type="logistical")

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    by_hash = {c["hash"]: c for c in resp.json()["items"]}
    assert by_hash[SHA_FEATURE]["commit_type"] == "substantive"
    assert by_hash[SHA_FEATURE]["quality_score"] == "good"
    # A type-only row surfaces its type and leaves the score null.
    assert by_hash[SHA_DOCS]["commit_type"] == "logistical"
    assert by_hash[SHA_DOCS]["quality_score"] is None
    # Untouched commit stays null on both.
    assert by_hash[SHA_MERGE]["commit_type"] is None


@pytest.mark.asyncio
async def test_repo_commits_join_requires_the_full_sha(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A row keyed on a short hash must not match.

    get_recent_commits emits 7-char hashes and parse_commits emits 40-char
    ones. Keying the join on the wrong one fails silently — every commit simply
    reads as unclassified, with no error anywhere.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    await _classify(
        db_session, repo.id, SHA_FEATURE[:7], commit_type="substantive"
    )

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    by_hash = {c["hash"]: c for c in resp.json()["items"]}
    assert by_hash[SHA_FEATURE]["commit_type"] is None


@pytest.mark.asyncio
async def test_repo_commits_does_not_leak_another_repos_classification(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Two repos can legitimately share a SHA — forks, cherry-picks, submodule
    bumps — and the sidecar is keyed on (repo_id, commit_hash) for that reason."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, name="repo-a")
    other = await _make_repo(db_session, col.id, name="repo-b")
    await _classify(db_session, repo.id, SHA_FEATURE, commit_type="substantive")
    await _classify(db_session, other.id, SHA_FEATURE, commit_type="logistical")

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    by_hash = {c["hash"]: c for c in resp.json()["items"]}
    assert by_hash[SHA_FEATURE]["commit_type"] == "substantive"


# ---------------------------------------------------------------------------
# M3: ?commit_type= filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_commits_filters_by_commit_type(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    await _classify(db_session, repo.id, SHA_FEATURE, commit_type="substantive")
    await _classify(db_session, repo.id, SHA_DOCS, commit_type="logistical")
    await _classify(db_session, repo.id, SHA_MERGE, commit_type="logistical")

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?commit_type=logistical",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 2
    assert {c["hash"] for c in body["items"]} == {SHA_DOCS, SHA_MERGE}


@pytest.mark.asyncio
async def test_repo_commits_unclassified_filter_includes_score_only_rows(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """"Unclassified" means no *type*, not "no row".

    The Collections page writes score-only rows. Treating "a row exists" as
    "classified" would hide exactly those commits from the filter — and from
    the classify endpoint's candidate set, which is the same bug one layer down.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    await _classify(db_session, repo.id, SHA_FEATURE, commit_type="substantive")
    await _classify(db_session, repo.id, SHA_DOCS, score="good")  # type is NULL

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits?commit_type=unclassified",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 2
    assert {c["hash"] for c in body["items"]} == {SHA_DOCS, SHA_MERGE}


@pytest.mark.asyncio
async def test_repo_commits_type_filter_paginates_within_the_filtered_set(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """`total` must count the filtered set, and the slice must be taken from it.

    Filtering after the slice would yield `total: 10` and short pages — the
    failure mode that makes a filter look broken only on page 3.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    commits = [
        _commit(_sha(f"d{i}"), f"commit {i}", day=i + 1, branches=["main"])
        for i in range(10)
    ]
    # First 6 substantive, last 4 logistical.
    for i, c in enumerate(commits):
        await _classify(
            db_session,
            repo.id,
            c["hash"],
            commit_type="substantive" if i < 6 else "logistical",
        )

    with _patch_parse(commits):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits"
            "?commit_type=substantive&limit=2&offset=4",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 6
    assert [c["hash"] for c in body["items"]] == [
        commits[4]["hash"],
        commits[5]["hash"],
    ]


@pytest.mark.asyncio
async def test_repo_commits_type_filter_composes_with_branch(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)
    # SHA_DOCS and SHA_FEATURE are both on feature/auth; only one is logistical.
    await _classify(db_session, repo.id, SHA_DOCS, commit_type="logistical")
    await _classify(db_session, repo.id, SHA_FEATURE, commit_type="substantive")
    await _classify(db_session, repo.id, SHA_MERGE, commit_type="logistical")

    with _patch_parse(FAKE_COMMITS):
        resp = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits"
            "?branch=feature/auth&commit_type=logistical",
            headers=auth_headers,
        )

    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["hash"] == SHA_DOCS


@pytest.mark.asyncio
async def test_repo_commits_rejects_unknown_commit_type(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A typo must 422, not silently return an empty page.

    With a bare `str` param, `?commit_type=substantiv` would match nothing and
    look identical to "this repo has no substantive commits".
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits?commit_type=substantiv",
        headers=auth_headers,
    )
    assert resp.status_code == 422

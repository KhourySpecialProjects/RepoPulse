"""On-disk size accounting for clones.

Nothing in the app measured disk usage before this: no st_size, no getsize,
no du, no `git count-objects` anywhere in app/. It matters because the PRD
mandates full non-shallow clones and repo_removal_service deletes database
rows "without touching local or remote git files" — so a removed repo leaves
its clone on disk forever and nothing reported it.

Two contracts these tests pin, both easy to get wrong:

  * None means "no clone here"; 0 means "a clone that is empty". Collapsing
    them would make a never-measured repo indistinguishable from an empty one.
  * Symlinks are skipped outright, never followed. Following them would escape
    the tree, double-count, and can cycle forever.
"""

from __future__ import annotations

import os
from pathlib import Path

import git
import pytest

from app.services.git_service import GitService

service = GitService()


def _init_repo(path: Path) -> git.Repo:
    repo = git.Repo.init(path)
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Author")
        cw.set_value("user", "email", "test@example.com")
    return repo


# ---------------------------------------------------------------------------
# get_repo_size
# ---------------------------------------------------------------------------


async def test_get_repo_size_returns_none_for_a_path_that_does_not_exist(
    tmp_path: Path,
) -> None:
    assert await service.get_repo_size(str(tmp_path / "nope")) is None


async def test_get_repo_size_returns_none_for_a_file_rather_than_a_directory(
    tmp_path: Path,
) -> None:
    target = tmp_path / "a-file"
    target.write_text("x")
    assert await service.get_repo_size(str(target)) is None


async def test_get_repo_size_returns_zero_for_an_empty_directory(
    tmp_path: Path,
) -> None:
    """Zero is a measurement; None is the absence of one."""
    empty = tmp_path / "empty"
    empty.mkdir()

    size = await service.get_repo_size(str(empty))

    assert size == {"total": 0, "git": 0, "worktree": 0}


async def test_get_repo_size_sums_file_bytes(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    root.mkdir()
    (root / "a.txt").write_bytes(b"x" * 100)
    (root / "b.txt").write_bytes(b"y" * 50)

    size = await service.get_repo_size(str(root))

    assert size is not None
    assert size["total"] == 150


async def test_get_repo_size_counts_nested_directories(tmp_path: Path) -> None:
    root = tmp_path / "nested"
    (root / "deep" / "deeper").mkdir(parents=True)
    (root / "top.bin").write_bytes(b"x" * 10)
    (root / "deep" / "mid.bin").write_bytes(b"y" * 20)
    (root / "deep" / "deeper" / "low.bin").write_bytes(b"z" * 30)

    size = await service.get_repo_size(str(root))

    assert size is not None
    assert size["total"] == 60


async def test_get_repo_size_splits_git_from_worktree(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    repo = _init_repo(root)
    (root / "tracked.txt").write_bytes(b"x" * 500)
    repo.index.add(["tracked.txt"])
    repo.index.commit("initial")

    size = await service.get_repo_size(str(root))

    assert size is not None
    assert size["git"] > 0, ".git holds objects after a commit"
    assert size["worktree"] >= 500
    assert size["total"] == size["git"] + size["worktree"]


async def test_get_repo_size_reports_zero_git_for_a_directory_that_is_not_a_repo(
    tmp_path: Path,
) -> None:
    root = tmp_path / "not-a-repo"
    root.mkdir()
    (root / "file.txt").write_bytes(b"x" * 40)

    size = await service.get_repo_size(str(root))

    assert size == {"total": 40, "git": 0, "worktree": 40}


async def test_get_repo_size_does_not_follow_a_symlink_to_a_file(
    tmp_path: Path,
) -> None:
    """A link to a 10 KB file outside the tree must not be counted."""
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"x" * 10_000)
    root = tmp_path / "repo"
    root.mkdir()
    (root / "real.txt").write_bytes(b"y" * 25)
    os.symlink(outside, root / "link.bin")

    size = await service.get_repo_size(str(root))

    assert size is not None
    assert size["total"] == 25


async def test_get_repo_size_terminates_on_a_symlink_cycle(tmp_path: Path) -> None:
    """A link to an ancestor directory must not loop forever."""
    root = tmp_path / "repo"
    root.mkdir()
    (root / "real.txt").write_bytes(b"y" * 25)
    os.symlink(root, root / "loop")

    size = await service.get_repo_size(str(root))

    assert size is not None
    assert size["total"] == 25


@pytest.mark.skipif(
    hasattr(os, "geteuid") and os.geteuid() == 0,
    reason="root ignores mode bits, so the directory stays readable",
)
async def test_get_repo_size_survives_an_unreadable_subdirectory(
    tmp_path: Path,
) -> None:
    """A storage dashboard must not 500 because one directory is locked down."""
    root = tmp_path / "repo"
    locked = root / "locked"
    locked.mkdir(parents=True)
    (root / "readable.txt").write_bytes(b"x" * 12)
    locked.chmod(0o000)

    try:
        size = await service.get_repo_size(str(root))
        assert size is not None
        assert size["total"] >= 12
    finally:
        locked.chmod(0o755)


# ---------------------------------------------------------------------------
# clone_path
# ---------------------------------------------------------------------------


def test_clone_path_matches_the_layout_repos_py_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Storage accounting and repo creation must not disagree about the layout."""
    monkeypatch.setattr("app.services.git_service.settings.REPO_ROOT_DIR", "/repos")

    assert GitService.clone_path("cs101-fall", "project-a") == "/repos/cs101-fall/project-a"


def test_clone_path_tolerates_a_trailing_slash_on_the_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The old f-string produced '/repos//cs101/x'; Path joining does not."""
    monkeypatch.setattr("app.services.git_service.settings.REPO_ROOT_DIR", "/repos/")

    assert GitService.clone_path("cs101", "x") == "/repos/cs101/x"


# ---------------------------------------------------------------------------
# list_clone_directories
# ---------------------------------------------------------------------------


async def test_list_clone_directories_returns_depth_two_directories_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "coll-a" / "repo-1").mkdir(parents=True)
    (tmp_path / "coll-a" / "repo-2").mkdir(parents=True)
    (tmp_path / "coll-b" / "repo-3").mkdir(parents=True)
    # Neither of these is a clone: a stray file, and a bare directory at depth 1.
    (tmp_path / "coll-a" / "notes.txt").write_text("x")
    (tmp_path / "loose").mkdir()
    monkeypatch.setattr(
        "app.services.git_service.settings.REPO_ROOT_DIR", str(tmp_path)
    )

    found = await service.list_clone_directories()

    assert found == sorted(
        [
            os.path.normpath(str(tmp_path / "coll-a" / "repo-1")),
            os.path.normpath(str(tmp_path / "coll-a" / "repo-2")),
            os.path.normpath(str(tmp_path / "coll-b" / "repo-3")),
        ]
    )


async def test_list_clone_directories_is_empty_when_the_root_is_absent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unmounted /repos is a deployment state, not an error."""
    monkeypatch.setattr(
        "app.services.git_service.settings.REPO_ROOT_DIR", str(tmp_path / "missing")
    )

    assert await service.list_clone_directories() == []


async def test_list_clone_directories_accepts_an_explicit_root(
    tmp_path: Path,
) -> None:
    (tmp_path / "c" / "r").mkdir(parents=True)

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(tmp_path / "c" / "r"))]

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


# ---------------------------------------------------------------------------
# Clone-shape guards
#
# A naive depth-2 scan reported 10 orphaned clones against a real repo root
# that held exactly two: one project had been cloned one level too shallow,
# so its own subdirectories (api/, app/, docs/, .git/, ...) were each counted
# as a separate repo with no database row.
# ---------------------------------------------------------------------------


async def test_list_clone_directories_counts_a_shallow_clone_once(
    tmp_path: Path,
) -> None:
    """A clone at depth 1 is one clone, not one per subdirectory."""
    project = tmp_path / "DataDucksDB"
    _init_repo(project)
    for child in ("api", "app", "database-files", "datasets", "docs", "ml-src"):
        (project / child).mkdir()

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(project))]


async def test_list_clone_directories_finds_shallow_and_nested_clones_together(
    tmp_path: Path,
) -> None:
    """The real repo root has both shapes at once."""
    shallow = tmp_path / "DataDucksDB"
    _init_repo(shallow)
    (shallow / "app").mkdir()
    nested = tmp_path / "cs101" / "project-a"
    nested.mkdir(parents=True)
    _init_repo(nested)

    found = await service.list_clone_directories(str(tmp_path))

    assert found == sorted(
        [os.path.normpath(str(shallow)), os.path.normpath(str(nested))]
    )


async def test_list_clone_directories_skips_dot_directories(
    tmp_path: Path,
) -> None:
    """A clone is never named .cache or .ipynb_checkpoints.

    Counting hidden directories inflated the orphan count by one apiece.
    Deliberately no .git here — that would make the collection folder itself
    a clone, which the guard below covers instead.
    """
    collection = tmp_path / "cs101"
    (collection / "project-a").mkdir(parents=True)
    (collection / ".cache").mkdir()
    (collection / ".ipynb_checkpoints").mkdir()

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(collection / "project-a"))]


async def test_a_dot_git_at_collection_level_makes_the_collection_the_clone(
    tmp_path: Path,
) -> None:
    """The shallow-clone guard wins over descending into children.

    A folder holding .git is a clone whatever else is inside it, so it is
    reported once rather than having its children listed. This is the
    DataDucksDB case: the children are the project's own directories.
    """
    collection = tmp_path / "cs101"
    (collection / "project-a").mkdir(parents=True)
    (collection / ".git").mkdir()

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(collection))]


async def test_list_clone_directories_skips_a_dot_directory_at_the_root(
    tmp_path: Path,
) -> None:
    (tmp_path / ".claude" / "settings").mkdir(parents=True)
    (tmp_path / "cs101" / "project-a").mkdir(parents=True)

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(tmp_path / "cs101" / "project-a"))]


async def test_list_clone_directories_treats_a_git_file_as_a_clone(
    tmp_path: Path,
) -> None:
    """A worktree or submodule records .git as a file, not a directory."""
    project = tmp_path / "worktree-style"
    project.mkdir()
    (project / ".git").write_text("gitdir: /elsewhere/.git/worktrees/x\n")
    (project / "src").mkdir()

    found = await service.list_clone_directories(str(tmp_path))

    assert found == [os.path.normpath(str(project))]

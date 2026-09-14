"""Branch attribution: which branch was a commit actually made on?

`parse_commits` reports `branches` as every branch that *contains* a commit.
That is the right answer to "where can I find this commit" and the wrong answer
to "which branch was this work done on" — a trunk commit is contained in every
branch ever cut from it, so filtering on `branches` makes clicking `dev` match
essentially the whole repository.

`origin_branch` is the second answer: exactly one owning branch per commit,
defined as `trunk..branch` (the commits unique to that branch), with trunk
owning its own commits. Trunk is read from `origin/HEAD` so repos that develop
on something other than `main` attribute correctly.
"""
from __future__ import annotations

from pathlib import Path

import git
import pytest

from app.services.git_service import GitService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _init_repo(path: Path, initial_branch: str = "main") -> git.Repo:
    """Create a git repo with an identity, so commits can be made offline."""
    repo = git.Repo.init(path, initial_branch=initial_branch)
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Author")
        cw.set_value("user", "email", "test@example.com")
    return repo


def _commit(repo: git.Repo, filename: str, message: str) -> str:
    """Write a file and commit it; returns the new commit's sha."""
    root = Path(repo.working_tree_dir)
    (root / filename).write_text(message)
    repo.index.add([filename])
    return repo.index.commit(message).hexsha


def _origin_branches(commits: list[dict]) -> dict[str, str]:
    """Map commit message → origin_branch, which reads better in assertions."""
    return {c["message"]: c["origin_branch"] for c in commits}


# ---------------------------------------------------------------------------
# Attribution
# ---------------------------------------------------------------------------


async def test_trunk_commits_belong_to_trunk_not_to_branches_cut_from_it(
    tmp_path: Path,
) -> None:
    """The bug this fixes: a trunk commit is contained in every later branch.

    `branches` lists all of them, so filtering on it made `dev` match trunk's
    entire history. `origin_branch` must say `main` for work done on main.
    """
    repo = _init_repo(tmp_path / "repo")
    _commit(repo, "a.txt", "trunk one")
    _commit(repo, "b.txt", "trunk two")

    repo.create_head("dev").checkout()
    _commit(repo, "c.txt", "dev one")

    commits = await GitService().parse_commits(str(repo.working_tree_dir))
    owners = _origin_branches(commits)

    assert owners["trunk one"] == "main"
    assert owners["trunk two"] == "main"
    assert owners["dev one"] == "dev"

    # The containment field still reports both — it is unchanged, and the
    # "also on main" badge in the commits table depends on it.
    trunk_two = next(c for c in commits if c["message"] == "trunk two")
    assert set(trunk_two["branches"]) == {"main", "dev"}


async def test_every_commit_gets_exactly_one_origin_branch(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path / "repo")
    _commit(repo, "a.txt", "trunk one")
    repo.create_head("dev").checkout()
    _commit(repo, "b.txt", "dev one")

    commits = await GitService().parse_commits(str(repo.working_tree_dir))

    assert all(isinstance(c["origin_branch"], str) for c in commits)
    assert all(c["origin_branch"] for c in commits)


async def test_commits_shared_by_two_branches_go_to_the_more_specific_one(
    tmp_path: Path,
) -> None:
    """A branch cut from another branch shares its commits.

    Both are non-trunk, so both have the shared commits in `trunk..branch`.
    The tie-break is the smaller exclusive set — the more specific branch.
    """
    repo = _init_repo(tmp_path / "repo")
    _commit(repo, "a.txt", "trunk one")

    repo.create_head("dev").checkout()
    _commit(repo, "b.txt", "dev one")
    _commit(repo, "c.txt", "dev two")

    # feature is cut from dev, so it contains dev's commits plus its own.
    repo.create_head("feature").checkout()
    _commit(repo, "d.txt", "feature one")

    commits = await GitService().parse_commits(str(repo.working_tree_dir))
    owners = _origin_branches(commits)

    assert owners["trunk one"] == "main"
    assert owners["dev one"] == "dev"
    assert owners["dev two"] == "dev"
    assert owners["feature one"] == "feature"


# ---------------------------------------------------------------------------
# Trunk detection
# ---------------------------------------------------------------------------


async def test_trunk_comes_from_origin_head_not_a_hardcoded_name(
    tmp_path: Path,
) -> None:
    """RepoPulse's own repo develops on `devTesting`, with `main` far behind.

    Hardcoding main/master would attribute nearly every commit to a feature
    branch on repos like that, so trunk follows the clone's default branch.
    """
    source = _init_repo(tmp_path / "source", initial_branch="devTesting")
    _commit(source, "a.txt", "trunk one")
    source.create_head("sidebranch").checkout()
    _commit(source, "b.txt", "side one")
    # Leave HEAD on the default branch so the clone's origin/HEAD follows it.
    source.heads.devTesting.checkout()

    clone_path = tmp_path / "clone"
    git.Repo.clone_from(str(source.working_tree_dir), str(clone_path))

    commits = await GitService().parse_commits(str(clone_path))
    owners = _origin_branches(commits)

    assert owners["trunk one"] == "devTesting"
    assert owners["side one"] == "sidebranch"


async def test_trunk_falls_back_to_main_without_origin_head(tmp_path: Path) -> None:
    """A repo with no remote still needs a trunk; main/master is the fallback."""
    repo = _init_repo(tmp_path / "repo")
    _commit(repo, "a.txt", "trunk one")
    repo.create_head("dev").checkout()
    _commit(repo, "b.txt", "dev one")

    commits = await GitService().parse_commits(str(repo.working_tree_dir))
    owners = _origin_branches(commits)

    assert owners["trunk one"] == "main"
    assert owners["dev one"] == "dev"


async def test_single_branch_repo_attributes_everything_to_that_branch(
    tmp_path: Path,
) -> None:
    """No trunk/feature split to make: one branch owns all of it."""
    repo = _init_repo(tmp_path / "repo", initial_branch="trunk-only")
    _commit(repo, "a.txt", "only one")
    _commit(repo, "b.txt", "only two")

    commits = await GitService().parse_commits(str(repo.working_tree_dir))
    owners = _origin_branches(commits)

    assert owners["only one"] == "trunk-only"
    assert owners["only two"] == "trunk-only"

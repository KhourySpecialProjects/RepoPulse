"""Emit unlabeled eval rows from a git repository, one JSON object per line.

    python -m scripts.harvest_eval_commits --repo .. --source repopulse

Every row comes out with `expected_type: null`. **This script never guesses a
label.** A fixture labeled by heuristics measures the heuristics rather than the
prompt, and a fixture labeled by a model measures agreement with that model —
neither is ground truth. Harvest, then label by hand, then commit the result.

Why this shells out to git instead of using GitService, which CLAUDE.md makes
the single point of contact for git operations: GitService needs GitPython and
runs in the backend container, and that container mounts only ./backend — the
project's own .git is not visible from inside it. This script uses nothing but
the standard library so it can run on the host, which is where the history is.
The fields it emits mirror GitService._diffstat exactly; GitPython computes
those from `git diff --numstat` too, so the numbers agree.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# Mirrors _MAX_TRACKED_PATHS in app/services/git_service.py. Duplicated rather
# than imported because importing it would pull in GitPython.
MAX_TRACKED_PATHS = 20

_SEP = "\x1e"  # record separator — cannot occur in a commit message
_FIELD = "\x1f"


def _run(repo: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def harvest(repo: Path, source: str, limit: int | None) -> list[dict]:
    """Read commits with their diffstats. Merges carry no numstat output."""
    fmt = f"{_SEP}%h{_FIELD}%s{_FIELD}%P"
    args = ["log", "--all", "--numstat", f"--format={fmt}"]
    if limit:
        args += [f"-n{limit}"]

    rows: list[dict] = []
    for record in _run(repo, args).split(_SEP):
        record = record.strip("\n")
        if not record:
            continue

        header, _, stat_block = record.partition("\n")
        short_hash, subject, parents = header.split(_FIELD)
        is_merge = len(parents.split()) > 1

        insertions = deletions = files_changed = 0
        paths: list[str] = []
        for line in stat_block.splitlines():
            if not line.strip():
                continue
            added, removed, path = (line.split("\t", 2) + ["", "", ""])[:3]
            # "-" marks a binary file; it contributes a changed file, no lines.
            insertions += int(added) if added.isdigit() else 0
            deletions += int(removed) if removed.isdigit() else 0
            files_changed += 1
            paths.append(path)

        rows.append({
            "hash": short_hash,
            "message": subject,
            "insertions": insertions,
            "deletions": deletions,
            "files_changed": files_changed,
            "file_paths": paths[:MAX_TRACKED_PATHS],
            "file_paths_truncated": len(paths) > MAX_TRACKED_PATHS,
            # `git log --numstat` prints no stats for a merge, so its zeros are
            # absence of data rather than an empty commit — which is exactly
            # what diffstat_available=False means to the rules prefilter.
            "diffstat_available": not is_merge,
            "expected_type": None,
            "source": source,
            "notes": "",
        })

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(".."), help="repository to harvest")
    parser.add_argument("--source", default="repopulse", help="provenance tag written to each row")
    parser.add_argument("--limit", type=int, default=None, help="most recent N commits only")
    parser.add_argument("--out", type=Path, default=None, help="append to this file instead of stdout")
    args = parser.parse_args()

    rows = harvest(args.repo, args.source, args.limit)
    lines = "".join(json.dumps(row) + "\n" for row in rows)

    if args.out:
        with args.out.open("a") as handle:
            handle.write(lines)
        merges = sum(1 for r in rows if not r["diffstat_available"])
        print(
            f"{len(rows)} rows appended to {args.out} "
            f"({merges} merges, {len(rows) - merges} with diffstats) — all unlabeled",
            file=sys.stderr,
        )
    else:
        sys.stdout.write(lines)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Classify every commit in a local clone and print what the model decided.

    docker compose exec -T backend python -u -m scripts.classify_repo --repo /repos/some-project

Runs the same path the M3 endpoint will: GitService.parse_commits, the rules
prefilter, then the LLM for whatever the rules could not decide. Nothing is
written to the database — this is for looking at a repo the prompt was never
tuned against, which is the only way to find out whether the rubric generalises
beyond RepoPulse's own commit idiom.

`--out` writes the commits in eval-fixture format so they can be hand-labeled
and folded into commit_classification_eval.jsonl. It deliberately omits the
model's predictions: a labeler who can see the answer anchors on it, and the
fixture stops being independent evidence.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

from app.core.config import settings
from app.services.commit_classifier_service import CommitInput, build_classifier
from app.services.git_service import GitService

MAX_TRACKED_PATHS = 20


def _subject(message: str) -> str:
    for line in message.strip().splitlines():
        if line.strip():
            return line.strip()
    return ""


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="path to a local clone, e.g. /repos/project")
    parser.add_argument("--limit", type=int, default=None, help="most recent N commits only")
    parser.add_argument("--provider", default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--ollama-url", default=None)
    parser.add_argument("--out", type=Path, default=None,
                        help="write unlabeled eval rows here for hand-labeling")
    args = parser.parse_args()

    provider = args.provider or settings.DEFAULT_LLM_PROVIDER
    model = args.model or settings.DEFAULT_LLM_MODEL
    if provider == "anthropic" and not settings.ANTHROPIC_API_KEY:
        raise SystemExit("ANTHROPIC_API_KEY is not set — this makes real LLM calls.")

    repo_path = Path(args.repo)
    if not (repo_path / ".git").exists():
        raise SystemExit(f"{repo_path} is not a git clone (no .git directory).")

    commits = await GitService().parse_commits(str(repo_path))
    commits.sort(key=lambda c: c["date"], reverse=True)
    if args.limit:
        commits = commits[:args.limit]
    if not commits:
        raise SystemExit(f"No commits found in {repo_path}.")

    print(f"{repo_path.name}: {len(commits)} commits — classifying with {model}…",
          file=sys.stderr, flush=True)

    results = await build_classifier(
        provider, model, settings.ANTHROPIC_API_KEY, args.ollama_url
    ).classify([
        CommitInput(
            hash=c["hash"], message=c["message"],
            insertions=c["insertions"], deletions=c["deletions"],
            files_changed=c["files_changed"],
            file_paths=tuple(c.get("file_paths", ())),
            file_paths_truncated=c.get("file_paths_truncated", False),
            diffstat_available=c.get("diffstat_available", True),
            needs_type=True, needs_score=False,
        )
        for c in commits
    ])

    counts: Counter[str] = Counter()
    by_source: Counter[str] = Counter()
    for result in results:
        counts[result.commit_type or "unclassified"] += 1
        by_source[result.source] += 1

    print(f"\n{repo_path.name}: {len(commits)} commits "
          f"({by_source['rules']} by rules, {by_source['llm']} by model)\n")
    for label in ("substantive", "logistical", "unclassified"):
        n = counts.get(label, 0)
        if n:
            print(f"  {label:<14}{n:>5}  {n / len(commits):>5.0%}")

    print(f"\n{'hash':<9}{'type':<14}{'by':<8}{'diffstat':<22}message")
    for commit, result in zip(commits, results):
        stat = (f"+{commit['insertions']}/-{commit['deletions']} {commit['files_changed']}f"
                if commit.get("diffstat_available", True) else "no diffstat")
        print(f"{commit['hash'][:7]:<9}{result.commit_type or '—':<14}"
              f"{result.source:<8}{stat:<22}{_subject(commit['message'])[:60]}")

    if args.out:
        with args.out.open("w") as handle:
            for commit in commits:
                handle.write(json.dumps({
                    "hash": commit["hash"][:7],
                    "message": _subject(commit["message"]),
                    "insertions": commit["insertions"],
                    "deletions": commit["deletions"],
                    "files_changed": commit["files_changed"],
                    "file_paths": list(commit.get("file_paths", ()))[:MAX_TRACKED_PATHS],
                    "file_paths_truncated": commit.get("file_paths_truncated", False),
                    "diffstat_available": commit.get("diffstat_available", True),
                    # Unlabeled and unpredicted, on purpose — see module docstring.
                    "expected_type": None,
                    "source": repo_path.name,
                    "notes": "",
                }) + "\n")
        print(f"\n{len(commits)} unlabeled rows → {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

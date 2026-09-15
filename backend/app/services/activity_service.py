"""Complete, deduplicated daily activity for repository and merged student graphs."""
from collections import Counter
from datetime import datetime, timezone
from app.schemas.activity import RepositoryActivity, StudentActivity
from app.schemas.collections import CommitActivityPoint
from app.services import commit_snapshot_service


def daily(commits):
    counts = Counter()
    for commit in commits:
        value = commit['date']
        date = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
        if date.tzinfo is not None:
            date = date.astimezone(timezone.utc)
        counts[date.strftime('%Y-%m-%d')] += 1
    return [CommitActivityPoint(date=date, count=count) for date, count in sorted(counts.items())]


async def collect_activity(repos, git_service, db=None) -> list[RepositoryActivity]:
    """Daily activity per repo, from the clone where possible.

    When a clone will not open and ``db`` is available, the last sync's
    snapshot is used instead. `available` stays True in that case — there *is*
    history to draw — and `stale` records that it is not live. Without a
    snapshot the repo is simply unavailable, as before.
    """
    result = []
    for repo in repos:
        available = False
        stale = False
        activity = []
        commits = []
        if repo.local_path:
            try:
                parsed = await git_service.parse_commits(repo.local_path)
                commits = list({c['hash']: c for c in parsed}.values())
                activity = daily(commits)
                available = True
            except Exception:
                commits = []
        if not available and db is not None:
            parsed = await commit_snapshot_service.load(db, repo.id)
            if parsed:
                commits = list({c['hash']: c for c in parsed}.values())
                activity = daily(commits)
                available = True
                stale = True
        students = []
        for student in repo.contributors:
            emails = {alias.git_email.lower() for alias in student.aliases}
            students.append(StudentActivity(id=str(student.id), name=student.display_name,
                activity=daily([c for c in commits if c['author_email'].lower() in emails])))
        result.append(RepositoryActivity(id=str(repo.id), name=repo.name, available=available,
            stale=stale, activity=activity if available else [], students=students))
    return result

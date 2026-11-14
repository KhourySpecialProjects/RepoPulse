"""Complete, deduplicated daily activity for repository and merged student graphs."""
from collections import Counter
from datetime import timezone
from app.schemas.activity import RepositoryActivity, StudentActivity
from app.schemas.collections import CommitActivityPoint
from app.services import commit_snapshot_service


def daily(commits):
    counts = Counter()
    for commit in commits:
        counts[commit['date'].astimezone(timezone.utc).strftime('%Y-%m-%d')] += 1
    return [CommitActivityPoint(date=date, count=count) for date, count in sorted(counts.items())]


async def collect_activity(repos, git_service, db) -> list[RepositoryActivity]:
    """Daily activity per repo, from the commits stored by the last sync.

    A repo with nothing stored is parsed once and stored (see
    `commit_snapshot_service.ensure`); one with no history at all is
    reported unavailable. `stale` says the stored history may be behind the
    remote — the last sync failed, or there is no clone to sync into.
    """
    result = []
    for repo in repos:
        commits = await commit_snapshot_service.read(db, repo, git_service)
        available = commits is not None
        commits = commits or []
        activity = daily(commits)
        stale = available and commit_snapshot_service.is_stale(repo)
        students = []
        for student in repo.contributors:
            emails = {alias.git_email.lower() for alias in student.aliases}
            students.append(StudentActivity(id=str(student.id), name=student.display_name,
                activity=daily([c for c in commits if c['author_email'].lower() in emails])))
        result.append(RepositoryActivity(id=str(repo.id), name=repo.name, available=available,
            stale=stale, activity=activity, students=students))
    return result

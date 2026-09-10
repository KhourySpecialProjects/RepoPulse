"""Complete, deduplicated daily activity for repository and merged student graphs."""
from collections import Counter
from datetime import datetime, timezone
from app.schemas.activity import RepositoryActivity, StudentActivity
from app.schemas.collections import CommitActivityPoint


def daily(commits):
    counts = Counter()
    for commit in commits:
        value = commit['date']
        date = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
        if date.tzinfo is not None:
            date = date.astimezone(timezone.utc)
        counts[date.strftime('%Y-%m-%d')] += 1
    return [CommitActivityPoint(date=date, count=count) for date, count in sorted(counts.items())]


async def collect_activity(repos, git_service) -> list[RepositoryActivity]:
    result = []
    for repo in repos:
        available = False
        commits = []
        if repo.local_path:
            try:
                parsed = await git_service.parse_commits(repo.local_path)
                commits = list({c['hash']: c for c in parsed}.values())
                activity = daily(commits)
                available = True
            except Exception:
                commits = []
        students = []
        for student in repo.contributors:
            emails = {alias.git_email.lower() for alias in student.aliases}
            students.append(StudentActivity(id=str(student.id), name=student.display_name,
                activity=daily([c for c in commits if c['author_email'].lower() in emails])))
        result.append(RepositoryActivity(id=str(repo.id), name=repo.name, available=available,
            activity=activity if available else [], students=students))
    return result

"""
Seed script for RepoPulse development database.

Usage:
    python -m app.db.seed
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from sqlalchemy import text

from app.core.config import settings
import app.models  # noqa: F401 — register all models before the ORM is used
from app.models.app_settings import AppSettings
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.repo import Repo
from app.models.summary import Summary
from app.models.user import User

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

# ---------------------------------------------------------------------------
# Static UUIDs for reproducibility
# ---------------------------------------------------------------------------

USER_MARK = uuid.UUID("00000000-0000-0000-0000-000000000001")
USER_TA = uuid.UUID("00000000-0000-0000-0000-000000000002")
USER_ADMIN = uuid.UUID("00000000-0000-0000-0000-000000000003")

COL_DB = uuid.UUID("00000000-0000-0000-0001-000000000001")
COL_DS = uuid.UUID("00000000-0000-0000-0001-000000000002")

SEED_REPOS_BASE = "/seed-repos"


def _days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


def _health(
    commit_frequency: float = 2.0,
    recency: float = 2.0,
    distribution: float = 2.0,
    branch_activity: float = 2.0,
    commit_message_quality: float = 2.0,
    status: str = "green",
) -> dict:
    raw = commit_frequency + recency + distribution + branch_activity + commit_message_quality
    composite = round(raw / 10.0, 4)
    return {
        "commit_frequency": commit_frequency,
        "recency": recency,
        "distribution": distribution,
        "branch_activity": branch_activity,
        "commit_message_quality": commit_message_quality,
        "composite": composite,
        "status": status,
    }


REPOS_DB = [
    {
        "name": "db-project-teamA",
        "github_url": "https://github.com/cs3200-s26/db-project-teamA",
        "health_status": "green",
        "health_score": _health(2, 2, 2, 2, 2, "green"),
        "contributor_names": ["Alice Johnson", "Bob Smith"],
        "last_commit_at": _days_ago(1),
    },
    {
        "name": "db-project-teamB",
        "github_url": "https://github.com/cs3200-s26/db-project-teamB",
        "health_status": "green",
        "health_score": _health(2, 2, 1, 2, 2, "green"),
        "contributor_names": ["Carol White", "Dave Brown"],
        "last_commit_at": _days_ago(2),
    },
    {
        "name": "db-project-teamC",
        "github_url": "https://github.com/cs3200-s26/db-project-teamC",
        "health_status": "green",
        "health_score": _health(2, 2, 2, 1, 2, "green"),
        "contributor_names": ["Eve Davis", "Frank Miller"],
        "last_commit_at": _days_ago(3),
    },
    {
        "name": "db-project-teamD",
        "github_url": "https://github.com/cs3200-s26/db-project-teamD",
        "health_status": "yellow",
        "health_score": _health(1, 1, 1, 1, 2, "yellow"),
        "contributor_names": ["Grace Wilson", "Henry Moore"],
        "last_commit_at": _days_ago(8),
    },
    {
        "name": "db-project-teamE",
        "github_url": "https://github.com/cs3200-s26/db-project-teamE",
        "health_status": "yellow",
        "health_score": _health(1, 2, 1, 1, 1, "yellow"),
        "contributor_names": ["Iris Taylor", "Jack Anderson"],
        "last_commit_at": _days_ago(10),
    },
    {
        "name": "db-project-teamF",
        "github_url": "https://github.com/cs3200-s26/db-project-teamF",
        "health_status": "yellow",
        "health_score": _health(1, 1, 2, 1, 1, "yellow"),
        "contributor_names": ["Karen Thomas", "Leo Jackson"],
        "last_commit_at": _days_ago(12),
    },
    {
        "name": "db-project-teamG",
        "github_url": "https://github.com/cs3200-s26/db-project-teamG",
        "health_status": "red",
        "health_score": _health(0, 0, 0, 1, 1, "red"),
        "contributor_names": ["Mona Harris"],
        "last_commit_at": _days_ago(28),
    },
    {
        "name": "db-project-teamH",
        "github_url": "https://github.com/cs3200-s26/db-project-teamH",
        "health_status": "red",
        "health_score": _health(0, 0, 1, 0, 0, "red"),
        "contributor_names": ["Nathan Martin"],
        "last_commit_at": _days_ago(35),
    },
]

REPOS_DS = [
    {
        "name": "ds-project-teamA",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamA",
        "health_status": "green",
        "health_score": _health(2, 2, 2, 2, 2, "green"),
        "contributor_names": ["Olivia Garcia", "Paul Rodriguez"],
        "last_commit_at": _days_ago(2),
    },
    {
        "name": "ds-project-teamB",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamB",
        "health_status": "green",
        "health_score": _health(2, 1, 2, 2, 2, "green"),
        "contributor_names": ["Quinn Martinez", "Rachel Lewis"],
        "last_commit_at": _days_ago(4),
    },
    {
        "name": "ds-project-teamC",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamC",
        "health_status": "green",
        "health_score": _health(2, 2, 1, 2, 2, "green"),
        "contributor_names": ["Sam Lee", "Tina Walker"],
        "last_commit_at": _days_ago(5),
    },
    {
        "name": "ds-project-teamD",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamD",
        "health_status": "yellow",
        "health_score": _health(1, 1, 1, 2, 1, "yellow"),
        "contributor_names": ["Uma Hall", "Victor Allen"],
        "last_commit_at": _days_ago(9),
    },
    {
        "name": "ds-project-teamE",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamE",
        "health_status": "yellow",
        "health_score": _health(2, 1, 1, 1, 1, "yellow"),
        "contributor_names": ["Wendy Young", "Xander King"],
        "last_commit_at": _days_ago(14),
    },
    {
        "name": "ds-project-teamF",
        "github_url": "https://github.com/ds4300-s26/ds-project-teamF",
        "health_status": "red",
        "health_score": _health(0, 0, 0, 0, 1, "red"),
        "contributor_names": ["Yara Wright"],
        "last_commit_at": _days_ago(30),
    },
]


async def seed() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        # No create_all here. Seeding populates data; Alembic owns the schema.
        # Creating tables from this script would build them without writing an
        # alembic_version stamp, so a later `alembic upgrade head` would fail
        # against tables that already exist.
        if (
            await conn.execute(text("SELECT to_regclass('public.users')"))
        ).scalar() is None:
            raise RuntimeError(
                "No schema found. Run `alembic upgrade head` before seeding "
                "(the backend container does this on boot)."
            )

        # Wipe existing data so the seed is idempotent. Every table is named
        # explicitly rather than relying on CASCADE to reach them — a table
        # that is not FK-reachable would silently keep its rows.
        await conn.execute(text(
            "TRUNCATE TABLE reminder_shares, notifications, note_comments, "
            "pull_requests, commit_classifications, collection_access, "
            "app_settings, summaries, notes, contributor_aliases, "
            "contributors, repos, collections, users RESTART IDENTITY CASCADE"
        ))

    async with session_factory() as db:
        # ------------------------------------------------------------------
        # Users
        # ------------------------------------------------------------------
        users = [
            User(
                id=USER_MARK,
                email="mark@example.com",
                display_name="Mark (Instructor)",
                role="instructor",
                password_hash=_hash_password("password123"),
                github_token=None,
            ),
            User(
                id=USER_TA,
                email="ta@example.com",
                display_name="Teaching Assistant",
                role="ta",
                password_hash=_hash_password("password123"),
                github_token=None,
            ),
            User(
                id=USER_ADMIN,
                email="admin@example.com",
                display_name="Admin User",
                role="admin",
                password_hash=_hash_password("password123"),
                github_token=None,
            ),
        ]
        for u in users:
            db.add(u)

        # ------------------------------------------------------------------
        # Collections
        # ------------------------------------------------------------------
        col_db = Collection(
            id=COL_DB,
            name="Spring 2026 DB Projects",
            course_tag="CS 3200",
            semester_tag="Spring 2026",
            local_folder_name="cs3200-s26",
            owner_id=USER_MARK,
        )
        col_ds = Collection(
            id=COL_DS,
            name="Spring 2026 DS Projects",
            course_tag="DS 4300",
            semester_tag="Spring 2026",
            local_folder_name="ds4300-s26",
            owner_id=USER_MARK,
        )
        db.add(col_db)
        db.add(col_ds)

        await db.flush()

        # ------------------------------------------------------------------
        # Collection Access — TA gets access to the DB collection
        # ------------------------------------------------------------------
        ta_access = CollectionAccess(
            collection_id=COL_DB,
            user_id=USER_TA,
            access_role=CollectionRole.ta,
        )
        db.add(ta_access)
        await db.flush()

        # ------------------------------------------------------------------
        # Repos, contributors, aliases
        # ------------------------------------------------------------------
        all_repo_records: list[tuple[Repo, list[str]]] = []

        for repo_data in REPOS_DB:
            repo = Repo(
                collection_id=COL_DB,
                github_url=repo_data["github_url"],
                name=repo_data["name"],
                local_path=f"{SEED_REPOS_BASE}/cs3200-s26/{repo_data['name']}",
                health_status=repo_data["health_status"],
                health_score=repo_data["health_score"],
                last_synced_at=datetime.now(timezone.utc),
                last_commit_at=repo_data.get("last_commit_at"),
            )
            db.add(repo)
            all_repo_records.append((repo, repo_data["contributor_names"]))

        for repo_data in REPOS_DS:
            repo = Repo(
                collection_id=COL_DS,
                github_url=repo_data["github_url"],
                name=repo_data["name"],
                local_path=f"{SEED_REPOS_BASE}/ds4300-s26/{repo_data['name']}",
                health_status=repo_data["health_status"],
                health_score=repo_data["health_score"],
                last_synced_at=datetime.now(timezone.utc),
                last_commit_at=repo_data.get("last_commit_at"),
            )
            db.add(repo)
            all_repo_records.append((repo, repo_data["contributor_names"]))

        await db.flush()

        # Build contributors and aliases
        all_contributors: list[Contributor] = []
        for repo, contributor_names in all_repo_records:
            for name in contributor_names:
                email_local = name.lower().replace(" ", ".")
                contributor = Contributor(
                    display_name=name,
                    repo_id=repo.id,
                )
                db.add(contributor)
                await db.flush()

                # Primary alias
                alias1 = ContributorAlias(
                    contributor_id=contributor.id,
                    git_email=f"{email_local}@university.edu",
                    git_name=name,
                )
                db.add(alias1)

                # One contributor has two email aliases (Alice Johnson)
                if name == "Alice Johnson":
                    alias2 = ContributorAlias(
                        contributor_id=contributor.id,
                        git_email="alice.j@personal.com",
                        git_name="Alice J.",
                    )
                    db.add(alias2)

                all_contributors.append(contributor)

        await db.flush()

        # ------------------------------------------------------------------
        # Notes & Reminders (for first collection's first repo)
        # ------------------------------------------------------------------
        if all_repo_records:
            first_repo, _ = all_repo_records[0]
            first_contributor = all_contributors[0] if all_contributors else None

            note1 = Note(
                author_id=USER_MARK,
                repo_id=first_repo.id,
                content="Team A has been very consistent with commits. Good collaborative structure.",
                is_reminder=False,
            )
            note2 = Note(
                author_id=USER_MARK,
                repo_id=first_repo.id,
                content="Follow up on branch naming conventions — they're using feature/* correctly.",
                is_reminder=True,
                reminder_context="Check branch names in next code review session.",
            )
            db.add(note1)
            db.add(note2)

            if first_contributor:
                note3 = Note(
                    author_id=USER_MARK,
                    repo_id=first_repo.id,
                    contributor_id=first_contributor.id,
                    content="Alice is leading most of the schema design. Strong contributor.",
                    is_reminder=False,
                )
                db.add(note3)

            # A global note (no repo or contributor)
            note4 = Note(
                author_id=USER_MARK,
                content="Remind students: final submission deadline is April 25.",
                is_reminder=True,
                reminder_context="Send email reminder two weeks before deadline.",
            )
            db.add(note4)

        await db.flush()

        # ------------------------------------------------------------------
        # Pre-generated summaries
        # ------------------------------------------------------------------
        if all_repo_records:
            first_repo, _ = all_repo_records[0]
            summary1 = Summary(
                repo_id=first_repo.id,
                summary_type="repo_overview",
                content=(
                    "Team A's repository shows strong, consistent development activity. "
                    "Both contributors commit regularly with well-structured messages. "
                    "The branch strategy follows feature branching best practices. "
                    "The codebase appears healthy with balanced contributions from both team members."
                ),
                model_used=settings.DEFAULT_LLM_MODEL,
                generated_at=datetime.now(timezone.utc),
            )
            db.add(summary1)

            health_summary = Summary(
                repo_id=first_repo.id,
                summary_type="health_explanation",
                content=(
                    "This repository scores green across all health signals. "
                    "The team commits frequently (averaging over 10 commits per week), "
                    "the most recent commit was within the last 48 hours, and both contributors "
                    "share the work evenly (low Gini coefficient). Multiple active branches indicate "
                    "parallel feature development. Commit messages are descriptive and informative."
                ),
                model_used=settings.DEFAULT_LLM_MODEL,
                generated_at=datetime.now(timezone.utc),
            )
            db.add(health_summary)

        # ------------------------------------------------------------------
        # AppSettings for each user
        # ------------------------------------------------------------------
        for user_id in [USER_MARK, USER_TA, USER_ADMIN]:
            app_settings = AppSettings(
                user_id=user_id,
                repo_root_directory=SEED_REPOS_BASE,
                llm_provider="anthropic",
                llm_model=settings.DEFAULT_LLM_MODEL,
            )
            db.add(app_settings)

        await db.commit()
        print("Seed complete.")
        print(f"  Users: mark@example.com, ta@example.com, admin@example.com (password: password123)")
        print(f"  Collections: {len(REPOS_DB)} DB repos, {len(REPOS_DS)} DS repos")
        print(f"  Dev login mark user_id: {USER_MARK}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())

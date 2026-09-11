"""baseline schema

Replaces revisions 0001-0019, which could not build a database from empty: the
old 0001 was named "initial_schema" but only ran `op.add_column` against a
`contributors` table that no migration ever created. Eight of the fourteen
tables had no `op.create_table` anywhere — they existed only because
`Base.metadata.create_all` ran on app startup. Squashing is safe because no
database was ever built by the chain, so none needs to be migrated onto it.

Two details that autogenerate does not produce and that must survive any
future regeneration of this file:

  * `ix_notes_remind_at` is PARTIAL (`WHERE is_reminder = true`). Reminders are
    queried by due date on every notification poll.
  * `downgrade()` drops the five enum types explicitly. Alembic emits the
    CREATE TYPE implicitly via the inline `sa.Enum` columns but never the DROP,
    so without this a downgrade/upgrade cycle fails with "type already exists".

Revision ID: 0001
Revises:
Create Date: 2026-09-11
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

ENUM_TYPES = (
    "userrole",
    "healthstatus",
    "summarytype",
    "collection_role",
    "notification_type",
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("instructor", "ta", "admin", name="userrole"),
            nullable=False,
        ),
        sa.Column("github_token", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # unique=True together with index=True on the model yields a unique index,
    # not a separate UNIQUE constraint.
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "collections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("course_tag", sa.String(100), nullable=True),
        sa.Column("semester_tag", sa.String(100), nullable=True),
        sa.Column("local_folder_name", sa.String(255), nullable=False),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
    )

    op.create_table(
        "repos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "collection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("collections.id"),
            nullable=False,
        ),
        sa.Column("github_url", sa.String(500), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("local_path", sa.String(500), nullable=True),
        sa.Column(
            "health_status",
            sa.Enum("green", "yellow", "red", "unknown", name="healthstatus"),
            nullable=False,
        ),
        sa.Column("health_score", sa.JSON(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_commit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expected_contributor_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "contributors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "commit_count", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "total_insertions", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "total_deletions", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column("last_commit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merge_history", sa.JSON(), nullable=True),
    )

    op.create_table(
        "contributor_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "contributor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contributors.id"),
            nullable=False,
        ),
        sa.Column("git_email", sa.String(255), nullable=False),
        sa.Column("git_name", sa.String(255), nullable=False),
    )

    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id"),
            nullable=True,
        ),
        sa.Column(
            "contributor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contributors.id"),
            nullable=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("commit_hash", sa.String(40), nullable=True),
        sa.Column(
            "is_reminder", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("reminder_context", sa.Text(), nullable=True),
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_checked", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "is_archived", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_notes_deleted_at", "notes", ["deleted_at"])
    # Partial: only reminders are ever looked up by due date.
    op.create_index(
        "ix_notes_remind_at",
        "notes",
        ["remind_at"],
        postgresql_where=sa.text("is_reminder = true"),
    )

    op.create_table(
        "summaries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id"),
            nullable=True,
        ),
        sa.Column(
            "contributor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contributors.id"),
            nullable=True,
        ),
        sa.Column(
            "summary_type",
            sa.Enum(
                "repo_overview",
                "contributor_activity",
                "health_explanation",
                name="summarytype",
            ),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(255), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "app_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("repo_root_directory", sa.String(500), nullable=False),
        sa.Column("llm_provider", sa.String(100), nullable=False),
        sa.Column("llm_model", sa.String(200), nullable=False),
        sa.Column("health_thresholds", sa.JSON(), nullable=True),
        sa.Column("anthropic_api_key", sa.String(500), nullable=True),
        sa.Column("ollama_base_url", sa.String(500), nullable=True),
        sa.UniqueConstraint("user_id"),
    )

    op.create_table(
        "collection_access",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "collection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("collections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "access_role",
            sa.Enum("co_instructor", "ta", name="collection_role"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "collection_id", "user_id", name="uq_collection_access_collection_user"
        ),
    )
    op.create_index(
        "ix_collection_access_collection_id", "collection_access", ["collection_id"]
    )
    op.create_index("ix_collection_access_user_id", "collection_access", ["user_id"])

    op.create_table(
        "note_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_note_comments_note_id", "note_comments", ["note_id"])
    op.create_index("ix_note_comments_author_id", "note_comments", ["author_id"])

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipient_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "mention", "note_comment", "reminder", name="notification_type"
            ),
            nullable=False,
        ),
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "comment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("note_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "is_read", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_notifications_recipient_id", "notifications", ["recipient_id"])
    op.create_index("ix_notifications_is_read", "notifications", ["is_read"])
    op.create_index("ix_notifications_deleted_at", "notifications", ["deleted_at"])

    op.create_table(
        "commit_classifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("commit_hash", sa.String(40), nullable=False),
        sa.Column("score", sa.String(10), nullable=True),
        sa.Column("commit_type", sa.String(20), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=False),
        # Naive, not timezone-aware — matches the model and the table this
        # replaces.
        sa.Column(
            "scored_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "repo_id", "commit_hash", name="uq_commit_classification_repo_hash"
        ),
        # Plain CHECKs rather than enum types: adding a value to a PG enum
        # later requires ALTER TYPE, which does not run cleanly in a
        # transaction.
        sa.CheckConstraint(
            "commit_type IS NULL OR commit_type IN ('substantive', 'logistical')",
            name="ck_commit_classification_type",
        ),
        sa.CheckConstraint(
            "score IS NULL OR score IN ('good', 'ok', 'bad')",
            name="ck_commit_classification_score",
        ),
    )
    op.create_index(
        "ix_commit_classifications_repo_id", "commit_classifications", ["repo_id"]
    )

    op.create_table(
        "pull_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pr_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column(
            "author_login", sa.String(255), server_default="", nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("html_url", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "reviews_requested", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column("draft", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "repo_id", "pr_number", name="uq_pull_request_repo_number"
        ),
    )
    op.create_index("ix_pull_requests_repo_id", "pull_requests", ["repo_id"])

    op.create_table(
        "reminder_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "note_id", "user_id", name="uq_reminder_share_note_user"
        ),
    )
    op.create_index("ix_reminder_shares_note_id", "reminder_shares", ["note_id"])
    op.create_index("ix_reminder_shares_user_id", "reminder_shares", ["user_id"])


def downgrade() -> None:
    op.drop_table("reminder_shares")
    op.drop_table("pull_requests")
    op.drop_table("commit_classifications")
    op.drop_table("notifications")
    op.drop_table("note_comments")
    op.drop_table("collection_access")
    op.drop_table("app_settings")
    op.drop_table("summaries")
    op.drop_table("notes")
    op.drop_table("contributor_aliases")
    op.drop_table("contributors")
    op.drop_table("repos")
    op.drop_table("collections")
    op.drop_table("users")

    # Dropping the tables leaves the enum types behind, so a later upgrade()
    # would fail with "type already exists".
    for enum_name in ENUM_TYPES:
        op.execute(sa.text(f"DROP TYPE IF EXISTS {enum_name}"))

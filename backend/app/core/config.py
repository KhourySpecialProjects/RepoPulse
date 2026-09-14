from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/repopulse"
    TEST_DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/repopulse_test"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    AUTH_MODE: str = "dev"  # "dev" | "prod"

    # Must match the container side of the repos bind mount in
    # docker-compose.yml (./seed-repos:/repos). That mount is the only place a
    # clone outlives a rebuild.
    REPO_ROOT_DIR: str = "/repos"
    ANTHROPIC_API_KEY: str = ""
    GITHUB_TOKEN: str = ""

    # Where the frontend is reachable. Only used to build links in notification
    # emails — an email whose link points at the container's own hostname is
    # useless, so this is the one place the public address is configured.
    APP_BASE_URL: str = "http://localhost:5173"

    # The single source of truth for which model the app talks to. Models get
    # retired: when that happens every LLM feature 404s at once, and this is the
    # one line that has to change. Overridable per-user via AppSettings, and per
    # environment via DEFAULT_LLM_MODEL in .env.
    DEFAULT_LLM_PROVIDER: str = "anthropic"
    DEFAULT_LLM_MODEL: str = "claude-sonnet-5"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("REPO_ROOT_DIR")
    @classmethod
    def _clone_root_must_be_absolute(cls, value: str) -> str:
        """Fail at startup rather than silently cloning into the container.

        A relative root resolves against the process working directory (/app),
        which is the container's writable layer — clones written there are
        discarded on the next rebuild and every repo needs a re-sync to be
        readable again. The failure is invisible until that rebuild, so it has
        to be caught here.
        """
        if not value.startswith("/"):
            raise ValueError(
                f"REPO_ROOT_DIR must be an absolute path, got {value!r}. "
                "Use the container side of the repos bind mount (/repos); a "
                "relative path resolves outside the mount and clones are lost "
                "on rebuild."
            )
        return value.rstrip("/") or "/"


settings = Settings()

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/repopulse"
    TEST_DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/repopulse_test"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    AUTH_MODE: str = "dev"  # "dev" | "prod"
    REPO_ROOT_DIR: str = "/repos"
    ANTHROPIC_API_KEY: str = ""
    GITHUB_TOKEN: str = ""

    # The single source of truth for which model the app talks to. Models get
    # retired: when that happens every LLM feature 404s at once, and this is the
    # one line that has to change. Overridable per-user via AppSettings, and per
    # environment via DEFAULT_LLM_MODEL in .env.
    DEFAULT_LLM_PROVIDER: str = "anthropic"
    DEFAULT_LLM_MODEL: str = "claude-sonnet-5"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

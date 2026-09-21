from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_current_user_obj, get_db_session
from app.models.app_settings import AppSettings
from app.models.user import User
from app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from app.schemas.llm_quota import TokenQuotaRead
from app.services.llm.quota import get_llm_config, quota_for

router = APIRouter()


def _settings_to_read(s: AppSettings, llm_model: str) -> AppSettingsRead:
    """Per-user settings, plus the instance model for display only.

    `llm_model` is echoed here so the Settings page can say which model it is
    about to use without needing the admin-only config endpoint — a
    non-administrator reading it is fine, choosing it is not.
    """
    return AppSettingsRead(
        id=s.id,
        user_id=s.user_id,
        repo_root_directory=s.repo_root_directory,
        health_thresholds=s.health_thresholds,
        commit_evaluation_criteria=s.commit_evaluation_criteria,
        llm_model=llm_model,
    )


async def _get_or_create_settings(
    db: AsyncSession, user_uuid: uuid.UUID
) -> AppSettings:
    result = await db.execute(
        select(AppSettings).where(AppSettings.user_id == user_uuid)
    )
    app_settings = result.scalar_one_or_none()
    if app_settings is None:
        app_settings = AppSettings(user_id=user_uuid)
        db.add(app_settings)
        await db.commit()
        await db.refresh(app_settings)
    return app_settings


@router.get("/settings", response_model=AppSettingsRead)
async def get_settings(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> AppSettingsRead:
    user_uuid = uuid.UUID(current_user_id)
    app_settings = await _get_or_create_settings(db, user_uuid)
    config = await get_llm_config(db)
    return _settings_to_read(app_settings, config.llm_model)


@router.patch("/settings", response_model=AppSettingsRead)
async def update_settings(
    body: AppSettingsUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> AppSettingsRead:
    user_uuid = uuid.UUID(current_user_id)
    app_settings = await _get_or_create_settings(db, user_uuid)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(app_settings, field, value)

    await db.commit()
    await db.refresh(app_settings)
    config = await get_llm_config(db)
    return _settings_to_read(app_settings, config.llm_model)


@router.get("/settings/token-usage", response_model=TokenQuotaRead)
async def get_my_token_usage(
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user_obj),
) -> TokenQuotaRead:
    """This user's own AI token usage for the current month.

    Readable by any authenticated user, and only ever about themselves — a
    refusal the user cannot investigate is a dead end, and the limit that
    blocked them is not privileged information.
    """
    quota = await quota_for(db, current_user)
    return TokenQuotaRead(
        period=quota.period,
        used=quota.used,
        limit=quota.limit,
        remaining=quota.remaining,
        unlimited=quota.unlimited,
        exceeded=quota.exceeded,
    )


@router.get("/settings/ollama-models", response_model=list[str])
async def get_ollama_models(
    base_url: str = Query(default="http://localhost:11434"),
    current_user_id: str = Depends(get_current_user),
) -> list[str]:
    """Fetch available models from a running Ollama instance."""
    url = base_url.rstrip("/") + "/api/tags"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []

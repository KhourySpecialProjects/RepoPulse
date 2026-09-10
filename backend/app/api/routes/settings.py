from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.app_settings import AppSettings
from app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate

router = APIRouter()


def _settings_to_read(s: AppSettings) -> AppSettingsRead:
    return AppSettingsRead(
        id=s.id,
        user_id=s.user_id,
        repo_root_directory=s.repo_root_directory,
        llm_provider=s.llm_provider,
        llm_model=s.llm_model,
        health_thresholds=s.health_thresholds,
        anthropic_api_key_configured=bool(s.anthropic_api_key),
        ollama_base_url=s.ollama_base_url,
        commit_evaluation_criteria=s.commit_evaluation_criteria,
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
    return _settings_to_read(app_settings)


@router.patch("/settings", response_model=AppSettingsRead)
async def update_settings(
    body: AppSettingsUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> AppSettingsRead:
    user_uuid = uuid.UUID(current_user_id)
    app_settings = await _get_or_create_settings(db, user_uuid)

    update_data = body.model_dump(exclude_unset=True)
    if "commit_evaluation_criteria" in update_data:
        criteria = update_data["commit_evaluation_criteria"]
        if not isinstance(criteria, str) or not criteria.strip():
            raise HTTPException(
                status_code=422,
                detail="Criteria required",
            )
        # Keep the persisted rubric canonical while preserving all internal
        # whitespace and line breaks that the professor entered.
        update_data["commit_evaluation_criteria"] = criteria.strip()
    for field, value in update_data.items():
        setattr(app_settings, field, value)

    await db.commit()
    await db.refresh(app_settings)
    return _settings_to_read(app_settings)


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

from fastapi import APIRouter

from app.api.routes import auth, collections, repos, contributors, notes, note_comments, notifications, summaries, settings, users, collection_access

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(collections.router, tags=["collections"])
api_router.include_router(repos.router, tags=["repos"])
api_router.include_router(contributors.router, tags=["contributors"])
api_router.include_router(notes.router, tags=["notes"])
api_router.include_router(note_comments.router, tags=["note-comments"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(summaries.router, tags=["summaries"])
api_router.include_router(settings.router, tags=["settings"])
api_router.include_router(users.router, tags=["users"])
api_router.include_router(collection_access.router, prefix="/collections", tags=["collection-access"])

"""A raisable error that renders the documented error envelope.

`HTTPException(400, detail="...")` produces `{"detail": "..."}` with no
`error_code`, which does not match the `{"detail": ..., "error_code": ...}`
contract every endpoint is supposed to return. Raising `AppError` instead gets
the full envelope, via the handler registered in `app/main.py`.
"""
from __future__ import annotations


class AppError(Exception):
    def __init__(self, status_code: int, detail: str, error_code: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code

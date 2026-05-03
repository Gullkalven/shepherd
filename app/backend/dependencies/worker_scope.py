"""Helpers for PIN-worker JWT scope (single project per session)."""

from typing import Optional

from schemas.auth import UserResponse


def worker_project_scope(user: UserResponse) -> Optional[int]:
    """When the bearer is a project-worker token, restrict data access to this project_id."""
    if getattr(user, "is_worker_session", False):
        wid = getattr(user, "worker_project_id", None)
        if isinstance(wid, int):
            return wid
    return None

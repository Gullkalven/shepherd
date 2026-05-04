"""Checklist template permissions must treat provisional admin as admin."""

import asyncio

import pytest
from fastapi import HTTPException

from routers.checklist_templates import require_manager_or_admin
from schemas.auth import UserResponse


def _run(coro):
    return asyncio.run(coro)


def _mk_user(*, role: str = "user", provisional: bool = False) -> UserResponse:
    return UserResponse(
        id="u-1",
        email="u@example.com",
        name="Test User",
        role=role,
        is_provisional_admin=provisional,
    )


def test_require_manager_or_admin_allows_admin_role() -> None:
    user = _mk_user(role="admin")
    got = _run(require_manager_or_admin(current_user=user, app_role="admin"))
    assert got.id == user.id


def test_require_manager_or_admin_allows_provisional_admin_session() -> None:
    user = _mk_user(role="admin", provisional=True)
    got = _run(require_manager_or_admin(current_user=user, app_role="admin"))
    assert got.is_provisional_admin is True


def test_require_manager_or_admin_denies_worker_role() -> None:
    user = _mk_user(role="user", provisional=False)
    with pytest.raises(HTTPException) as exc:
        _run(require_manager_or_admin(current_user=user, app_role="worker"))
    assert exc.value.status_code == 403
    assert "admin role required" in str(exc.value.detail)

"""`_resolve_confirm_actor` derives the heating-cable confirmation actor from the session."""

import asyncio
from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from routers.room_heating_cable import _resolve_confirm_actor
from schemas.auth import UserResponse


def _run(coro):
    return asyncio.run(coro)


def _worker_user(*, worker_id: int = 42, project_id: int = 9, name: str = "Alice") -> UserResponse:
    return UserResponse(
        id="owner-uuid",
        email="",
        name=name,
        role="user",
        is_worker_session=True,
        worker_project_id=project_id,
        worker_id=worker_id,
    )


def _admin_user(*, uid: str = "admin-uuid", name: str = "Admin") -> UserResponse:
    return UserResponse(id=uid, email="admin@example.com", name=name, role="admin")


def _make_db_returning(worker: Optional[SimpleNamespace]) -> MagicMock:
    """AsyncSession stub whose `execute(...)` returns a result with `scalar_one_or_none` -> `worker`."""
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=worker)
    db.execute = AsyncMock(return_value=result)
    return db


def test_resolve_confirm_actor_worker_session_stamps_worker_id() -> None:
    user = _worker_user(worker_id=42, project_id=9, name="Alice")
    worker_row = SimpleNamespace(id=42, project_id=9, name="Alice", active=True)
    db = _make_db_returning(worker_row)

    actor = _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=9))

    assert actor.is_worker is True
    assert actor.worker_id == 42
    assert actor.canonical_id == "worker:42"
    assert actor.user_id == "owner-uuid"
    assert actor.name == "Alice"


def test_resolve_confirm_actor_worker_without_worker_id_raises_401() -> None:
    user = UserResponse(
        id="owner-uuid",
        email="",
        name=None,
        role="user",
        is_worker_session=True,
        worker_project_id=9,
        worker_id=None,
    )
    db = _make_db_returning(None)

    with pytest.raises(HTTPException) as exc:
        _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=9))
    assert exc.value.status_code == 401
    assert "Site Worker" in str(exc.value.detail)


def test_resolve_confirm_actor_inactive_worker_raises_401() -> None:
    user = _worker_user()
    worker_row = SimpleNamespace(id=42, project_id=9, name="Alice", active=False)
    db = _make_db_returning(worker_row)

    with pytest.raises(HTTPException) as exc:
        _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=9))
    assert exc.value.status_code == 401


def test_resolve_confirm_actor_room_project_mismatch_raises_403() -> None:
    user = _worker_user(project_id=9)
    worker_row = SimpleNamespace(id=42, project_id=9, name="Alice", active=True)
    db = _make_db_returning(worker_row)

    with pytest.raises(HTTPException) as exc:
        _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=11))
    assert exc.value.status_code == 403


def test_resolve_confirm_actor_session_project_mismatch_raises_403() -> None:
    """Worker JWT scoped to project 9 but the row lives in project 11 -> reject."""
    user = _worker_user(project_id=9)
    worker_row = SimpleNamespace(id=42, project_id=11, name="Alice", active=True)
    db = _make_db_returning(worker_row)

    with pytest.raises(HTTPException) as exc:
        _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=11))
    assert exc.value.status_code == 403


def test_resolve_confirm_actor_admin_uses_user_id() -> None:
    user = _admin_user(uid="admin-uuid", name="Admin")
    db = _make_db_returning(None)  # not consulted for admin path

    actor = _run(_resolve_confirm_actor(db, user, app_role="admin", room_project_id=9))

    assert actor.is_worker is False
    assert actor.worker_id is None
    assert actor.canonical_id == "admin-uuid"
    assert actor.user_id == "admin-uuid"
    assert actor.name == "Admin"
    db.execute.assert_not_called()


def test_resolve_confirm_actor_anonymous_non_admin_raises_401() -> None:
    user = UserResponse(id="", email="", name=None, role="user")
    db = _make_db_returning(None)

    with pytest.raises(HTTPException) as exc:
        _run(_resolve_confirm_actor(db, user, app_role="worker", room_project_id=9))
    assert exc.value.status_code == 401
    assert "Site Worker" in str(exc.value.detail)

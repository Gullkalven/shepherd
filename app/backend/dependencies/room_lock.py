"""Enforce room lock for field roles (electrician / apprentice)."""

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.roles import ROLE_ADMIN, ROLE_MANAGER
from services.rooms import RoomsService

ROOM_LOCKED_DETAIL = "This room is locked. Only admin or BAS can change data here."


async def ensure_room_mutable(
    db: AsyncSession,
    room_id: int,
    user_id: str,
    app_role: str,
) -> None:
    if app_role in (ROLE_ADMIN, ROLE_MANAGER):
        return
    service = RoomsService(db)
    room = await service.get_by_id(room_id, user_id=user_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if getattr(room, "is_locked", False):
        raise HTTPException(status_code=403, detail=ROOM_LOCKED_DETAIL)

from datetime import datetime
from typing import Optional, Set

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.user_roles import User_roles
from schemas.auth import UserResponse

ROLE_ADMIN = "admin"
ROLE_WORKER = "worker"

# Legacy stored values (BAS / project manager / field roles) map to the two canonical roles.
_LEGACY_ADMIN_ALIASES = frozenset({"manager"})
_LEGACY_WORKER_ALIASES = frozenset({"electrician", "apprentice", "worker"})

VALID_APP_ROLES: Set[str] = {ROLE_ADMIN, ROLE_WORKER}


def normalize_role(role: Optional[str]) -> str:
    if not role or not str(role).strip():
        return ROLE_WORKER
    r = str(role).strip().lower()
    if r == ROLE_ADMIN:
        return ROLE_ADMIN
    if r in _LEGACY_ADMIN_ALIASES:
        return ROLE_ADMIN
    if r in _LEGACY_WORKER_ALIASES:
        return ROLE_WORKER
    return ROLE_WORKER


async def get_current_app_role(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    result = await db.execute(select(User_roles).where(User_roles.user_id == str(current_user.id)))
    role_record = result.scalar_one_or_none()

    if role_record and role_record.app_role:
        return normalize_role(role_record.app_role)

    count_result = await db.execute(select(func.count(User_roles.id)))
    total_roles = count_result.scalar()
    if total_roles == 0:
        new_role = User_roles(
            user_id=str(current_user.id),
            app_role=ROLE_ADMIN,
            display_name=current_user.name or current_user.email,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        db.add(new_role)
        await db.commit()
        return ROLE_ADMIN

    return ROLE_WORKER


async def require_admin_role(app_role: str = Depends(get_current_app_role)) -> str:
    if app_role == ROLE_ADMIN:
        return app_role
    raise HTTPException(status_code=403, detail="Admin access required")


async def require_room_collaborator(app_role: str = Depends(get_current_app_role)) -> str:
    """Admin and worker may update room fields that are not admin-only."""
    if app_role in {ROLE_ADMIN, ROLE_WORKER}:
        return app_role
    raise HTTPException(status_code=403, detail="Sign in with a valid role to update this room")

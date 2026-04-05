import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.auth import User
from models.user_roles import User_roles
from schemas.auth import UserResponse
from dependencies.roles import ROLE_ADMIN, ROLE_WORKER, normalize_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/roles", tags=["admin_roles"])


# ---------- Schemas ----------
class AssignRoleRequest(BaseModel):
    user_id: str
    app_role: str  # admin | worker
    display_name: Optional[str] = None


class UserRoleResponse(BaseModel):
    id: int
    user_id: str
    app_role: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserWithRoleResponse(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    app_role: str
    display_name: Optional[str] = None
    role_id: Optional[int] = None


class MyRoleResponse(BaseModel):
    app_role: str
    display_name: Optional[str] = None


VALID_ROLES = {ROLE_ADMIN, ROLE_WORKER}


async def require_admin(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Check if the current user is an admin in the app roles system."""
    result = await db.execute(
        select(User_roles).where(User_roles.user_id == str(current_user.id))
    )
    role_record = result.scalar_one_or_none()

    if role_record and normalize_role(role_record.app_role) == ROLE_ADMIN:
        return current_user

    # Also check if there are NO roles at all (first user becomes admin)
    count_result = await db.execute(select(func.count(User_roles.id)))
    total_roles = count_result.scalar()

    if total_roles == 0:
        # Auto-assign first authenticated user as admin
        new_role = User_roles(
            user_id=str(current_user.id),
            app_role="admin",
            display_name=current_user.name or current_user.email,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        db.add(new_role)
        await db.commit()
        return current_user

    raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/me", response_model=MyRoleResponse)
async def get_my_role(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's app role."""
    result = await db.execute(
        select(User_roles).where(User_roles.user_id == str(current_user.id))
    )
    role_record = result.scalar_one_or_none()

    if role_record:
        return MyRoleResponse(
            app_role=normalize_role(role_record.app_role),
            display_name=role_record.display_name,
        )

    # Check if there are no roles at all (first user becomes admin)
    count_result = await db.execute(select(func.count(User_roles.id)))
    total_roles = count_result.scalar()

    if total_roles == 0:
        new_role = User_roles(
            user_id=str(current_user.id),
            app_role="admin",
            display_name=current_user.name or current_user.email,
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        db.add(new_role)
        await db.commit()
        return MyRoleResponse(app_role="admin", display_name=new_role.display_name)

    # Default role for users without an assigned role
    return MyRoleResponse(app_role=ROLE_WORKER, display_name=None)


@router.get("/users", response_model=List[UserWithRoleResponse])
async def list_users_with_roles(
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all users with their roles (admin only)."""
    # Get all users from the users table
    users_result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = users_result.scalars().all()

    # Get all role assignments
    roles_result = await db.execute(select(User_roles))
    roles = roles_result.scalars().all()
    roles_map = {r.user_id: r for r in roles}

    response = []
    for user in users:
        role_record = roles_map.get(user.id)
        response.append(
            UserWithRoleResponse(
                user_id=user.id,
                email=user.email,
                name=user.name,
                app_role=normalize_role(role_record.app_role) if role_record else ROLE_WORKER,
                display_name=role_record.display_name if role_record else None,
                role_id=role_record.id if role_record else None,
            )
        )

    return response


@router.post("/assign", response_model=UserWithRoleResponse)
async def assign_role(
    data: AssignRoleRequest,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Assign or update a user's role (admin only)."""
    if data.app_role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}",
        )

    # Prevent admin from removing their own admin role
    if str(admin.id) == data.user_id and data.app_role != "admin":
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own admin role",
        )

    # Check if user exists
    user_result = await db.execute(select(User).where(User.id == data.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if role already exists
    role_result = await db.execute(
        select(User_roles).where(User_roles.user_id == data.user_id)
    )
    role_record = role_result.scalar_one_or_none()

    now = datetime.now()

    if role_record:
        role_record.app_role = data.app_role
        role_record.display_name = data.display_name or role_record.display_name
        role_record.updated_at = now
    else:
        role_record = User_roles(
            user_id=data.user_id,
            app_role=data.app_role,
            display_name=data.display_name or user.name or user.email,
            created_at=now,
            updated_at=now,
        )
        db.add(role_record)

    await db.commit()
    await db.refresh(role_record)

    logger.info(f"Role assigned: user={data.user_id}, role={data.app_role} by admin={admin.id}")

    return UserWithRoleResponse(
        user_id=user.id,
        email=user.email,
        name=user.name,
        app_role=role_record.app_role,
        display_name=role_record.display_name,
        role_id=role_record.id,
    )
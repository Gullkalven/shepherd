"""Entity row ownership for queries and lookups.

Admins (including provisional PIN admins) may access rows regardless of `user_id`;
workers stay scoped to their own rows (and PIN workers to their project).
"""

from typing import Optional

from dependencies.auth import get_current_user
from dependencies.roles import ROLE_ADMIN, get_current_app_role
from fastapi import Depends
from schemas.auth import UserResponse


async def entity_owner_user_id(
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
) -> Optional[str]:
    """Return None for admins (no ownership filter); otherwise the current user id."""
    if app_role == ROLE_ADMIN:
        return None
    return str(current_user.id)

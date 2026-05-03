from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: str  # Now a string UUID (platform sub)
    email: str
    name: Optional[str] = None
    role: str = "user"  # user/admin
    last_login: Optional[datetime] = None
    # Project-worker PIN session (JWT): actor name + single-project scope
    is_worker_session: bool = False
    worker_project_id: Optional[int] = None
    # Provisional admin PIN session (JWT) — separate from workers and OIDC
    is_provisional_admin: bool = False

    class Config:
        from_attributes = True


class PlatformTokenExchangeRequest(BaseModel):
    """Request body for exchanging Platform token for app token."""

    platform_token: str


class TokenExchangeResponse(BaseModel):
    """Response body for issued application token."""

    token: str

"""Provisional admin PIN login — isolated from worker PIN and OIDC (replace with SSO later)."""

import logging

from core.auth import create_access_token
from core.database import get_db
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from services.provisional_admin_auth import verify_admin_pin
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/provisional", tags=["admin_provisional"])

# 3 hours — aligns with typical 2–4h operator session; JWT enforces server-side.
ADMIN_PROVISIONAL_TOKEN_MINUTES = 180


class AdminProvisionalLoginRequest(BaseModel):
    password: str = Field(..., min_length=4, max_length=128)


class AdminProvisionalLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int


@router.post("/login", response_model=AdminProvisionalLoginResponse)
async def provisional_admin_login(body: AdminProvisionalLoginRequest, db: AsyncSession = Depends(get_db)):
    ok = await verify_admin_pin(db, body.password)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    claims = {
        "sub": "provisional-admin",
        "shepherd_typ": "provisional_admin",
    }
    token = create_access_token(claims, expires_minutes=ADMIN_PROVISIONAL_TOKEN_MINUTES)
    return AdminProvisionalLoginResponse(
        access_token=token,
        expires_in_minutes=ADMIN_PROVISIONAL_TOKEN_MINUTES,
    )

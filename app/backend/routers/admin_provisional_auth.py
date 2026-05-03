"""Provisional admin PIN login — isolated from worker PIN and OIDC (replace with SSO later)."""

import logging
import os

from core.auth import create_access_token
from core.config import settings
from core.database import get_db
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from services.provisional_admin_auth import verify_admin_pin
from sqlalchemy.exc import SQLAlchemyError
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


def _jwt_can_issue_tokens() -> bool:
    """True if app JWT can be signed (avoids uncaught ValueError/AttributeError from create_access_token)."""
    if (os.environ.get("JWT_SECRET_KEY") or "").strip():
        return True
    try:
        s = settings.jwt_secret_key
        return bool(s and str(s).strip())
    except AttributeError:
        return False


@router.post("/login", response_model=AdminProvisionalLoginResponse)
async def provisional_admin_login(body: AdminProvisionalLoginRequest, db: AsyncSession = Depends(get_db)):
    if not _jwt_can_issue_tokens():
        logger.error(
            "provisional_admin_login blocked: JWT_SECRET_KEY is missing or empty (cannot sign provisional admin token)"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is not configured to issue tokens (set JWT_SECRET_KEY on the backend).",
        )

    try:
        ok = await verify_admin_pin(db, (body.password or "").strip())
    except SQLAlchemyError:
        logger.exception("provisional_admin_login: database error in verify_admin_pin (table missing or DB down?)")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login temporarily unavailable (database error).",
        ) from None

    if not ok:
        logger.warning("provisional_admin_login: wrong password or provisional admin PIN not provisioned in DB")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials")

    try:
        claims = {
            "sub": "provisional-admin",
            "shepherd_typ": "provisional_admin",
        }
        token = create_access_token(claims, expires_minutes=ADMIN_PROVISIONAL_TOKEN_MINUTES)
    except (AttributeError, ValueError) as e:
        logger.exception("provisional_admin_login: create_access_token failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is not configured to issue tokens (check JWT_SECRET_KEY).",
        ) from e

    logger.info("provisional_admin_login: success (provisional admin token issued)")

    return AdminProvisionalLoginResponse(
        access_token=token,
        expires_in_minutes=ADMIN_PROVISIONAL_TOKEN_MINUTES,
    )

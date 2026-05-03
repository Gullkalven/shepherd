"""Provisional admin PIN login — isolated from worker PIN and OIDC (replace with SSO later)."""

import logging

from core.auth import create_access_token
from core.config import get_jwt_signing_secret
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


@router.post("/login", response_model=AdminProvisionalLoginResponse)
async def provisional_admin_login(body: AdminProvisionalLoginRequest, db: AsyncSession = Depends(get_db)):
    signing_available = bool(get_jwt_signing_secret())
    logger.info(
        "provisional_admin_login: jwt signing secret available=%s",
        "yes" if signing_available else "no",
    )
    if not signing_available:
        logger.error(
            "provisional_admin_login blocked: no JWT signing secret (set JWT_SECRET_KEY, or SECRET_KEY as fallback)"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is not configured to issue tokens (set JWT_SECRET_KEY, or SECRET_KEY as fallback).",
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
        logger.exception(
            "provisional_admin_login: create_access_token failed (%s)",
            type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server could not issue a token (check JWT_SECRET_KEY or SECRET_KEY, and JWT_ALGORITHM / JWT_EXPIRE_MINUTES).",
        ) from e

    logger.info("provisional_admin_login: success (provisional admin token issued)")

    return AdminProvisionalLoginResponse(
        access_token=token,
        expires_in_minutes=ADMIN_PROVISIONAL_TOKEN_MINUTES,
    )

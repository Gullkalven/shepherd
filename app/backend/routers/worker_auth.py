"""PIN login for provisional project workers."""

import logging
from typing import Optional

from core.auth import create_access_token
from core.database import get_db
from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from schemas.auth import UserResponse
from services.pin_policy import validate_worker_login_pin_plaintext
from services.project_workers import verify_worker_login
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.projects import Projects

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/worker/auth", tags=["worker_auth"])

WORKER_TOKEN_MINUTES = 60 * 24 * 14


class WorkerLoginRequest(BaseModel):
    project_id: int = Field(..., ge=1)
    pin: str = Field(..., min_length=1, max_length=32)


class WorkerLoginProject(BaseModel):
    id: int
    name: str


class WorkerLoginWorker(BaseModel):
    id: int
    name: str
    project_id: int


class WorkerLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    project: WorkerLoginProject
    worker: WorkerLoginWorker


@router.post("/login", response_model=WorkerLoginResponse)
async def worker_login(body: WorkerLoginRequest, db: AsyncSession = Depends(get_db)):
    """Exchange project id + PIN for a JWT scoped to that project (same signing secret as app tokens)."""
    pr = await db.execute(select(Projects).where(Projects.id == body.project_id))
    proj = pr.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        login_pin = validate_worker_login_pin_plaintext(body.pin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = await verify_worker_login(db, project_id=body.project_id, pin=login_pin)
    if row is None:
        raise HTTPException(status_code=401, detail="Wrong PIN or inactive worker")

    owner_sub = str(proj.user_id)
    claims = {
        "sub": owner_sub,
        "shepherd_typ": "project_worker",
        "wid": row.id,
        "pid": body.project_id,
        "worker_name": row.name,
    }
    token = create_access_token(claims, expires_minutes=WORKER_TOKEN_MINUTES)

    return WorkerLoginResponse(
        access_token=token,
        project=WorkerLoginProject(id=int(proj.id), name=str(proj.name)),
        worker=WorkerLoginWorker(id=int(row.id), name=str(row.name), project_id=int(row.project_id)),
    )


class WorkerSessionHint(BaseModel):
    project_id: Optional[int] = None
    worker_name: Optional[str] = None


@router.get("/session", response_model=WorkerSessionHint)
async def worker_session_hint(current_user: UserResponse = Depends(get_current_user)):
    """Lightweight client hint for worker-token sessions."""
    if getattr(current_user, "is_worker_session", False):
        return WorkerSessionHint(
            project_id=getattr(current_user, "worker_project_id", None),
            worker_name=current_user.name,
        )
    return WorkerSessionHint()

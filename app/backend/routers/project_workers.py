"""Admin CRUD for project PIN workers."""

import logging
from typing import List, Optional

from core.database import get_db
from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from routers.admin_roles import require_admin
from schemas.auth import UserResponse
from services import project_workers as pw_svc
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/projects/{project_id}/workers", tags=["project_workers"])


class ProjectWorkerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    pin: str = Field(..., min_length=1, max_length=32)
    role: str = Field(default="worker", pattern="^(worker|admin)$")


class ProjectWorkerPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    pin: Optional[str] = Field(default=None, min_length=1, max_length=32)
    active: Optional[bool] = None
    role: Optional[str] = None


class ProjectWorkerResponse(BaseModel):
    id: int
    project_id: int
    name: str
    role: str
    active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@router.get("", response_model=List[ProjectWorkerResponse])
async def list_workers(
    project_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    logger.debug("ProjectWorkersRoute.list_workers project_id=%s admin_id=%s", project_id, getattr(admin, "id", None))
    rows = await pw_svc.list_for_project(db, project_id=project_id)
    logger.debug("ProjectWorkersRoute.list_workers result project_id=%s count=%s", project_id, len(rows))
    return [ProjectWorkerResponse(**pw_svc.public_worker_dict(r)) for r in rows]


@router.post("", response_model=ProjectWorkerResponse)
async def create_worker_route(
    project_id: int,
    body: ProjectWorkerCreate,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    logger.info(
        "ProjectWorkersRoute.create_worker start project_id=%s admin_id=%s name=%s",
        project_id,
        getattr(admin, "id", None),
        (body.name or "").strip(),
    )
    try:
        row = await pw_svc.create_worker(
            db,
            project_id=project_id,
            name=body.name,
            pin=body.pin,
            role=body.role,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    logger.info("ProjectWorkersRoute.create_worker created project_id=%s worker_id=%s", project_id, row.id)
    return ProjectWorkerResponse(**pw_svc.public_worker_dict(row))


@router.patch("/{worker_id}", response_model=ProjectWorkerResponse)
async def patch_worker_route(
    project_id: int,
    worker_id: int,
    body: ProjectWorkerPatch,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await pw_svc.update_worker(
            db,
            project_id=project_id,
            worker_id=worker_id,
            name=body.name,
            pin=body.pin,
            active=body.active,
            role=body.role,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not row:
        raise HTTPException(status_code=404, detail="Worker not found")
    return ProjectWorkerResponse(**pw_svc.public_worker_dict(row))


@router.delete("/{worker_id}")
@router.delete("/{worker_id}/")
async def delete_worker_route(
    project_id: int,
    worker_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    logger.info(
        "ProjectWorkersRoute.delete_worker start project_id=%s worker_id=%s admin_id=%s",
        project_id,
        worker_id,
        getattr(admin, "id", None),
    )
    try:
        deleted = await pw_svc.delete_worker(db, project_id=project_id, worker_id=worker_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Worker not found")
        logger.info(
            "ProjectWorkersRoute.delete_worker success project_id=%s worker_id=%s",
            project_id,
            worker_id,
        )
        return {"ok": True, "project_id": project_id, "worker_id": worker_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "ProjectWorkersRoute.delete_worker failed project_id=%s worker_id=%s",
            project_id,
            worker_id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete worker")

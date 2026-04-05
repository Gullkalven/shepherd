"""Per-project workflow phases (order + labels). Admins can edit."""

import json
import logging
import re
from typing import Any, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from dependencies.roles import require_admin_role
from models.rooms import Rooms
from models.tasks import Tasks
from schemas.auth import UserResponse
from services.projects import ProjectsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/projects", tags=["project_workflow"])

DEFAULT_PHASES: List[dict[str, str]] = [
    {"key": "demontering", "label": "Demontering"},
    {"key": "varmekabel", "label": "Varmekabel"},
    {"key": "remontering", "label": "Remontering"},
    {"key": "sluttkontroll", "label": "Sluttkontroll"},
]

KEY_RE = re.compile(r"^[a-z0-9_]{1,64}$")


class WorkflowPhase(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=120)


class ProjectWorkflowResponse(BaseModel):
    phases: List[WorkflowPhase]


class ProjectWorkflowUpdate(BaseModel):
    phases: List[WorkflowPhase]


def _parse_stored_workflow(raw: Optional[str]) -> Optional[List[WorkflowPhase]]:
    if not raw or not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    out: List[WorkflowPhase] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        k = item.get("key")
        lab = item.get("label")
        if isinstance(k, str) and isinstance(lab, str) and k.strip() and lab.strip():
            try:
                out.append(WorkflowPhase(key=k.strip(), label=lab.strip()))
            except Exception:
                continue
    return out if out else None


def _default_response() -> ProjectWorkflowResponse:
    return ProjectWorkflowResponse(phases=[WorkflowPhase(**p) for p in DEFAULT_PHASES])


def _validate_phases(phases: List[WorkflowPhase]) -> None:
    if len(phases) < 1:
        raise HTTPException(status_code=400, detail="At least one phase is required")
    if len(phases) > 24:
        raise HTTPException(status_code=400, detail="Too many phases (max 24)")
    keys: Set[str] = set()
    for p in phases:
        if p.key in keys:
            raise HTTPException(status_code=400, detail=f"Duplicate phase key: {p.key}")
        keys.add(p.key)
        if not KEY_RE.match(p.key):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid phase key {p.key!r}: use lowercase letters, digits, underscores only",
            )


async def _count_rooms_with_phase(
    db: AsyncSession, project_id: int, user_id: str, phase_key: str
) -> int:
    q = select(func.count(Rooms.id)).where(
        Rooms.project_id == project_id,
        Rooms.phase == phase_key,
        Rooms.user_id == user_id,
    )
    r = await db.execute(q)
    return int(r.scalar() or 0)


async def _count_tasks_with_phase_in_project(
    db: AsyncSession, project_id: int, user_id: str, phase_key: str
) -> int:
    q = (
        select(func.count(Tasks.id))
        .select_from(Tasks)
        .join(Rooms, Tasks.room_id == Rooms.id)
        .where(
            Rooms.project_id == project_id,
            Rooms.user_id == user_id,
            Tasks.phase == phase_key,
        )
    )
    r = await db.execute(q)
    return int(r.scalar() or 0)


@router.get("/{project_id}/workflow", response_model=ProjectWorkflowResponse)
async def get_project_workflow(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = ProjectsService(db)
    proj = await service.get_by_id(project_id, user_id=str(current_user.id))
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    parsed = _parse_stored_workflow(getattr(proj, "phase_workflow_json", None))
    if parsed:
        return ProjectWorkflowResponse(phases=parsed)
    return _default_response()


@router.put("/{project_id}/workflow", response_model=ProjectWorkflowResponse)
async def put_project_workflow(
    project_id: int,
    body: ProjectWorkflowUpdate,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    service = ProjectsService(db)
    proj = await service.get_by_id(project_id, user_id=str(current_user.id))
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    _validate_phases(body.phases)
    new_keys = {p.key for p in body.phases}

    old_parsed = _parse_stored_workflow(getattr(proj, "phase_workflow_json", None))
    old_keys: Set[str] = (
        {p.key for p in old_parsed} if old_parsed else {p["key"] for p in DEFAULT_PHASES}
    )
    removed = old_keys - new_keys
    uid = str(current_user.id)
    for rk in removed:
        rc = await _count_rooms_with_phase(db, project_id, uid, rk)
        if rc > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot remove phase {rk!r}: {rc} room(s) still use it. Move those rooms first.",
            )
        tc = await _count_tasks_with_phase_in_project(db, project_id, uid, rk)
        if tc > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot remove phase {rk!r}: checklist still references it in {tc} item(s).",
            )

    payload: List[dict[str, Any]] = [{"key": p.key, "label": p.label} for p in body.phases]
    proj.phase_workflow_json = json.dumps(payload, ensure_ascii=False)
    await db.commit()
    await db.refresh(proj)
    logger.info("Updated workflow for project %s (%d phases)", project_id, len(body.phases))
    return ProjectWorkflowResponse(phases=body.phases)

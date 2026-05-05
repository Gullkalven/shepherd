import logging
import json
from typing import List, Optional

from core.database import get_db
from dependencies.auth import get_current_user
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from routers.admin_roles import require_admin
from schemas.auth import UserResponse
from services import project_workers as pw_svc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.rooms import Rooms
from models.worker_tasks import WorkerTasks
from models.projects import Projects

logger = logging.getLogger(__name__)

router = APIRouter(tags=["worker_tasks"])

ALLOWED_STATUSES = {"pending", "in_progress", "done"}
ALLOWED_TYPES = {"varmekabel", "remontering"}


class WorkerTaskCreate(BaseModel):
    worker_id: int = Field(..., ge=1)
    room_id: int = Field(..., ge=1)
    type: str = Field(..., min_length=1, max_length=64)
    status: str = Field(default="pending")


class WorkerTaskPatch(BaseModel):
    status: Optional[str] = None


class WorkerTaskResponse(BaseModel):
    id: int
    worker_id: int
    worker_name: Optional[str] = None
    room_id: int
    room_number: Optional[str] = None
    floor_id: Optional[int] = None
    project_id: Optional[int] = None
    type: str
    status: str


class WorkerPhaseAssignmentResponse(BaseModel):
    room_id: int
    room_number: Optional[str] = None
    floor_id: Optional[int] = None
    project_id: Optional[int] = None
    phase_key: str
    phase_label: str
    assigned_worker_id: int


def _task_response(task: WorkerTasks, room: Optional[Rooms], worker_name: Optional[str]) -> WorkerTaskResponse:
    return WorkerTaskResponse(
        id=int(task.id),
        worker_id=int(task.worker_id),
        worker_name=worker_name,
        room_id=int(task.room_id),
        room_number=str(room.room_number) if room and room.room_number is not None else None,
        floor_id=int(room.floor_id) if room and room.floor_id is not None else None,
        project_id=int(room.project_id) if room and room.project_id is not None else None,
        type=str(task.type),
        status=str(task.status),
    )


@router.get("/api/v1/projects/{project_id}/worker-tasks", response_model=List[WorkerTaskResponse])
async def list_project_worker_tasks(
    project_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(WorkerTasks, Rooms).join(Rooms, WorkerTasks.room_id == Rooms.id).where(Rooms.project_id == project_id)
    )
    out: List[WorkerTaskResponse] = []
    for task, room in rows.all():
        worker = await pw_svc.worker_row_by_id(db, int(task.worker_id))
        out.append(_task_response(task, room, worker.name if worker else None))
    return out


@router.post("/api/v1/projects/{project_id}/worker-tasks", response_model=WorkerTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_project_worker_task(
    project_id: int,
    body: WorkerTaskCreate,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    task_type = (body.type or "").strip().lower()
    if task_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid task type. Allowed: {', '.join(sorted(ALLOWED_TYPES))}")
    task_status = (body.status or "pending").strip().lower()
    if task_status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {', '.join(sorted(ALLOWED_STATUSES))}")

    room_row = await db.execute(select(Rooms).where(Rooms.id == body.room_id, Rooms.project_id == project_id))
    room = room_row.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found in this project")

    worker = await pw_svc.get_worker_by_id(db, body.worker_id, project_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in this project")

    row = WorkerTasks(worker_id=body.worker_id, room_id=body.room_id, type=task_type, status=task_status)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _task_response(row, room, worker.name)


@router.patch("/api/v1/projects/{project_id}/worker-tasks/{task_id}", response_model=WorkerTaskResponse)
async def patch_project_worker_task(
    project_id: int,
    task_id: int,
    body: WorkerTaskPatch,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row_q = await db.execute(
        select(WorkerTasks, Rooms).join(Rooms, WorkerTasks.room_id == Rooms.id).where(
            WorkerTasks.id == task_id,
            Rooms.project_id == project_id,
        )
    )
    pair = row_q.one_or_none()
    if not pair:
        raise HTTPException(status_code=404, detail="Task not found")
    task, room = pair

    if body.status is not None:
        new_status = body.status.strip().lower()
        if new_status not in ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {', '.join(sorted(ALLOWED_STATUSES))}")
        task.status = new_status

    await db.commit()
    await db.refresh(task)
    worker = await pw_svc.worker_row_by_id(db, int(task.worker_id))
    return _task_response(task, room, worker.name if worker else None)


@router.get("/api/v1/worker-tasks/my", response_model=List[WorkerTaskResponse])
async def list_my_worker_tasks(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not getattr(current_user, "is_worker_session", False) or not getattr(current_user, "worker_id", None):
        raise HTTPException(status_code=403, detail="Worker session required")

    worker_id = int(current_user.worker_id)
    rows = await db.execute(
        select(WorkerTasks, Rooms)
        .join(Rooms, WorkerTasks.room_id == Rooms.id)
        .where(
            WorkerTasks.worker_id == worker_id,
            Rooms.project_id == int(current_user.worker_project_id or 0),
        )
        .order_by(WorkerTasks.id.desc())
    )
    out: List[WorkerTaskResponse] = []
    for task, room in rows.all():
        out.append(_task_response(task, room, current_user.name))
    return out


@router.get("/api/v1/worker-phases/my", response_model=List[WorkerPhaseAssignmentResponse])
async def list_my_phase_assignments(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not getattr(current_user, "is_worker_session", False) or not getattr(current_user, "worker_id", None):
        raise HTTPException(status_code=403, detail="Worker session required")

    worker_id = int(current_user.worker_id)
    worker_project_id = int(current_user.worker_project_id or 0)

    rooms_res = await db.execute(select(Rooms).where(Rooms.project_id == worker_project_id))
    rooms = rooms_res.scalars().all()

    workflow_res = await db.execute(select(Projects).where(Projects.id == worker_project_id))
    project = workflow_res.scalar_one_or_none()
    labels_by_phase: dict[str, str] = {}
    if project and getattr(project, "phase_workflow_json", None):
        try:
            parsed = json.loads(project.phase_workflow_json)
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    key = str(item.get("key") or "").strip()
                    label = str(item.get("label") or "").strip()
                    if key:
                        labels_by_phase[key] = label or key
        except Exception:
            logger.debug("Failed parsing phase workflow JSON for project %s", worker_project_id, exc_info=True)

    out: List[WorkerPhaseAssignmentResponse] = []
    for room in rooms:
        raw = getattr(room, "phase_assigned_worker_ids", None)
        if not isinstance(raw, dict):
            continue
        for phase_key_raw, assigned_worker_raw in raw.items():
            phase_key = str(phase_key_raw or "").strip()
            if not phase_key:
                continue
            try:
                assigned_worker_id = int(assigned_worker_raw)
            except (TypeError, ValueError):
                continue
            if assigned_worker_id != worker_id:
                continue
            out.append(
                WorkerPhaseAssignmentResponse(
                    room_id=int(room.id),
                    room_number=str(room.room_number) if room.room_number is not None else None,
                    floor_id=int(room.floor_id) if room.floor_id is not None else None,
                    project_id=int(room.project_id) if room.project_id is not None else None,
                    phase_key=phase_key,
                    phase_label=labels_by_phase.get(phase_key, phase_key),
                    assigned_worker_id=assigned_worker_id,
                )
            )

    out.sort(key=lambda x: (x.room_number or "", x.phase_label, x.room_id))
    return out

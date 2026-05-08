from datetime import datetime
from typing import Dict, List, Optional

from core.database import get_db
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from routers.admin_roles import require_admin
from schemas.auth import UserResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.floors import Floors
from models.project_workers import Project_workers
from models.projects import Projects
from models.rooms import Rooms
from models.section_settings import Section_settings
from models.user_roles import User_roles
from models.worker_tasks import WorkerTasks
from dependencies.roles import ROLE_ADMIN, normalize_role

router = APIRouter(prefix="/api/v1/admin/panel", tags=["admin_panel"])

FEATURE_KEYS = ("checklists", "heating_cable", "photos", "comments", "visit_log")
DEFAULT_FEATURES = {k: True for k in FEATURE_KEYS}


class FeatureToggle(BaseModel):
    key: str
    enabled: bool


class ProjectOverviewResponse(BaseModel):
    project_id: int
    project_name: str
    floors: int
    rooms: int
    active_workers: int
    site_workers: int = 0
    admin_count: int = 0
    enabled_features: List[str]


class SiteWorkerCardResponse(BaseModel):
    id: int
    name: str
    active: bool
    pin_configured: bool = False
    assigned_floor: Optional[str] = None
    assigned_room: Optional[str] = None
    assigned_phase: Optional[str] = None
    last_active_at: Optional[str] = None


def _feature_scope(project_id: int) -> str:
    return f"project:{project_id}"


async def _read_project_features(db: AsyncSession, project_id: int) -> Dict[str, bool]:
    result = await db.execute(
        select(Section_settings).where(
            and_(
                Section_settings.role_name == _feature_scope(project_id),
            )
        )
    )
    rows = result.scalars().all()
    merged = dict(DEFAULT_FEATURES)
    for row in rows:
        key = (row.section_key or "").strip().lower()
        if key in merged:
            merged[key] = bool(row.is_visible)
    return merged


@router.get("/projects/{project_id}/overview", response_model=ProjectOverviewResponse)
async def project_overview(
    project_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    del admin
    project_result = await db.execute(select(Projects).where(Projects.id == project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    floors_result = await db.execute(select(Floors).where(Floors.project_id == project_id))
    rooms_result = await db.execute(select(Rooms).where(Rooms.project_id == project_id))
    workers_result = await db.execute(
        select(Project_workers).where(
            and_(
                Project_workers.project_id == project_id,
                Project_workers.role != ROLE_ADMIN,
            )
        )
    )
    workers = workers_result.scalars().all()
    admins_result = await db.execute(select(User_roles))
    admin_count = sum(
        1 for role_row in admins_result.scalars().all()
        if normalize_role(role_row.app_role) == ROLE_ADMIN
    )
    features = await _read_project_features(db, project_id)
    enabled = [k for k, v in features.items() if v]

    return ProjectOverviewResponse(
        project_id=project.id,
        project_name=project.name,
        floors=len(floors_result.scalars().all()),
        rooms=len(rooms_result.scalars().all()),
        active_workers=sum(1 for w in workers if bool(w.active)),
        site_workers=len(workers),
        admin_count=admin_count,
        enabled_features=enabled,
    )


@router.get("/projects/{project_id}/features", response_model=List[FeatureToggle])
async def get_project_features(
    project_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    del admin
    project_result = await db.execute(select(Projects).where(Projects.id == project_id))
    if project_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")
    feature_map = await _read_project_features(db, project_id)
    return [FeatureToggle(key=key, enabled=feature_map[key]) for key in FEATURE_KEYS]


@router.put("/projects/{project_id}/features/{feature_key}", response_model=FeatureToggle)
async def update_project_feature(
    project_id: int,
    feature_key: str,
    body: FeatureToggle,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if feature_key not in FEATURE_KEYS:
        raise HTTPException(status_code=400, detail="Invalid feature key")

    project_result = await db.execute(select(Projects).where(Projects.id == project_id))
    if project_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(Section_settings).where(
            and_(
                Section_settings.role_name == _feature_scope(project_id),
                Section_settings.section_key == feature_key,
            )
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.is_visible = bool(body.enabled)
    else:
        row = Section_settings(
            user_id=str(admin.id),
            role_name=_feature_scope(project_id),
            section_key=feature_key,
            is_visible=bool(body.enabled),
        )
        db.add(row)
    await db.commit()
    return FeatureToggle(key=feature_key, enabled=bool(body.enabled))


@router.get("/projects/{project_id}/site-workers", response_model=List[SiteWorkerCardResponse])
async def site_workers_with_context(
    project_id: int,
    admin: UserResponse = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    del admin
    project_result = await db.execute(select(Projects).where(Projects.id == project_id))
    if project_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")

    workers_result = await db.execute(
        select(Project_workers)
        .where(
            and_(
                Project_workers.project_id == project_id,
                Project_workers.role != ROLE_ADMIN,
            )
        )
        .order_by(Project_workers.active.desc(), Project_workers.updated_at.desc(), Project_workers.id.desc())
    )
    workers = workers_result.scalars().all()
    if not workers:
        return []

    worker_ids = [int(w.id) for w in workers]
    tasks_result = await db.execute(select(WorkerTasks).where(WorkerTasks.worker_id.in_(worker_ids)))
    tasks = tasks_result.scalars().all()

    rooms_result = await db.execute(select(Rooms).where(Rooms.project_id == project_id))
    rooms = rooms_result.scalars().all()
    floor_ids = [r.floor_id for r in rooms]
    floors_result = await db.execute(select(Floors).where(Floors.id.in_(floor_ids))) if floor_ids else None
    floors = floors_result.scalars().all() if floors_result else []
    floors_by_id = {f.id: f for f in floors}

    task_last_active: Dict[int, datetime] = {}
    for task in tasks:
        ts = task.updated_at or task.created_at
        if not ts:
            continue
        current = task_last_active.get(task.worker_id)
        if current is None or ts > current:
            task_last_active[task.worker_id] = ts

    assignment_map: Dict[int, Dict[str, str]] = {}
    for room in rooms:
        raw = getattr(room, "phase_assigned_worker_ids", None)
        if not isinstance(raw, dict):
            continue
        for phase_key, worker_id_raw in raw.items():
            try:
                worker_id = int(worker_id_raw)
            except (TypeError, ValueError):
                continue
            # Prefer first discovered assignment; keeps deterministic/simple output.
            if worker_id in assignment_map:
                continue
            floor = floors_by_id.get(room.floor_id)
            floor_label = floor.name if floor and floor.name else f"Floor {floor.floor_number}" if floor else None
            assignment_map[worker_id] = {
                "assigned_floor": floor_label or "",
                "assigned_room": str(room.room_number),
                "assigned_phase": str(phase_key),
            }

    cards: List[SiteWorkerCardResponse] = []
    for worker in workers:
        assign = assignment_map.get(worker.id, {})
        last_active_dt = task_last_active.get(worker.id) or worker.updated_at or worker.created_at
        cards.append(
            SiteWorkerCardResponse(
                id=worker.id,
                name=worker.name,
                active=bool(worker.active),
                pin_configured=bool(getattr(worker, "pin_hash", None)),
                assigned_floor=assign.get("assigned_floor") or None,
                assigned_room=assign.get("assigned_room") or None,
                assigned_phase=assign.get("assigned_phase") or None,
                last_active_at=last_active_dt.isoformat() if last_active_dt else None,
            )
        )
    return cards

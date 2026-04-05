import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.checklist_template_items import Checklist_template_items
from models.projects import Projects
from models.rooms import Rooms
from models.tasks import Tasks
from models.user_roles import User_roles
from schemas.auth import UserResponse
from dependencies.roles import ROLE_ADMIN, normalize_role
from routers.project_workflow import DEFAULT_PHASES, _parse_stored_workflow
from services.checklist_templates import ChecklistTemplatesService

router = APIRouter(prefix="/api/v1/entities/checklist_templates", tags=["checklist_templates"])


def _workflow_phase_keys_for_project(proj: Optional[Projects]) -> List[str]:
    if proj is None:
        return [p["key"] for p in DEFAULT_PHASES]
    parsed = _parse_stored_workflow(getattr(proj, "phase_workflow_json", None))
    if parsed:
        return [p.key for p in parsed]
    return [p["key"] for p in DEFAULT_PHASES]


def _normalize_task_phase_key(raw: Optional[str], phase_keys: List[str]) -> str:
    if not phase_keys:
        return "demontering"
    if raw is None or not str(raw).strip():
        return phase_keys[0]
    s = str(raw).strip()
    return s if s in phase_keys else phase_keys[0]


class ChecklistTemplatesData(BaseModel):
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChecklistTemplatesUpdateData(BaseModel):
    name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChecklistTemplatesResponse(BaseModel):
    id: int
    user_id: str
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ChecklistTemplatesListResponse(BaseModel):
    items: List[ChecklistTemplatesResponse]
    total: int
    skip: int
    limit: int


async def require_manager_or_admin(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    result = await db.execute(select(User_roles).where(User_roles.user_id == str(current_user.id)))
    role_record = result.scalar_one_or_none()
    if role_record and normalize_role(role_record.app_role) == ROLE_ADMIN:
        return current_user

    count_result = await db.execute(select(func.count(User_roles.id)))
    total_roles = count_result.scalar()
    if total_roles == 0:
        return current_user

    raise HTTPException(status_code=403, detail="Admin access required")


@router.get("", response_model=ChecklistTemplatesListResponse)
async def query_checklist_templates(
    query: str = Query(None),
    sort: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=2000),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(
        skip=skip,
        limit=limit,
        query_dict=query_dict,
        sort=sort,
        user_id=str(current_user.id),
    )


@router.get("/{id}", response_model=ChecklistTemplatesResponse)
async def get_checklist_template(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    result = await service.get_by_id(id, user_id=str(current_user.id))
    if not result:
        raise HTTPException(status_code=404, detail="Checklist template not found")
    return result


@router.post("", response_model=ChecklistTemplatesResponse, status_code=201)
async def create_checklist_template(
    data: ChecklistTemplatesData,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    result = await service.create(data.model_dump(), user_id=str(manager.id))
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create checklist template")
    return result


@router.put("/{id}", response_model=ChecklistTemplatesResponse)
async def update_checklist_template(
    id: int,
    data: ChecklistTemplatesUpdateData,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    result = await service.update(id, update_dict, user_id=str(manager.id))
    if not result:
        raise HTTPException(status_code=404, detail="Checklist template not found")
    return result


@router.delete("/{id}")
async def delete_checklist_template(
    id: int,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    success = await service.delete(id, user_id=str(manager.id))
    if not success:
        raise HTTPException(status_code=404, detail="Checklist template not found")
    return {"message": "Checklist template deleted", "id": id}


@router.post("/{id}/sync-rooms")
async def sync_rooms_from_template(
    id: int,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplatesService(db)
    template = await service.get_by_id(id, user_id=str(manager.id))
    if not template:
        raise HTTPException(status_code=404, detail="Checklist template not found")

    items_result = await db.execute(
        select(Checklist_template_items)
        .where(
            Checklist_template_items.template_id == id,
            Checklist_template_items.user_id == str(manager.id),
        )
        .order_by(Checklist_template_items.sort_order, Checklist_template_items.id)
    )
    template_items = items_result.scalars().all()
    template_item_ids = {item.id for item in template_items}

    tasks_result = await db.execute(
        select(Tasks).where(
            Tasks.template_id == id,
            Tasks.user_id == str(manager.id),
            Tasks.is_template_managed == True,  # noqa: E712
        )
    )
    managed_tasks = tasks_result.scalars().all()

    rooms_with_template = sorted({task.room_id for task in managed_tasks})
    added = 0
    updated = 0
    removed = 0

    uid = str(manager.id)
    rooms_by_id: Dict[int, Rooms] = {}
    projects_by_id: Dict[int, Projects] = {}
    if rooms_with_template:
        rooms_result = await db.execute(
            select(Rooms).where(Rooms.id.in_(rooms_with_template), Rooms.user_id == uid)
        )
        rooms_by_id = {r.id: r for r in rooms_result.scalars().all()}
        proj_ids = {r.project_id for r in rooms_by_id.values()}
        if proj_ids:
            proj_result = await db.execute(
                select(Projects).where(Projects.id.in_(proj_ids), Projects.user_id == uid)
            )
            projects_by_id = {p.id: p for p in proj_result.scalars().all()}

    for room_id in rooms_with_template:
        room_obj = rooms_by_id.get(room_id)
        proj = projects_by_id.get(room_obj.project_id) if room_obj else None
        phase_keys = _workflow_phase_keys_for_project(proj)
        if not phase_keys:
            phase_keys = [p["key"] for p in DEFAULT_PHASES]

        room_tasks = [task for task in managed_tasks if task.room_id == room_id]

        # Remove managed tasks for template items that no longer exist.
        for task in list(room_tasks):
            if task.template_item_id is None or task.template_item_id not in template_item_ids:
                await db.delete(task)
                removed += 1

        fresh_result = await db.execute(
            select(Tasks).where(
                Tasks.room_id == room_id,
                Tasks.template_id == id,
                Tasks.user_id == uid,
                Tasks.is_template_managed == True,  # noqa: E712
            )
        )
        room_tasks = list(fresh_result.scalars().all())

        by_template_item_phase: Dict[Tuple[int, str], Tasks] = {}
        for task in room_tasks:
            tid = task.template_item_id
            if tid is None:
                continue
            ph = _normalize_task_phase_key(getattr(task, "phase", None), phase_keys)
            by_template_item_phase[(tid, ph)] = task

        # One checklist row per template line per workflow phase.
        for phase_key in phase_keys:
            for idx, item in enumerate(template_items):
                existing = by_template_item_phase.get((item.id, phase_key))
                if not existing:
                    db.add(
                        Tasks(
                            room_id=room_id,
                            name=item.name,
                            is_completed=False,
                            sort_order=idx,
                            checked_by=None,
                            checked_at=None,
                            user_id=uid,
                            template_id=id,
                            template_item_id=item.id,
                            is_template_managed=True,
                            is_overridden=False,
                            phase=phase_key,
                        )
                    )
                    added += 1
                    continue

                if not existing.is_overridden:
                    changed = False
                    if existing.name != item.name:
                        existing.name = item.name
                        changed = True
                    if existing.sort_order != idx:
                        existing.sort_order = idx
                        changed = True
                    if changed:
                        updated += 1

    await db.commit()
    return {
        "message": "Rooms synced from template",
        "rooms_affected": len(rooms_with_template),
        "added": added,
        "updated": updated,
        "removed": removed,
    }

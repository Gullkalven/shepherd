import json
import logging
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.rooms import Rooms
from services.tasks import TasksService
from dependencies.auth import get_current_user
from dependencies.phase_edit import (
    effective_task_phase,
    ensure_room_phase_editable_for_worker,
    workflow_keys_for_room,
)
from dependencies.room_areas import norm_area_id, room_phase_for_area
from dependencies.room_lock import ensure_room_mutable
from dependencies.roles import get_current_app_role
from schemas.auth import UserResponse
from services.room_activity import actor_display, append_room_activity, phase_display_label

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/tasks", tags=["tasks"])


async def _append_task_create_activity(
    db: AsyncSession,
    *,
    room_obj: Rooms,
    task_row: Any,
    user_id: str,
    current_user: UserResponse,
) -> None:
    keys = await workflow_keys_for_room(db, room_obj)
    aid = norm_area_id(getattr(task_row, "area_id", None))
    area_rp = room_phase_for_area(room_obj, aid, keys)
    phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
    eff = effective_task_phase(getattr(task_row, "phase", None), area_rp, keys, phase_statuses_raw)
    plab = await phase_display_label(db, room_obj, eff)
    await append_room_activity(
        db,
        getattr(task_row, "room_id"),
        user_id,
        kind="checklist_item_added",
        actor=actor_display(current_user),
        phase_key=eff,
        phase_label=plab,
        area_id=aid,
        item_name=getattr(task_row, "name", None),
        task_id=getattr(task_row, "id", None),
    )


async def _append_task_change_activity(
    db: AsyncSession,
    *,
    task_before: Any,
    update_dict: Dict[str, Any],
    room_obj: Rooms,
    user_id: str,
    current_user: UserResponse,
) -> None:
    keys = await workflow_keys_for_room(db, room_obj)
    merged_phase = update_dict.get("phase", getattr(task_before, "phase", None))
    aid_u = norm_area_id(update_dict.get("area_id", getattr(task_before, "area_id", None)))
    area_rp = room_phase_for_area(room_obj, aid_u, keys)
    phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
    eff = effective_task_phase(merged_phase, area_rp, keys, phase_statuses_raw)
    plab = await phase_display_label(db, room_obj, eff)
    aid_str = norm_area_id(getattr(task_before, "area_id", None))
    old_name = getattr(task_before, "name", "") or ""
    old_completed = bool(getattr(task_before, "is_completed", False))
    tid = getattr(task_before, "id", None)
    rid = getattr(task_before, "room_id")
    actor_toggle = (
        (update_dict.get("checked_by") or getattr(task_before, "checked_by", None) or "").strip()
        or actor_display(current_user)
    )

    if "name" in update_dict and update_dict["name"] != old_name:
        await append_room_activity(
            db,
            rid,
            user_id,
            kind="checklist_item_renamed",
            actor=actor_display(current_user),
            phase_key=eff,
            phase_label=plab,
            area_id=aid_str,
            item_name=old_name,
            task_id=tid,
            meta={"new_name": update_dict.get("name")},
        )

    if "is_completed" in update_dict and bool(update_dict["is_completed"]) != old_completed:
        kind = "checklist_checked" if update_dict["is_completed"] else "checklist_unchecked"
        await append_room_activity(
            db,
            rid,
            user_id,
            kind=kind,
            actor=actor_toggle,
            phase_key=eff,
            phase_label=plab,
            area_id=aid_str,
            item_name=old_name,
            task_id=tid,
        )


async def _append_task_delete_activity(
    db: AsyncSession,
    *,
    task_before: Any,
    room_obj: Rooms,
    user_id: str,
    current_user: UserResponse,
) -> None:
    keys = await workflow_keys_for_room(db, room_obj)
    aid = norm_area_id(getattr(task_before, "area_id", None))
    area_rp = room_phase_for_area(room_obj, aid, keys)
    phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
    eff = effective_task_phase(getattr(task_before, "phase", None), area_rp, keys, phase_statuses_raw)
    plab = await phase_display_label(db, room_obj, eff)
    await append_room_activity(
        db,
        getattr(task_before, "room_id"),
        user_id,
        kind="checklist_item_deleted",
        actor=actor_display(current_user),
        phase_key=eff,
        phase_label=plab,
        area_id=aid,
        item_name=getattr(task_before, "name", None),
        task_id=getattr(task_before, "id", None),
    )


# ---------- Pydantic Schemas ----------
class TasksData(BaseModel):
    """Entity data schema (for create/update)"""
    room_id: int
    name: str
    is_completed: bool = None
    sort_order: int = None
    checked_by: str = None
    checked_at: str = None
    template_id: Optional[int] = None
    template_item_id: Optional[int] = None
    is_template_managed: Optional[bool] = None
    is_overridden: Optional[bool] = None
    phase: Optional[str] = None
    area_id: Optional[str] = None


class TasksUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    room_id: Optional[int] = None
    name: Optional[str] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None
    checked_by: Optional[str] = None
    checked_at: Optional[str] = None
    template_id: Optional[int] = None
    template_item_id: Optional[int] = None
    is_template_managed: Optional[bool] = None
    is_overridden: Optional[bool] = None
    phase: Optional[str] = None
    area_id: Optional[str] = None


class TasksResponse(BaseModel):
    """Entity response schema"""
    id: int
    room_id: int
    name: str
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None
    checked_by: Optional[str] = None
    checked_at: Optional[str] = None
    user_id: str
    template_id: Optional[int] = None
    template_item_id: Optional[int] = None
    is_template_managed: Optional[bool] = None
    is_overridden: Optional[bool] = None
    phase: Optional[str] = None
    area_id: Optional[str] = None

    class Config:
        from_attributes = True


class TasksListResponse(BaseModel):
    """List response schema"""
    items: List[TasksResponse]
    total: int
    skip: int
    limit: int


class TasksBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[TasksData]


class TasksBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: TasksUpdateData


class TasksBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[TasksBatchUpdateItem]


class TasksBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=TasksListResponse)
async def query_taskss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query taskss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying taskss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = TasksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} taskss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying taskss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=TasksListResponse)
async def query_taskss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query taskss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying taskss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = TasksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} taskss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying taskss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=TasksResponse)
async def get_tasks(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single tasks by ID (user can only see their own records)"""
    logger.debug(f"Fetching tasks with id: {id}, fields={fields}")
    
    service = TasksService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Tasks with id {id} not found")
            raise HTTPException(status_code=404, detail="Tasks not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=TasksResponse, status_code=201)
async def create_tasks(
    data: TasksData,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Create a new tasks"""
    logger.debug(f"Creating new tasks with data: {data}")
    
    service = TasksService(db)
    try:
        await ensure_room_mutable(db, data.room_id, str(current_user.id), app_role)
        room_row = await db.execute(select(Rooms).where(Rooms.id == data.room_id))
        room_obj = room_row.scalar_one_or_none()
        if not room_obj:
            raise HTTPException(status_code=404, detail="Room not found")
        keys = await workflow_keys_for_room(db, room_obj)
        payload = data.model_dump()
        aid = norm_area_id(payload.get("area_id"))
        area_rp = room_phase_for_area(room_obj, aid, keys)
        phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
        if payload.get("phase") is None or str(payload.get("phase") or "").strip() == "":
            payload["phase"] = effective_task_phase(None, area_rp, keys, phase_statuses_raw)
        eff = effective_task_phase(payload.get("phase"), area_rp, keys, phase_statuses_raw)
        await ensure_room_phase_editable_for_worker(
            db, data.room_id, str(current_user.id), app_role, eff, area_id=aid
        )
        result = await service.create(payload, user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create tasks")

        await _append_task_create_activity(
            db,
            room_obj=room_obj,
            task_row=result,
            user_id=str(current_user.id),
            current_user=current_user,
        )

        logger.info(f"Tasks created successfully with id: {result.id}")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error creating tasks: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating tasks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[TasksResponse], status_code=201)
async def create_taskss_batch(
    request: TasksBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple taskss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} taskss")
    
    service = TasksService(db)
    results = []
    
    try:
        for item_data in request.items:
            await ensure_room_mutable(db, item_data.room_id, str(current_user.id), app_role)
            room_row = await db.execute(select(Rooms).where(Rooms.id == item_data.room_id))
            room_obj = room_row.scalar_one_or_none()
            if not room_obj:
                continue
            keys = await workflow_keys_for_room(db, room_obj)
            payload = item_data.model_dump()
            aid = norm_area_id(payload.get("area_id"))
            area_rp = room_phase_for_area(room_obj, aid, keys)
            phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
            if payload.get("phase") is None or str(payload.get("phase") or "").strip() == "":
                payload["phase"] = effective_task_phase(None, area_rp, keys, phase_statuses_raw)
            eff = effective_task_phase(payload.get("phase"), area_rp, keys, phase_statuses_raw)
            await ensure_room_phase_editable_for_worker(
                db, item_data.room_id, str(current_user.id), app_role, eff, area_id=aid
            )
            result = await service.create(payload, user_id=str(current_user.id))
            if result:
                await _append_task_create_activity(
                    db,
                    room_obj=room_obj,
                    task_row=result,
                    user_id=str(current_user.id),
                    current_user=current_user,
                )
                results.append(result)
        
        logger.info(f"Batch created {len(results)} taskss successfully")
        return results
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[TasksResponse])
async def update_taskss_batch(
    request: TasksBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple taskss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} taskss")
    
    service = TasksService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            task = await service.get_by_id(item.id, user_id=str(current_user.id))
            if not task:
                continue
            await ensure_room_mutable(db, task.room_id, str(current_user.id), app_role)
            new_rid = update_dict.get("room_id")
            if new_rid is not None and new_rid != task.room_id:
                await ensure_room_mutable(db, new_rid, str(current_user.id), app_role)
            room_row = await db.execute(select(Rooms).where(Rooms.id == task.room_id))
            room_obj = room_row.scalar_one_or_none()
            if room_obj:
                keys = await workflow_keys_for_room(db, room_obj)
                merged_phase = update_dict.get("phase", getattr(task, "phase", None))
                aid = norm_area_id(update_dict.get("area_id", getattr(task, "area_id", None)))
                area_rp = room_phase_for_area(room_obj, aid, keys)
                phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
                eff = effective_task_phase(merged_phase, area_rp, keys, phase_statuses_raw)
                await ensure_room_phase_editable_for_worker(
                    db, task.room_id, str(current_user.id), app_role, eff, area_id=aid
                )
            snap = SimpleNamespace(
                id=getattr(task, "id", None),
                room_id=getattr(task, "room_id", None),
                name=getattr(task, "name", "") or "",
                is_completed=bool(getattr(task, "is_completed", False)),
                checked_by=getattr(task, "checked_by", None),
                phase=getattr(task, "phase", None),
                area_id=getattr(task, "area_id", None),
            )
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                if room_obj:
                    await _append_task_change_activity(
                        db,
                        task_before=snap,
                        update_dict=update_dict,
                        room_obj=room_obj,
                        user_id=str(current_user.id),
                        current_user=current_user,
                    )
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} taskss successfully")
        return results
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=TasksResponse)
async def update_tasks(
    id: int,
    data: TasksUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing tasks (requires ownership)"""
    logger.debug(f"Updating tasks {id} with data: {data}")

    service = TasksService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        task = await service.get_by_id(id, user_id=str(current_user.id))
        if not task:
            logger.warning(f"Tasks with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Tasks not found")
        await ensure_room_mutable(db, task.room_id, str(current_user.id), app_role)
        new_rid = update_dict.get("room_id")
        if new_rid is not None and new_rid != task.room_id:
            await ensure_room_mutable(db, new_rid, str(current_user.id), app_role)
        room_row = await db.execute(select(Rooms).where(Rooms.id == task.room_id))
        room_obj = room_row.scalar_one_or_none()
        if room_obj:
            keys = await workflow_keys_for_room(db, room_obj)
            merged_phase = update_dict.get("phase", getattr(task, "phase", None))
            aid = norm_area_id(update_dict.get("area_id", getattr(task, "area_id", None)))
            area_rp = room_phase_for_area(room_obj, aid, keys)
            phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
            eff = effective_task_phase(merged_phase, area_rp, keys, phase_statuses_raw)
            await ensure_room_phase_editable_for_worker(
                db, task.room_id, str(current_user.id), app_role, eff, area_id=aid
            )
        snap = SimpleNamespace(
            id=getattr(task, "id", None),
            room_id=getattr(task, "room_id", None),
            name=getattr(task, "name", "") or "",
            is_completed=bool(getattr(task, "is_completed", False)),
            checked_by=getattr(task, "checked_by", None),
            phase=getattr(task, "phase", None),
            area_id=getattr(task, "area_id", None),
        )
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Tasks with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Tasks not found")

        if room_obj:
            await _append_task_change_activity(
                db,
                task_before=snap,
                update_dict=update_dict,
                room_obj=room_obj,
                user_id=str(current_user.id),
                current_user=current_user,
            )

        logger.info(f"Tasks {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating tasks {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_taskss_batch(
    request: TasksBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple taskss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} taskss")
    
    service = TasksService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            task = await service.get_by_id(item_id, user_id=str(current_user.id))
            if not task:
                continue
            await ensure_room_mutable(db, task.room_id, str(current_user.id), app_role)
            room_row = await db.execute(select(Rooms).where(Rooms.id == task.room_id))
            room_obj = room_row.scalar_one_or_none()
            if room_obj:
                keys = await workflow_keys_for_room(db, room_obj)
                aid = norm_area_id(getattr(task, "area_id", None))
                area_rp = room_phase_for_area(room_obj, aid, keys)
                phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
                eff = effective_task_phase(
                    getattr(task, "phase", None), area_rp, keys, phase_statuses_raw
                )
                await ensure_room_phase_editable_for_worker(
                    db, task.room_id, str(current_user.id), app_role, eff, area_id=aid
                )
            if room_obj:
                await _append_task_delete_activity(
                    db,
                    task_before=task,
                    room_obj=room_obj,
                    user_id=str(current_user.id),
                    current_user=current_user,
                )
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} taskss successfully")
        return {"message": f"Successfully deleted {deleted_count} taskss", "deleted_count": deleted_count}
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_tasks(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single tasks by ID (requires ownership)"""
    logger.debug(f"Deleting tasks with id: {id}")
    
    service = TasksService(db)
    try:
        task = await service.get_by_id(id, user_id=str(current_user.id))
        if not task:
            logger.warning(f"Tasks with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Tasks not found")
        await ensure_room_mutable(db, task.room_id, str(current_user.id), app_role)
        room_row = await db.execute(select(Rooms).where(Rooms.id == task.room_id))
        room_obj = room_row.scalar_one_or_none()
        if room_obj:
            keys = await workflow_keys_for_room(db, room_obj)
            aid = norm_area_id(getattr(task, "area_id", None))
            area_rp = room_phase_for_area(room_obj, aid, keys)
            phase_statuses_raw = getattr(room_obj, "phase_statuses", None)
            eff = effective_task_phase(
                getattr(task, "phase", None), area_rp, keys, phase_statuses_raw
            )
            await ensure_room_phase_editable_for_worker(
                db, task.room_id, str(current_user.id), app_role, eff, area_id=aid
            )
        if room_obj:
            await _append_task_delete_activity(
                db,
                task_before=task,
                room_obj=room_obj,
                user_id=str(current_user.id),
                current_user=current_user,
            )
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Tasks with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Tasks not found")
        
        logger.info(f"Tasks {id} deleted successfully")
        return {"message": "Tasks deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
import json
import logging
from copy import deepcopy
from typing import Any, Dict, List, Optional

from datetime import datetime, date, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.rooms import RoomsService
from dependencies.auth import get_current_user
from dependencies.entity_scope import entity_owner_user_id
from dependencies.worker_scope import worker_project_scope
from dependencies.room_lock import ROOM_LOCKED_DETAIL, ensure_room_mutable
from dependencies.roles import (
    ROLE_ADMIN,
    get_current_app_role,
    require_admin_role,
    require_room_collaborator,
)
from schemas.auth import UserResponse
from dependencies.room_areas import (
    norm_area_id,
    parse_areas_list,
    sanitize_areas_payload,
    worker_phase_context_for_area,
)
from dependencies.phase_edit import (
    workflow_keys_for_room,
    derive_linear_phase_statuses,
    merge_resolve_phase_statuses,
    primary_focus_phase,
    normalize_room_phase,
    phase_tab_locked_for_worker,
    ensure_worker_may_update_room_gated_content,
)
from models.projects import Projects
from services.room_activity import (
    append_room_activity,
    append_room_patch_activity,
    maybe_backfill_legacy_visits_photos,
)
from services.room_visits import Room_visitsService
from sqlalchemy import select

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/rooms", tags=["rooms"])

DEFAULT_CHECKLIST_SECTION = "Checklist"


def sanitize_phase_tool_overrides(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Keep optional per-phase tool toggles small and boolean-safe."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or len(k) > 80:
            continue
        if not isinstance(v, dict):
            continue
        entry: Dict[str, Any] = {}
        if "checklist" in v and isinstance(v["checklist"], bool):
            entry["checklist"] = v["checklist"]
        if "heating_cable" in v and isinstance(v["heating_cable"], bool):
            entry["heating_cable"] = v["heating_cable"]
        if entry:
            out[k.strip()] = entry
    return out or None


def sanitize_checklist_labels(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """Keep optional phase → title map small and string-safe."""
    if raw is None:
        return None
    out: Dict[str, str] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or len(k) > 80:
            continue
        if not isinstance(v, str):
            continue
        t = v.strip()
        if not t or len(t) > 120:
            continue
        if t == DEFAULT_CHECKLIST_SECTION:
            continue
        out[k] = t
    return out or None


def validate_blocked_reason(status: Optional[str], blocked_reason: Optional[str]) -> None:
    if status == "blocked" and not (blocked_reason or "").strip():
        raise HTTPException(status_code=400, detail="Blocked reason is required when status is blocked")


# ---------- Pydantic Schemas ----------
class RoomsData(BaseModel):
    """Entity data schema (for create/update)"""
    floor_id: int
    project_id: int
    room_number: str
    status: str = None
    phase: str = None
    assigned_worker: str = None
    comment: str = None
    blocked_reason: str = None
    is_locked: bool = False
    phase_lock_overrides: Optional[Dict[str, bool]] = None
    workflow_deviations: Optional[List[Dict[str, Any]]] = None
    areas: Optional[List[Dict[str, Any]]] = None
    deadline_at: Optional[datetime] = None
    checklist_labels: Optional[Dict[str, str]] = None
    heating_cable_doc: Optional[Dict[str, Any]] = None
    phase_tool_overrides: Optional[Dict[str, Any]] = None
    phase_statuses: Optional[Dict[str, str]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RoomsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    floor_id: Optional[int] = None
    project_id: Optional[int] = None
    room_number: Optional[str] = None
    status: Optional[str] = None
    phase: Optional[str] = None
    assigned_worker: Optional[str] = None
    comment: Optional[str] = None
    blocked_reason: Optional[str] = None
    is_locked: Optional[bool] = None
    phase_lock_overrides: Optional[Dict[str, bool]] = None
    workflow_deviations: Optional[List[Dict[str, Any]]] = None
    areas: Optional[List[Dict[str, Any]]] = None
    deadline_at: Optional[datetime] = None
    checklist_labels: Optional[Dict[str, str]] = None
    heating_cable_doc: Optional[Dict[str, Any]] = None
    phase_tool_overrides: Optional[Dict[str, Any]] = None
    phase_statuses: Optional[Dict[str, str]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RoomsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    floor_id: int
    project_id: int
    room_number: str
    status: Optional[str] = None
    phase: Optional[str] = None
    assigned_worker: Optional[str] = None
    comment: Optional[str] = None
    blocked_reason: Optional[str] = None
    is_locked: bool = False
    phase_lock_overrides: Optional[Dict[str, Any]] = None
    workflow_deviations: Optional[List[Dict[str, Any]]] = None
    areas: Optional[List[Dict[str, Any]]] = None
    deadline_at: Optional[datetime] = None
    checklist_labels: Optional[Dict[str, Any]] = None
    heating_cable_doc: Optional[Dict[str, Any]] = None
    phase_tool_overrides: Optional[Dict[str, Any]] = None
    phase_statuses: Optional[Dict[str, Any]] = None
    activity_log: Optional[List[Dict[str, Any]]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RoomsListResponse(BaseModel):
    """List response schema"""
    items: List[RoomsResponse]
    total: int
    skip: int
    limit: int


class RoomsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[RoomsData]


class RoomsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: RoomsUpdateData


class RoomsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[RoomsBatchUpdateItem]


class RoomsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


class WorkerPhaseHandoffRequest(BaseModel):
    """Worker marks a phase complete: visit + per-phase lock (BAS/admin may unlock later)."""
    phase: str
    worker_name: str
    area_id: Optional[str] = None


def _prepare_room_update_dict(existing: Any, update_dict: Dict[str, Any], app_role: str) -> None:
    """Keep room.phase / areas[0] in sync for multi-area rooms (mutates update_dict)."""
    if app_role != ROLE_ADMIN:
        update_dict.pop("areas", None)
        return
    if "areas" in update_dict:
        try:
            update_dict["areas"] = sanitize_areas_payload(update_dict["areas"])
        except ValueError as e:
            raise ValueError(str(e)) from e
        ar = update_dict["areas"]
        if ar and len(ar) > 0:
            if ar[0].get("phase") is not None:
                update_dict["phase"] = ar[0]["phase"]
            o0 = ar[0].get("phase_lock_overrides")
            if isinstance(o0, dict):
                update_dict["phase_lock_overrides"] = o0
        return
    if "phase" in update_dict or "phase_lock_overrides" in update_dict:
        parsed = parse_areas_list(getattr(existing, "areas", None))
        if parsed and len(parsed) > 0:
            new_areas = deepcopy(parsed)
            if "phase" in update_dict:
                new_areas[0]["phase"] = update_dict["phase"]
            if "phase_lock_overrides" in update_dict:
                new_areas[0]["phase_lock_overrides"] = update_dict["phase_lock_overrides"]
            update_dict["areas"] = new_areas


async def _sync_phase_statuses_on_update(
    db: AsyncSession, existing: Any, update_dict: Dict[str, Any]
) -> None:
    """Keep room.phase and phase_statuses consistent with project workflow keys."""
    if "phase_statuses" not in update_dict and "phase" not in update_dict:
        return
    keys_wf = await workflow_keys_for_room(db, existing)
    rp_existing = getattr(existing, "phase", None)
    if "phase_statuses" in update_dict:
        merged = merge_resolve_phase_statuses(
            update_dict["phase_statuses"], rp_existing, keys_wf
        )
        update_dict["phase_statuses"] = merged
        update_dict["phase"] = primary_focus_phase(rp_existing, merged, keys_wf)
    elif "phase" in update_dict:
        ph = normalize_room_phase(update_dict.get("phase"), keys_wf)
        update_dict["phase"] = ph
        update_dict["phase_statuses"] = derive_linear_phase_statuses(ph, keys_wf)


def _merge_bool_phase_lock_overrides(raw: Any) -> Dict[str, bool]:
    out: Dict[str, bool] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(k, str) and isinstance(v, bool):
                out[k.strip()] = v
    return out


async def _phase_display_label(db: AsyncSession, room: Any, phase_key: str) -> str:
    try:
        row = await db.execute(select(Projects).where(Projects.id == room.project_id))
        proj = row.scalar_one_or_none()
        raw = getattr(proj, "phase_workflow_json", None) if proj else None
        if raw and str(raw).strip():
            data = json.loads(raw)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("key") == phase_key:
                        lab = item.get("label")
                        if isinstance(lab, str) and lab.strip():
                            return lab.strip()
    except Exception as e:
        logger.warning("_phase_display_label: %s", e)
    return phase_key


def build_worker_handoff_lock_update(existing_room: Any, phase_key: str, area_id_opt: Optional[str]) -> Dict[str, Any]:
    """Merge phase_lock_overrides[phase_key]=True; sync areas JSON when the room uses areas."""
    areas = parse_areas_list(getattr(existing_room, "areas", None))
    if not areas:
        cur = _merge_bool_phase_lock_overrides(getattr(existing_room, "phase_lock_overrides", None))
        cur[phase_key] = True
        return {"phase_lock_overrides": cur}

    new_areas = deepcopy(areas)
    aid = norm_area_id(area_id_opt)
    idx = 0
    if aid:
        for i, a in enumerate(new_areas):
            if a.get("id") == aid:
                idx = i
                break
    target = new_areas[idx]
    if idx == 0:
        merged_root = _merge_bool_phase_lock_overrides(getattr(existing_room, "phase_lock_overrides", None))
        merged_area = _merge_bool_phase_lock_overrides(target.get("phase_lock_overrides"))
        cur = {**merged_root, **merged_area}
    else:
        cur = _merge_bool_phase_lock_overrides(target.get("phase_lock_overrides"))
    cur[phase_key] = True
    target["phase_lock_overrides"] = cur
    out: Dict[str, Any] = {"areas": new_areas}
    if idx == 0:
        out["phase_lock_overrides"] = cur
    return out


# ---------- Routes ----------
@router.get("", response_model=RoomsListResponse)
async def query_roomss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    owner_uid: Optional[str] = Depends(entity_owner_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Query roomss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying roomss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = RoomsService(db)
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
            user_id=owner_uid,
            worker_project_id=worker_project_scope(current_user),
        )
        logger.debug(f"Found {result['total']} roomss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying roomss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=RoomsListResponse)
async def query_roomss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Global rooms listing — admins only (Bearer required)."""
    logger.debug(f"Querying roomss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = RoomsService(db)
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
        logger.debug(f"Found {result['total']} roomss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying roomss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=RoomsResponse)
async def get_rooms(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Get a single rooms by ID (user can only see their own records)"""
    logger.debug(f"Fetching rooms with id: {id}, fields={fields}")
    
    service = RoomsService(db)
    try:
        owner_uid = None if app_role == ROLE_ADMIN else str(current_user.id)
        result = await service.get_by_id(
            id,
            user_id=owner_uid,
            worker_project_id=worker_project_scope(current_user),
        )
        if not result:
            logger.warning(f"Rooms with id {id} not found")
            raise HTTPException(status_code=404, detail="Rooms not found")

        merged = await maybe_backfill_legacy_visits_photos(db, result, str(current_user.id))
        if merged is not None:
            result = merged

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching rooms {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{id}/worker-phase-handoff", response_model=RoomsResponse)
async def worker_phase_handoff(
    id: int,
    body: WorkerPhaseHandoffRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Worker confirms phase handoff: activity visit + persistent per-phase worker lock."""
    name = (body.worker_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Worker name is required")

    await ensure_room_mutable(db, id, str(current_user.id), app_role, worker_project_scope(current_user))

    service = RoomsService(db)
    room_obj = await service.get_by_id(
        id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not room_obj:
        raise HTTPException(status_code=404, detail="Rooms not found")

    keys = await workflow_keys_for_room(db, room_obj)
    phase_n = normalize_room_phase(body.phase, keys)
    rp_existing = getattr(room_obj, "phase", None)
    merged_statuses = merge_resolve_phase_statuses(
        getattr(room_obj, "phase_statuses", None), rp_existing, keys
    )
    if merged_statuses.get(phase_n) != "in_progress":
        raise HTTPException(
            status_code=400,
            detail="Only the active in-progress phase can be handed off.",
        )

    aid = norm_area_id(body.area_id)
    rn, ov = worker_phase_context_for_area(room_obj, aid, keys)
    ps_raw = getattr(room_obj, "phase_statuses", None)
    if phase_tab_locked_for_worker(rn, phase_n, keys, ov, ps_raw):
        raise HTTPException(status_code=400, detail="This phase is already locked for workers.")

    label = await _phase_display_label(db, room_obj, phase_n)
    visit_svc = Room_visitsService(db)
    visit_data = {
        "room_id": id,
        "worker_name": name,
        "action": f"Phase ready for handoff: {label}",
        "visited_at": datetime.now(timezone.utc),
        "phase": phase_n,
        "area_id": aid,
    }
    visit_row = await visit_svc.create(visit_data, user_id=str(current_user.id))
    if not visit_row:
        raise HTTPException(status_code=400, detail="Failed to record visit")

    lock_part = build_worker_handoff_lock_update(room_obj, phase_n, body.area_id)
    try:
        _prepare_room_update_dict(room_obj, lock_part, ROLE_ADMIN)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    result = await service.update(
        id,
        lock_part,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Rooms not found")

    await append_room_activity(
        db,
        id,
        str(current_user.id),
        kind="phase_handoff",
        actor=name,
        phase_key=phase_n,
        phase_label=label,
        area_id=aid,
        meta={"detail": visit_data["action"]},
        worker_project_id=worker_project_scope(current_user),
    )
    refreshed = await service.get_by_id(
        id,
        user_id=str(current_user.id),
        worker_project_id=worker_project_scope(current_user),
    )
    return refreshed if refreshed else result


@router.post("", response_model=RoomsResponse, status_code=201)
async def create_rooms(
    data: RoomsData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create a new rooms"""
    logger.debug(f"Creating new rooms with data: {data}")
    
    service = RoomsService(db)
    try:
        validate_blocked_reason(data.status, data.blocked_reason)
        dump = data.model_dump()
        if dump.get("areas") is not None:
            try:
                dump["areas"] = sanitize_areas_payload(dump["areas"])
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
        if dump.get("phase_tool_overrides") is not None:
            dump["phase_tool_overrides"] = sanitize_phase_tool_overrides(dump["phase_tool_overrides"])
        result = await service.create(dump, user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create rooms")
        
        logger.info(f"Rooms created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating rooms: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating rooms: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[RoomsResponse], status_code=201)
async def create_roomss_batch(
    request: RoomsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple roomss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} roomss")
    
    service = RoomsService(db)
    results = []
    
    try:
        for item_data in request.items:
            validate_blocked_reason(item_data.status, item_data.blocked_reason)
            dump_b = item_data.model_dump()
            if dump_b.get("areas") is not None:
                try:
                    dump_b["areas"] = sanitize_areas_payload(dump_b["areas"])
                except ValueError as e:
                    await db.rollback()
                    raise HTTPException(status_code=400, detail=str(e)) from e
            if dump_b.get("phase_tool_overrides") is not None:
                dump_b["phase_tool_overrides"] = sanitize_phase_tool_overrides(dump_b["phase_tool_overrides"])
            result = await service.create(dump_b, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} roomss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[RoomsResponse])
async def update_roomss_batch(
    request: RoomsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple roomss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} roomss")
    
    service = RoomsService(db)
    results = []
    
    try:
        for item in request.items:
            validate_blocked_reason(item.updates.status, item.updates.blocked_reason)
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            update_dict.pop("activity_log", None)
            existing_b = await service.get_by_id(
                item.id,
                user_id=str(current_user.id),
                worker_project_id=worker_project_scope(current_user),
            )
            if existing_b:
                _prepare_room_update_dict(existing_b, update_dict, app_role)
                await _sync_phase_statuses_on_update(db, existing_b, update_dict)
            result = await service.update(
                item.id,
                update_dict,
                user_id=str(current_user.id),
                worker_project_id=worker_project_scope(current_user),
            )
            if result:
                if existing_b:
                    await append_room_patch_activity(
                        db,
                        existing_b,
                        update_dict,
                        current_user,
                        str(current_user.id),
                        worker_project_scope(current_user),
                    )
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} roomss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=RoomsResponse)
async def update_rooms(
    id: int,
    data: RoomsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_room_collaborator),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing rooms (requires ownership)"""
    logger.debug(f"Updating rooms {id} with data: {data}")

    service = RoomsService(db)
    try:
        validate_blocked_reason(data.status, data.blocked_reason)
        raw_dump = data.model_dump(exclude_unset=True)
        update_dict: Dict[str, Any] = {}
        for k, v in raw_dump.items():
            if v is not None:
                update_dict[k] = v
            elif k in ("deadline_at", "checklist_labels", "heating_cable_doc", "phase_tool_overrides"):
                update_dict[k] = None
        update_dict.pop("activity_log", None)
        existing = await service.get_by_id(
            id,
            user_id=str(current_user.id),
            worker_project_id=worker_project_scope(current_user),
        )
        if not existing:
            logger.warning(f"Rooms with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Rooms not found")
        if app_role != ROLE_ADMIN:
            update_dict.pop("is_locked", None)
            update_dict.pop("phase_lock_overrides", None)
            update_dict.pop("phase", None)
            update_dict.pop("phase_statuses", None)
            update_dict.pop("areas", None)
            update_dict.pop("deadline_at", None)
            update_dict.pop("checklist_labels", None)
            update_dict.pop("phase_tool_overrides", None)
            if getattr(existing, "is_locked", False):
                raise HTTPException(status_code=403, detail=ROOM_LOCKED_DETAIL)
            await ensure_worker_may_update_room_gated_content(
                db, existing, str(current_user.id), app_role, update_dict
            )
        if "checklist_labels" in update_dict and update_dict["checklist_labels"] is not None:
            update_dict["checklist_labels"] = sanitize_checklist_labels(update_dict["checklist_labels"])
        if "phase_tool_overrides" in update_dict and update_dict["phase_tool_overrides"] is not None:
            update_dict["phase_tool_overrides"] = sanitize_phase_tool_overrides(update_dict["phase_tool_overrides"])
        try:
            _prepare_room_update_dict(existing, update_dict, app_role)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if app_role == ROLE_ADMIN:
            await _sync_phase_statuses_on_update(db, existing, update_dict)
        result = await service.update(
            id,
            update_dict,
            user_id=str(current_user.id),
            worker_project_id=worker_project_scope(current_user),
        )
        if not result:
            logger.warning(f"Rooms with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Rooms not found")

        await append_room_patch_activity(
            db,
            existing,
            update_dict,
            current_user,
            str(current_user.id),
            worker_project_scope(current_user),
        )

        logger.info(f"Rooms {id} updated successfully")
        refreshed = await service.get_by_id(
            id,
            user_id=str(current_user.id),
            worker_project_id=worker_project_scope(current_user),
        )
        return refreshed if refreshed else result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating rooms {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating rooms {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_roomss_batch(
    request: RoomsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple roomss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} roomss")
    
    service = RoomsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(
                item_id,
                user_id=str(current_user.id),
                worker_project_id=worker_project_scope(current_user),
            )
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} roomss successfully")
        return {"message": f"Successfully deleted {deleted_count} roomss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_rooms(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single rooms by ID (requires ownership)"""
    logger.debug(f"Deleting rooms with id: {id}")
    
    service = RoomsService(db)
    try:
        success = await service.delete(
            id,
            user_id=str(current_user.id),
            worker_project_id=worker_project_scope(current_user),
        )
        if not success:
            logger.warning(f"Rooms with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Rooms not found")
        
        logger.info(f"Rooms {id} deleted successfully")
        return {"message": "Rooms deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting rooms {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
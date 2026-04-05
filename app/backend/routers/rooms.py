import json
import logging
from copy import deepcopy
from typing import Any, Dict, List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.rooms import RoomsService
from dependencies.auth import get_current_user
from dependencies.room_lock import ROOM_LOCKED_DETAIL, ensure_room_mutable
from dependencies.roles import (
    ROLE_ADMIN,
    get_current_app_role,
    require_admin_role,
    require_room_collaborator,
)
from schemas.auth import UserResponse
from dependencies.room_areas import parse_areas_list, sanitize_areas_payload

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/rooms", tags=["rooms"])


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


# ---------- Routes ----------
@router.get("", response_model=RoomsListResponse)
async def query_roomss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
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
            user_id=str(current_user.id),
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
    db: AsyncSession = Depends(get_db),
):
    # Query roomss with filtering, sorting, and pagination without user limitation
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
    db: AsyncSession = Depends(get_db),
):
    """Get a single rooms by ID (user can only see their own records)"""
    logger.debug(f"Fetching rooms with id: {id}, fields={fields}")
    
    service = RoomsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Rooms with id {id} not found")
            raise HTTPException(status_code=404, detail="Rooms not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching rooms {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


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
            existing_b = await service.get_by_id(item.id, user_id=str(current_user.id))
            if existing_b:
                _prepare_room_update_dict(existing_b, update_dict, app_role)
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
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
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        existing = await service.get_by_id(id, user_id=str(current_user.id))
        if not existing:
            logger.warning(f"Rooms with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Rooms not found")
        if app_role != ROLE_ADMIN:
            update_dict.pop("is_locked", None)
            update_dict.pop("phase_lock_overrides", None)
            update_dict.pop("phase", None)
            update_dict.pop("areas", None)
            if getattr(existing, "is_locked", False):
                raise HTTPException(status_code=403, detail=ROOM_LOCKED_DETAIL)
        try:
            _prepare_room_update_dict(existing, update_dict, app_role)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Rooms with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Rooms not found")

        logger.info(f"Rooms {id} updated successfully")
        return result
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
            success = await service.delete(item_id, user_id=str(current_user.id))
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
        success = await service.delete(id, user_id=str(current_user.id))
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
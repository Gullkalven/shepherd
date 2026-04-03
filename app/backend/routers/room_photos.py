import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.room_photos import Room_photosService
from dependencies.auth import get_current_user
from dependencies.room_lock import ensure_room_mutable
from dependencies.roles import get_current_app_role
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/room_photos", tags=["room_photos"])


# ---------- Pydantic Schemas ----------
class Room_photosData(BaseModel):
    """Entity data schema (for create/update)"""
    room_id: int
    object_key: str
    filename: str = None
    caption: str = None
    created_at: Optional[datetime] = None


class Room_photosUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    room_id: Optional[int] = None
    object_key: Optional[str] = None
    filename: Optional[str] = None
    caption: Optional[str] = None
    created_at: Optional[datetime] = None


class Room_photosResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    room_id: int
    object_key: str
    filename: Optional[str] = None
    caption: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Room_photosListResponse(BaseModel):
    """List response schema"""
    items: List[Room_photosResponse]
    total: int
    skip: int
    limit: int


class Room_photosBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Room_photosData]


class Room_photosBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Room_photosUpdateData


class Room_photosBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Room_photosBatchUpdateItem]


class Room_photosBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Room_photosListResponse)
async def query_room_photoss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query room_photoss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying room_photoss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Room_photosService(db)
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
        logger.debug(f"Found {result['total']} room_photoss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying room_photoss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Room_photosListResponse)
async def query_room_photoss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query room_photoss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying room_photoss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Room_photosService(db)
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
        logger.debug(f"Found {result['total']} room_photoss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying room_photoss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Room_photosResponse)
async def get_room_photos(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single room_photos by ID (user can only see their own records)"""
    logger.debug(f"Fetching room_photos with id: {id}, fields={fields}")
    
    service = Room_photosService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Room_photos with id {id} not found")
            raise HTTPException(status_code=404, detail="Room_photos not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching room_photos {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Room_photosResponse, status_code=201)
async def create_room_photos(
    data: Room_photosData,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Create a new room_photos"""
    logger.debug(f"Creating new room_photos with data: {data}")
    
    service = Room_photosService(db)
    try:
        await ensure_room_mutable(db, data.room_id, str(current_user.id), app_role)
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create room_photos")
        
        logger.info(f"Room_photos created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating room_photos: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating room_photos: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Room_photosResponse], status_code=201)
async def create_room_photoss_batch(
    request: Room_photosBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple room_photoss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} room_photoss")
    
    service = Room_photosService(db)
    results = []
    
    try:
        for item_data in request.items:
            await ensure_room_mutable(db, item_data.room_id, str(current_user.id), app_role)
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} room_photoss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Room_photosResponse])
async def update_room_photoss_batch(
    request: Room_photosBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple room_photoss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} room_photoss")
    
    service = Room_photosService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            row = await service.get_by_id(item.id, user_id=str(current_user.id))
            if not row:
                continue
            await ensure_room_mutable(db, row.room_id, str(current_user.id), app_role)
            new_rid = update_dict.get("room_id")
            if new_rid is not None and new_rid != row.room_id:
                await ensure_room_mutable(db, new_rid, str(current_user.id), app_role)
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} room_photoss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Room_photosResponse)
async def update_room_photos(
    id: int,
    data: Room_photosUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing room_photos (requires ownership)"""
    logger.debug(f"Updating room_photos {id} with data: {data}")

    service = Room_photosService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        row = await service.get_by_id(id, user_id=str(current_user.id))
        if not row:
            logger.warning(f"Room_photos with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Room_photos not found")
        await ensure_room_mutable(db, row.room_id, str(current_user.id), app_role)
        new_rid = update_dict.get("room_id")
        if new_rid is not None and new_rid != row.room_id:
            await ensure_room_mutable(db, new_rid, str(current_user.id), app_role)
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Room_photos with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Room_photos not found")

        logger.info(f"Room_photos {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating room_photos {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating room_photos {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_room_photoss_batch(
    request: Room_photosBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple room_photoss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} room_photoss")
    
    service = Room_photosService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            row = await service.get_by_id(item_id, user_id=str(current_user.id))
            if not row:
                continue
            await ensure_room_mutable(db, row.room_id, str(current_user.id), app_role)
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} room_photoss successfully")
        return {"message": f"Successfully deleted {deleted_count} room_photoss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_room_photos(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single room_photos by ID (requires ownership)"""
    logger.debug(f"Deleting room_photos with id: {id}")
    
    service = Room_photosService(db)
    try:
        row = await service.get_by_id(id, user_id=str(current_user.id))
        if not row:
            logger.warning(f"Room_photos with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Room_photos not found")
        await ensure_room_mutable(db, row.room_id, str(current_user.id), app_role)
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Room_photos with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Room_photos not found")
        
        logger.info(f"Room_photos {id} deleted successfully")
        return {"message": "Room_photos deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting room_photos {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
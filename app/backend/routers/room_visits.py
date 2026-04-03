import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.room_visits import Room_visitsService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/room_visits", tags=["room_visits"])


# ---------- Pydantic Schemas ----------
class Room_visitsData(BaseModel):
    """Entity data schema (for create/update)"""
    room_id: int
    worker_name: str
    action: str = None
    visited_at: datetime


class Room_visitsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    room_id: Optional[int] = None
    worker_name: Optional[str] = None
    action: Optional[str] = None
    visited_at: Optional[datetime] = None


class Room_visitsResponse(BaseModel):
    """Entity response schema"""
    id: int
    room_id: int
    worker_name: str
    action: Optional[str] = None
    visited_at: datetime
    user_id: str

    class Config:
        from_attributes = True


class Room_visitsListResponse(BaseModel):
    """List response schema"""
    items: List[Room_visitsResponse]
    total: int
    skip: int
    limit: int


class Room_visitsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Room_visitsData]


class Room_visitsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Room_visitsUpdateData


class Room_visitsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Room_visitsBatchUpdateItem]


class Room_visitsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Room_visitsListResponse)
async def query_room_visitss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query room_visitss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying room_visitss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Room_visitsService(db)
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
        logger.debug(f"Found {result['total']} room_visitss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying room_visitss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Room_visitsListResponse)
async def query_room_visitss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query room_visitss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying room_visitss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Room_visitsService(db)
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
        logger.debug(f"Found {result['total']} room_visitss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying room_visitss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Room_visitsResponse)
async def get_room_visits(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single room_visits by ID (user can only see their own records)"""
    logger.debug(f"Fetching room_visits with id: {id}, fields={fields}")
    
    service = Room_visitsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Room_visits with id {id} not found")
            raise HTTPException(status_code=404, detail="Room_visits not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching room_visits {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Room_visitsResponse, status_code=201)
async def create_room_visits(
    data: Room_visitsData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new room_visits"""
    logger.debug(f"Creating new room_visits with data: {data}")
    
    service = Room_visitsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create room_visits")
        
        logger.info(f"Room_visits created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating room_visits: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating room_visits: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Room_visitsResponse], status_code=201)
async def create_room_visitss_batch(
    request: Room_visitsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple room_visitss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} room_visitss")
    
    service = Room_visitsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} room_visitss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Room_visitsResponse])
async def update_room_visitss_batch(
    request: Room_visitsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple room_visitss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} room_visitss")
    
    service = Room_visitsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} room_visitss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Room_visitsResponse)
async def update_room_visits(
    id: int,
    data: Room_visitsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing room_visits (requires ownership)"""
    logger.debug(f"Updating room_visits {id} with data: {data}")

    service = Room_visitsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Room_visits with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Room_visits not found")
        
        logger.info(f"Room_visits {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating room_visits {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating room_visits {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_room_visitss_batch(
    request: Room_visitsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple room_visitss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} room_visitss")
    
    service = Room_visitsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} room_visitss successfully")
        return {"message": f"Successfully deleted {deleted_count} room_visitss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_room_visits(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single room_visits by ID (requires ownership)"""
    logger.debug(f"Deleting room_visits with id: {id}")
    
    service = Room_visitsService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Room_visits with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Room_visits not found")
        
        logger.info(f"Room_visits {id} deleted successfully")
        return {"message": "Room_visits deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting room_visits {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
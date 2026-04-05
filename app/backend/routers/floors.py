import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.floors import FloorsService
from dependencies.auth import get_current_user
from dependencies.roles import require_admin_role
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/floors", tags=["floors"])


# ---------- Pydantic Schemas ----------
class FloorsData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    floor_number: int
    name: str = None
    created_at: Optional[datetime] = None


class FloorsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    floor_number: Optional[int] = None
    name: Optional[str] = None
    created_at: Optional[datetime] = None


class FloorsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    project_id: int
    floor_number: int
    name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FloorsListResponse(BaseModel):
    """List response schema"""
    items: List[FloorsResponse]
    total: int
    skip: int
    limit: int


class FloorsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[FloorsData]


class FloorsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: FloorsUpdateData


class FloorsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[FloorsBatchUpdateItem]


class FloorsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=FloorsListResponse)
async def query_floorss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query floorss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying floorss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = FloorsService(db)
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
        logger.debug(f"Found {result['total']} floorss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying floorss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=FloorsListResponse)
async def query_floorss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query floorss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying floorss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = FloorsService(db)
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
        logger.debug(f"Found {result['total']} floorss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying floorss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=FloorsResponse)
async def get_floors(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single floors by ID (user can only see their own records)"""
    logger.debug(f"Fetching floors with id: {id}, fields={fields}")
    
    service = FloorsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Floors with id {id} not found")
            raise HTTPException(status_code=404, detail="Floors not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching floors {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=FloorsResponse, status_code=201)
async def create_floors(
    data: FloorsData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create a new floors"""
    logger.debug(f"Creating new floors with data: {data}")
    
    service = FloorsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create floors")
        
        logger.info(f"Floors created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating floors: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating floors: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[FloorsResponse], status_code=201)
async def create_floorss_batch(
    request: FloorsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple floorss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} floorss")
    
    service = FloorsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} floorss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[FloorsResponse])
async def update_floorss_batch(
    request: FloorsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple floorss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} floorss")
    
    service = FloorsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} floorss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=FloorsResponse)
async def update_floors(
    id: int,
    data: FloorsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing floors (requires ownership)"""
    logger.debug(f"Updating floors {id} with data: {data}")

    service = FloorsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Floors with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Floors not found")
        
        logger.info(f"Floors {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating floors {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating floors {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_floorss_batch(
    request: FloorsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple floorss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} floorss")
    
    service = FloorsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} floorss successfully")
        return {"message": f"Successfully deleted {deleted_count} floorss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_floors(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single floors by ID (requires ownership)"""
    logger.debug(f"Deleting floors with id: {id}")
    
    service = FloorsService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Floors with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Floors not found")
        
        logger.info(f"Floors {id} deleted successfully")
        return {"message": "Floors deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting floors {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.projects import ProjectsService
from dependencies.auth import get_current_user
from dependencies.entity_scope import entity_owner_user_id
from dependencies.roles import ROLE_ADMIN, get_current_app_role, require_admin_role
from dependencies.worker_scope import worker_project_scope
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/projects", tags=["projects"])


# ---------- Pydantic Schemas ----------
class ProjectsData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    description: str = None
    created_at: Optional[datetime] = None


class ProjectsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None


class ProjectsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProjectsListResponse(BaseModel):
    """List response schema"""
    items: List[ProjectsResponse]
    total: int
    skip: int
    limit: int


class ProjectsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ProjectsData]


class ProjectsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ProjectsUpdateData


class ProjectsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ProjectsBatchUpdateItem]


class ProjectsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ProjectsListResponse)
async def query_projectss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    owner_uid: Optional[str] = Depends(entity_owner_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Query projectss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying projectss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ProjectsService(db)
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
        logger.debug(f"Found {result['total']} projectss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying projectss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ProjectsListResponse)
async def query_projectss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """List projects across all owners — admins only (Bearer required)."""
    logger.debug(f"Querying projectss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ProjectsService(db)
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
        logger.debug(f"Found {result['total']} projectss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying projectss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ProjectsResponse)
async def get_projects(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    app_role: str = Depends(get_current_app_role),
    db: AsyncSession = Depends(get_db),
):
    """Get a single projects by ID (user can only see their own records)"""
    logger.debug(f"Fetching projects with id: {id}, fields={fields}")
    
    service = ProjectsService(db)
    try:
        owner_uid = None if app_role == ROLE_ADMIN else str(current_user.id)
        worker_scope = worker_project_scope(current_user)
        result = await service.get_by_id(
            id,
            user_id=owner_uid,
            worker_project_id=worker_scope,
        )
        if not result:
            logger.warning(
                "GET /entities/projects/%s -> 404. app_role=%s owner_uid=%s worker_project_scope=%s user_type=%s",
                id,
                app_role,
                owner_uid,
                worker_scope,
                "worker_session"
                if getattr(current_user, "is_worker_session", False)
                else ("provisional_admin" if getattr(current_user, "is_provisional_admin", False) else "standard"),
            )
            raise HTTPException(status_code=404, detail="Projects not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching projects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ProjectsResponse, status_code=201)
async def create_projects(
    data: ProjectsData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create a new projects"""
    logger.debug(f"Creating new projects with data: {data}")
    
    service = ProjectsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create projects")
        
        logger.info(f"Projects created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating projects: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating projects: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ProjectsResponse], status_code=201)
async def create_projectss_batch(
    request: ProjectsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple projectss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} projectss")
    
    service = ProjectsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} projectss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ProjectsResponse])
async def update_projectss_batch(
    request: ProjectsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple projectss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} projectss")
    
    service = ProjectsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=None)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} projectss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ProjectsResponse)
async def update_projects(
    id: int,
    data: ProjectsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing projects (requires ownership)"""
    logger.debug(f"Updating projects {id} with data: {data}")

    service = ProjectsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=None)
        if not result:
            logger.warning(f"Projects with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Projects not found")
        
        logger.info(f"Projects {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating projects {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating projects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_projectss_batch(
    request: ProjectsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple projectss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} projectss")
    
    service = ProjectsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=None)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} projectss successfully")
        return {"message": f"Successfully deleted {deleted_count} projectss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_projects(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    _role: str = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single projects by ID (requires ownership)"""
    logger.debug(f"Deleting projects with id: {id}")
    
    service = ProjectsService(db)
    try:
        success = await service.delete(id, user_id=None)
        if not success:
            logger.warning(f"Projects with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Projects not found")
        
        logger.info(f"Projects {id} deleted successfully")
        return {"message": "Projects deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting projects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from routers.checklist_templates import require_manager_or_admin
from schemas.auth import UserResponse
from services.checklist_template_items import ChecklistTemplateItemsService

router = APIRouter(prefix="/api/v1/entities/checklist_template_items", tags=["checklist_template_items"])


class ChecklistTemplateItemsData(BaseModel):
    template_id: int
    name: str
    sort_order: Optional[int] = None


class ChecklistTemplateItemsUpdateData(BaseModel):
    template_id: Optional[int] = None
    name: Optional[str] = None
    sort_order: Optional[int] = None


class ChecklistTemplateItemsResponse(BaseModel):
    id: int
    user_id: str
    template_id: int
    name: str
    sort_order: Optional[int] = None

    class Config:
        from_attributes = True


class ChecklistTemplateItemsListResponse(BaseModel):
    items: List[ChecklistTemplateItemsResponse]
    total: int
    skip: int
    limit: int


@router.get("", response_model=ChecklistTemplateItemsListResponse)
async def query_checklist_template_items(
    query: str = Query(None),
    sort: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplateItemsService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(
        skip=skip,
        limit=limit,
        query_dict=query_dict,
        sort=sort,
        user_id=str(current_user.id),
    )


@router.post("", response_model=ChecklistTemplateItemsResponse, status_code=201)
async def create_checklist_template_item(
    data: ChecklistTemplateItemsData,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplateItemsService(db)
    result = await service.create(data.model_dump(), user_id=str(manager.id))
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create checklist template item")
    return result


@router.put("/{id}", response_model=ChecklistTemplateItemsResponse)
async def update_checklist_template_item(
    id: int,
    data: ChecklistTemplateItemsUpdateData,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplateItemsService(db)
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    result = await service.update(id, update_dict, user_id=str(manager.id))
    if not result:
        raise HTTPException(status_code=404, detail="Checklist template item not found")
    return result


@router.delete("/{id}")
async def delete_checklist_template_item(
    id: int,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplateItemsService(db)
    success = await service.delete(id, user_id=str(manager.id))
    if not success:
        raise HTTPException(status_code=404, detail="Checklist template item not found")
    return {"message": "Checklist template item deleted", "id": id}


@router.delete("/by-template/{template_id}")
async def delete_checklist_template_items_by_template(
    template_id: int,
    manager: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    service = ChecklistTemplateItemsService(db)
    deleted_count = await service.delete_by_template(template_id, user_id=str(manager.id))
    return {"message": "Checklist template items deleted", "deleted_count": deleted_count}

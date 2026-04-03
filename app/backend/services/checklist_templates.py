import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.checklist_templates import Checklist_templates

logger = logging.getLogger(__name__)


class ChecklistTemplatesService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Checklist_templates]:
        try:
            if user_id:
                data["user_id"] = user_id
            obj = Checklist_templates(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            return obj
        except Exception:
            await self.db.rollback()
            raise

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[Checklist_templates]:
        query = select(Checklist_templates).where(Checklist_templates.id == obj_id)
        if user_id:
            query = query.where(Checklist_templates.user_id == user_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_list(
        self,
        skip: int = 0,
        limit: int = 20,
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        query = select(Checklist_templates)
        count_query = select(func.count(Checklist_templates.id))

        if user_id:
            query = query.where(Checklist_templates.user_id == user_id)
            count_query = count_query.where(Checklist_templates.user_id == user_id)

        if query_dict:
            for field, value in query_dict.items():
                if hasattr(Checklist_templates, field):
                    query = query.where(getattr(Checklist_templates, field) == value)
                    count_query = count_query.where(getattr(Checklist_templates, field) == value)

        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        if sort:
            if sort.startswith("-"):
                field_name = sort[1:]
                if hasattr(Checklist_templates, field_name):
                    query = query.order_by(getattr(Checklist_templates, field_name).desc())
            elif hasattr(Checklist_templates, sort):
                query = query.order_by(getattr(Checklist_templates, sort))
        else:
            query = query.order_by(Checklist_templates.id.desc())

        result = await self.db.execute(query.offset(skip).limit(limit))
        items = result.scalars().all()
        return {"items": items, "total": total, "skip": skip, "limit": limit}

    async def update(
        self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None
    ) -> Optional[Checklist_templates]:
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                return None
            for key, value in update_data.items():
                if hasattr(obj, key) and key != "user_id":
                    setattr(obj, key, value)
            await self.db.commit()
            await self.db.refresh(obj)
            return obj
        except Exception:
            await self.db.rollback()
            raise

    async def delete(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                return False
            await self.db.delete(obj)
            await self.db.commit()
            return True
        except Exception:
            await self.db.rollback()
            raise

    async def list_by_field(self, field_name: str, field_value: Any) -> List[Checklist_templates]:
        if not hasattr(Checklist_templates, field_name):
            raise ValueError(f"Field {field_name} does not exist on Checklist_templates")
        result = await self.db.execute(
            select(Checklist_templates).where(getattr(Checklist_templates, field_name) == field_value)
        )
        return result.scalars().all()

from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.checklist_template_items import Checklist_template_items


class ChecklistTemplateItemsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Checklist_template_items]:
        try:
            if user_id:
                data["user_id"] = user_id
            obj = Checklist_template_items(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            return obj
        except Exception:
            await self.db.rollback()
            raise

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[Checklist_template_items]:
        query = select(Checklist_template_items).where(Checklist_template_items.id == obj_id)
        if user_id:
            query = query.where(Checklist_template_items.user_id == user_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_list(
        self,
        skip: int = 0,
        limit: int = 200,
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        query = select(Checklist_template_items)
        count_query = select(func.count(Checklist_template_items.id))

        if user_id:
            query = query.where(Checklist_template_items.user_id == user_id)
            count_query = count_query.where(Checklist_template_items.user_id == user_id)

        if query_dict:
            for field, value in query_dict.items():
                if hasattr(Checklist_template_items, field):
                    query = query.where(getattr(Checklist_template_items, field) == value)
                    count_query = count_query.where(getattr(Checklist_template_items, field) == value)

        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        if sort:
            if sort.startswith("-"):
                field_name = sort[1:]
                if hasattr(Checklist_template_items, field_name):
                    query = query.order_by(getattr(Checklist_template_items, field_name).desc())
            elif hasattr(Checklist_template_items, sort):
                query = query.order_by(getattr(Checklist_template_items, sort))
        else:
            query = query.order_by(Checklist_template_items.sort_order, Checklist_template_items.id)

        result = await self.db.execute(query.offset(skip).limit(limit))
        items = result.scalars().all()
        return {"items": items, "total": total, "skip": skip, "limit": limit}

    async def update(
        self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None
    ) -> Optional[Checklist_template_items]:
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

    async def delete_by_template(self, template_id: int, user_id: Optional[str] = None) -> int:
        query = select(Checklist_template_items).where(Checklist_template_items.template_id == template_id)
        if user_id:
            query = query.where(Checklist_template_items.user_id == user_id)
        result = await self.db.execute(query)
        items = result.scalars().all()
        for item in items:
            await self.db.delete(item)
        await self.db.commit()
        return len(items)

    async def list_by_field(self, field_name: str, field_value: Any) -> List[Checklist_template_items]:
        if not hasattr(Checklist_template_items, field_name):
            raise ValueError(f"Field {field_name} does not exist on Checklist_template_items")
        result = await self.db.execute(
            select(Checklist_template_items).where(getattr(Checklist_template_items, field_name) == field_value)
        )
        return result.scalars().all()

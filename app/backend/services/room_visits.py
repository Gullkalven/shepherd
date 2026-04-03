import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.room_visits import Room_visits

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Room_visitsService:
    """Service layer for Room_visits operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Room_visits]:
        """Create a new room_visits"""
        try:
            if user_id:
                data['user_id'] = user_id
            obj = Room_visits(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created room_visits with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating room_visits: {str(e)}")
            raise

    async def check_ownership(self, obj_id: int, user_id: str) -> bool:
        """Check if user owns this record"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            return obj is not None
        except Exception as e:
            logger.error(f"Error checking ownership for room_visits {obj_id}: {str(e)}")
            return False

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[Room_visits]:
        """Get room_visits by ID (user can only see their own records)"""
        try:
            query = select(Room_visits).where(Room_visits.id == obj_id)
            if user_id:
                query = query.where(Room_visits.user_id == user_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching room_visits {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of room_visitss (user can only see their own records)"""
        try:
            query = select(Room_visits)
            count_query = select(func.count(Room_visits.id))
            
            if user_id:
                query = query.where(Room_visits.user_id == user_id)
                count_query = count_query.where(Room_visits.user_id == user_id)
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Room_visits, field):
                        query = query.where(getattr(Room_visits, field) == value)
                        count_query = count_query.where(getattr(Room_visits, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Room_visits, field_name):
                        query = query.order_by(getattr(Room_visits, field_name).desc())
                else:
                    if hasattr(Room_visits, sort):
                        query = query.order_by(getattr(Room_visits, sort))
            else:
                query = query.order_by(Room_visits.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching room_visits list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Room_visits]:
        """Update room_visits (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"Room_visits {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key) and key != 'user_id':
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated room_visits {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating room_visits {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        """Delete room_visits (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"Room_visits {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted room_visits {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting room_visits {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Room_visits]:
        """Get room_visits by any field"""
        try:
            if not hasattr(Room_visits, field_name):
                raise ValueError(f"Field {field_name} does not exist on Room_visits")
            result = await self.db.execute(
                select(Room_visits).where(getattr(Room_visits, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching room_visits by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Room_visits]:
        """Get list of room_visitss filtered by field"""
        try:
            if not hasattr(Room_visits, field_name):
                raise ValueError(f"Field {field_name} does not exist on Room_visits")
            result = await self.db.execute(
                select(Room_visits)
                .where(getattr(Room_visits, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Room_visits.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching room_visitss by {field_name}: {str(e)}")
            raise
import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.rooms import Rooms
from models.room_photos import Room_photos
from models.room_visits import Room_visits
from models.tasks import Tasks

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class RoomsService:
    """Service layer for Rooms operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Rooms]:
        """Create a new rooms"""
        try:
            if user_id:
                data['user_id'] = user_id
            obj = Rooms(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created rooms with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating rooms: {str(e)}")
            raise

    async def check_ownership(self, obj_id: int, user_id: str) -> bool:
        """Check if user owns this record"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            return obj is not None
        except Exception as e:
            logger.error(f"Error checking ownership for rooms {obj_id}: {str(e)}")
            return False

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[Rooms]:
        """Get rooms by ID (user can only see their own records)"""
        try:
            query = select(Rooms).where(Rooms.id == obj_id)
            if user_id:
                query = query.where(Rooms.user_id == user_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching rooms {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of roomss (user can only see their own records)"""
        try:
            query = select(Rooms)
            count_query = select(func.count(Rooms.id))
            
            if user_id:
                query = query.where(Rooms.user_id == user_id)
                count_query = count_query.where(Rooms.user_id == user_id)
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Rooms, field):
                        query = query.where(getattr(Rooms, field) == value)
                        count_query = count_query.where(getattr(Rooms, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Rooms, field_name):
                        query = query.order_by(getattr(Rooms, field_name).desc())
                else:
                    if hasattr(Rooms, sort):
                        query = query.order_by(getattr(Rooms, sort))
            else:
                query = query.order_by(Rooms.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching rooms list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Rooms]:
        """Update rooms (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"Rooms {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key) and key != 'user_id':
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated rooms {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating rooms {obj_id}: {str(e)}")
            raise

    async def delete_room_and_dependents_no_commit(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        """Delete room row plus tasks, photos, visits in the current session (no commit)."""
        obj = await self.get_by_id(obj_id, user_id=user_id)
        if not obj:
            logger.warning(f"Rooms {obj_id} not found for deletion")
            return False
        tasks_query = select(Tasks).where(Tasks.room_id == obj_id)
        if user_id:
            tasks_query = tasks_query.where(Tasks.user_id == user_id)
        tasks_result = await self.db.execute(tasks_query)
        for task in tasks_result.scalars().all():
            await self.db.delete(task)

        photos_query = select(Room_photos).where(Room_photos.room_id == obj_id)
        if user_id:
            photos_query = photos_query.where(Room_photos.user_id == user_id)
        photos_result = await self.db.execute(photos_query)
        for photo in photos_result.scalars().all():
            await self.db.delete(photo)

        visits_query = select(Room_visits).where(Room_visits.room_id == obj_id)
        if user_id:
            visits_query = visits_query.where(Room_visits.user_id == user_id)
        visits_result = await self.db.execute(visits_query)
        for visit in visits_result.scalars().all():
            await self.db.delete(visit)

        await self.db.delete(obj)
        return True

    async def delete(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        """Delete rooms (requires ownership)"""
        try:
            if not await self.delete_room_and_dependents_no_commit(obj_id, user_id):
                return False
            await self.db.commit()
            logger.info(f"Deleted rooms {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting rooms {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Rooms]:
        """Get rooms by any field"""
        try:
            if not hasattr(Rooms, field_name):
                raise ValueError(f"Field {field_name} does not exist on Rooms")
            result = await self.db.execute(
                select(Rooms).where(getattr(Rooms, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching rooms by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Rooms]:
        """Get list of roomss filtered by field"""
        try:
            if not hasattr(Rooms, field_name):
                raise ValueError(f"Field {field_name} does not exist on Rooms")
            result = await self.db.execute(
                select(Rooms)
                .where(getattr(Rooms, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Rooms.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching roomss by {field_name}: {str(e)}")
            raise
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.floors import Floors
from models.projects import Projects
from models.rooms import Rooms
from services.rooms import RoomsService

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class ProjectsService:
    """Service layer for Projects operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Projects]:
        """Create a new projects"""
        try:
            if user_id:
                data['user_id'] = user_id
            # Ensure created_at is set so sorting/pagination behaves as expected
            if not data.get("created_at"):
                data["created_at"] = datetime.now(timezone.utc)
            obj = Projects(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created projects with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating projects: {str(e)}")
            raise

    async def check_ownership(self, obj_id: int, user_id: str) -> bool:
        """Check if user owns this record"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            return obj is not None
        except Exception as e:
            logger.error(f"Error checking ownership for projects {obj_id}: {str(e)}")
            return False

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[Projects]:
        """Get projects by ID (user can only see their own records)"""
        try:
            query = select(Projects).where(Projects.id == obj_id)
            if user_id:
                query = query.where(Projects.user_id == user_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching projects {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of projectss (user can only see their own records)"""
        try:
            query = select(Projects)
            count_query = select(func.count(Projects.id))
            
            if user_id:
                query = query.where(Projects.user_id == user_id)
                count_query = count_query.where(Projects.user_id == user_id)
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Projects, field):
                        query = query.where(getattr(Projects, field) == value)
                        count_query = count_query.where(getattr(Projects, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Projects, field_name):
                        query = query.order_by(getattr(Projects, field_name).desc())
                else:
                    if hasattr(Projects, sort):
                        query = query.order_by(getattr(Projects, sort))
            else:
                query = query.order_by(Projects.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching projects list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[Projects]:
        """Update projects (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"Projects {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key) and key != 'user_id':
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated projects {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating projects {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        """Delete project and all related floors, rooms, tasks, photos, and visits (same user).

        SQLite can reuse IDs after a row is deleted; orphaned floors/rooms would then appear
        under a new project that got the same numeric id, so we must cascade-delete children.
        """
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"Projects {obj_id} not found for deletion")
                return False

            rooms_service = RoomsService(self.db)
            rooms_query = select(Rooms).where(Rooms.project_id == obj_id)
            if user_id:
                rooms_query = rooms_query.where(Rooms.user_id == user_id)
            rooms_result = await self.db.execute(rooms_query)
            for room in rooms_result.scalars().all():
                await rooms_service.delete_room_and_dependents_no_commit(room.id, user_id)

            floors_query = select(Floors).where(Floors.project_id == obj_id)
            if user_id:
                floors_query = floors_query.where(Floors.user_id == user_id)
            floors_result = await self.db.execute(floors_query)
            for floor in floors_result.scalars().all():
                await self.db.delete(floor)

            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted projects {obj_id} with related floors and rooms")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting projects {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Projects]:
        """Get projects by any field"""
        try:
            if not hasattr(Projects, field_name):
                raise ValueError(f"Field {field_name} does not exist on Projects")
            result = await self.db.execute(
                select(Projects).where(getattr(Projects, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching projects by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Projects]:
        """Get list of projectss filtered by field"""
        try:
            if not hasattr(Projects, field_name):
                raise ValueError(f"Field {field_name} does not exist on Projects")
            result = await self.db.execute(
                select(Projects)
                .where(getattr(Projects, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Projects.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching projectss by {field_name}: {str(e)}")
            raise
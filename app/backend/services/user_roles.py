import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.user_roles import User_roles

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class User_rolesService:
    """Service layer for User_roles operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[User_roles]:
        """Create a new user_roles"""
        try:
            if user_id:
                data['user_id'] = user_id
            obj = User_roles(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created user_roles with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating user_roles: {str(e)}")
            raise

    async def check_ownership(self, obj_id: int, user_id: str) -> bool:
        """Check if user owns this record"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            return obj is not None
        except Exception as e:
            logger.error(f"Error checking ownership for user_roles {obj_id}: {str(e)}")
            return False

    async def get_by_id(self, obj_id: int, user_id: Optional[str] = None) -> Optional[User_roles]:
        """Get user_roles by ID (user can only see their own records)"""
        try:
            query = select(User_roles).where(User_roles.id == obj_id)
            if user_id:
                query = query.where(User_roles.user_id == user_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching user_roles {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        user_id: Optional[str] = None,
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of user_roless (user can only see their own records)"""
        try:
            query = select(User_roles)
            count_query = select(func.count(User_roles.id))
            
            if user_id:
                query = query.where(User_roles.user_id == user_id)
                count_query = count_query.where(User_roles.user_id == user_id)
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(User_roles, field):
                        query = query.where(getattr(User_roles, field) == value)
                        count_query = count_query.where(getattr(User_roles, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(User_roles, field_name):
                        query = query.order_by(getattr(User_roles, field_name).desc())
                else:
                    if hasattr(User_roles, sort):
                        query = query.order_by(getattr(User_roles, sort))
            else:
                query = query.order_by(User_roles.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching user_roles list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any], user_id: Optional[str] = None) -> Optional[User_roles]:
        """Update user_roles (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"User_roles {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key) and key != 'user_id':
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated user_roles {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating user_roles {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int, user_id: Optional[str] = None) -> bool:
        """Delete user_roles (requires ownership)"""
        try:
            obj = await self.get_by_id(obj_id, user_id=user_id)
            if not obj:
                logger.warning(f"User_roles {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted user_roles {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting user_roles {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[User_roles]:
        """Get user_roles by any field"""
        try:
            if not hasattr(User_roles, field_name):
                raise ValueError(f"Field {field_name} does not exist on User_roles")
            result = await self.db.execute(
                select(User_roles).where(getattr(User_roles, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching user_roles by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[User_roles]:
        """Get list of user_roless filtered by field"""
        try:
            if not hasattr(User_roles, field_name):
                raise ValueError(f"Field {field_name} does not exist on User_roles")
            result = await self.db.execute(
                select(User_roles)
                .where(getattr(User_roles, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(User_roles.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching user_roless by {field_name}: {str(e)}")
            raise
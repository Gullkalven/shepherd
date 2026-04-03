from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class User_roles(Base):
    __tablename__ = "user_roles"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    app_role = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)
from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Floors(Base):
    __tablename__ = "floors"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    project_id = Column(Integer, nullable=False)
    floor_number = Column(Integer, nullable=False)
    name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
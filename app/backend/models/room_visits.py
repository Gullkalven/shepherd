from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Room_visits(Base):
    __tablename__ = "room_visits"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    room_id = Column(Integer, nullable=False)
    area_id = Column(String, nullable=True)
    worker_name = Column(String, nullable=False)
    action = Column(String, nullable=True)
    visited_at = Column(DateTime(timezone=True), nullable=False)
    user_id = Column(String, nullable=False)
    phase = Column(String, nullable=True)
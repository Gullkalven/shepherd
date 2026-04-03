from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Rooms(Base):
    __tablename__ = "rooms"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    floor_id = Column(Integer, nullable=False)
    project_id = Column(Integer, nullable=False)
    room_number = Column(String, nullable=False)
    status = Column(String, nullable=True)
    phase = Column(String, nullable=True)
    assigned_worker = Column(String, nullable=True)
    comment = Column(String, nullable=True)
    blocked_reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)
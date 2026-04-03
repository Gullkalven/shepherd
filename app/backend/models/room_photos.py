from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Room_photos(Base):
    __tablename__ = "room_photos"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    room_id = Column(Integer, nullable=False)
    object_key = Column(String, nullable=False)
    filename = Column(String, nullable=True)
    caption = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    phase = Column(String, nullable=True)
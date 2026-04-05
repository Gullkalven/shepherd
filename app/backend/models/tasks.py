from core.database import Base
from sqlalchemy import Boolean, Column, Integer, String


class Tasks(Base):
    __tablename__ = "tasks"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    room_id = Column(Integer, nullable=False)
    area_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    is_completed = Column(Boolean, nullable=True)
    sort_order = Column(Integer, nullable=True)
    checked_by = Column(String, nullable=True)
    checked_at = Column(String, nullable=True)
    user_id = Column(String, nullable=False)
    template_id = Column(Integer, nullable=True)
    template_item_id = Column(Integer, nullable=True)
    is_template_managed = Column(Boolean, nullable=True)
    is_overridden = Column(Boolean, nullable=True)
    phase = Column(String, nullable=True)
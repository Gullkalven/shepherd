from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Checklist_templates(Base):
    __tablename__ = "checklist_templates"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)

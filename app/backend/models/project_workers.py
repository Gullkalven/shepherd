from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func


class Project_workers(Base):
    """Project-scoped field worker identified by display name + PIN (provisional auth)."""

    __tablename__ = "project_workers"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id = Column(Integer, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    pin_hash = Column(String(512), nullable=False)
    role = Column(String(32), nullable=False, default="worker")
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

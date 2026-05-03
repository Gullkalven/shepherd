"""Single-row settings for provisional admin PIN (replace with proper auth later)."""

from sqlalchemy import Column, DateTime, Integer, String

from core.database import Base


class Provisional_admin_settings(Base):
    __tablename__ = "provisional_admin_settings"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, default=1)
    pin_hash = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)

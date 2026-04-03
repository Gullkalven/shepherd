from core.database import Base
from sqlalchemy import Boolean, Column, Integer, String


class Section_settings(Base):
    __tablename__ = "section_settings"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    role_name = Column(String, nullable=False)
    section_key = Column(String, nullable=False)
    is_visible = Column(Boolean, nullable=False)
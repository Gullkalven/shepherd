from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text


class Projects(Base):
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    # JSON array: [{"key": "demontering", "label": "Demontering"}, ...]; null = use app default
    phase_workflow_json = Column(Text, nullable=True)
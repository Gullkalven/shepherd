from core.database import Base
from sqlalchemy import Column, Integer, String


class Checklist_template_items(Base):
    __tablename__ = "checklist_template_items"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    template_id = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=True)

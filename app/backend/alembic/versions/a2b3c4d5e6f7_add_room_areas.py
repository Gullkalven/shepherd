"""add room areas JSON and area_id on tasks/photos/visits

Revision ID: a2b3c4d5e6f7
Revises: f7e8d9c0b1a2
Create Date: 2026-04-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "f7e8d9c0b1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("areas", sa.JSON(), nullable=True))
    op.add_column("tasks", sa.Column("area_id", sa.String(), nullable=True))
    op.add_column("room_photos", sa.Column("area_id", sa.String(), nullable=True))
    op.add_column("room_visits", sa.Column("area_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("room_visits", "area_id")
    op.drop_column("room_photos", "area_id")
    op.drop_column("tasks", "area_id")
    op.drop_column("rooms", "areas")

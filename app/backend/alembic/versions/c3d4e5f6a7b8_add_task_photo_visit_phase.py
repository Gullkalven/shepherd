"""add phase to tasks, room_photos, room_visits

Revision ID: c3d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-04-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('phase', sa.String(), nullable=True))
    op.add_column('room_photos', sa.Column('phase', sa.String(), nullable=True))
    op.add_column('room_visits', sa.Column('phase', sa.String(), nullable=True))

    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE tasks
            SET phase = 'demontering'
            WHERE phase IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column('room_visits', 'phase')
    op.drop_column('room_photos', 'phase')
    op.drop_column('tasks', 'phase')

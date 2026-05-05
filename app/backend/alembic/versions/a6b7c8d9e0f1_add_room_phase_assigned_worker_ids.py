"""add room phase_assigned_worker_ids (JSON)

Revision ID: a6b7c8d9e0f1
Revises: f1a2b3c4d5e6
Create Date: 2026-05-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("phase_assigned_worker_ids", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "phase_assigned_worker_ids")

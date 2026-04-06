"""add room deadline_at and checklist_labels (JSON)

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-04-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column("checklist_labels", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "checklist_labels")
    op.drop_column("rooms", "deadline_at")

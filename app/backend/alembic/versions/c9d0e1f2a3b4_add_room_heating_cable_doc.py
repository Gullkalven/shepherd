"""add room heating_cable_doc (JSON)

Revision ID: c9d0e1f2a3b4
Revises: b3c4d5e6f7a8
Create Date: 2026-04-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("heating_cable_doc", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "heating_cable_doc")

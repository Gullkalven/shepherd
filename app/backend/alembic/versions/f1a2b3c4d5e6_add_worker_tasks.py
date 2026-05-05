"""add worker_tasks table

Revision ID: f1a2b3c4d5e6
Revises: e1f2a3b4c5d6
Create Date: 2026-05-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "worker_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("worker_id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_worker_tasks_id"), "worker_tasks", ["id"], unique=False)
    op.create_index(op.f("ix_worker_tasks_room_id"), "worker_tasks", ["room_id"], unique=False)
    op.create_index(op.f("ix_worker_tasks_worker_id"), "worker_tasks", ["worker_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_worker_tasks_worker_id"), table_name="worker_tasks")
    op.drop_index(op.f("ix_worker_tasks_room_id"), table_name="worker_tasks")
    op.drop_index(op.f("ix_worker_tasks_id"), table_name="worker_tasks")
    op.drop_table("worker_tasks")

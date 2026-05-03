"""add project_workers table

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-05-03

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_workers" not in inspector.get_table_names():
        op.create_table(
            "project_workers",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("pin_hash", sa.String(length=512), nullable=False),
            sa.Column("role", sa.String(length=32), nullable=False, server_default="worker"),
            sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_project_workers_project_id"), "project_workers", ["project_id"], unique=False)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "project_workers" in inspector.get_table_names():
        op.drop_index(op.f("ix_project_workers_project_id"), table_name="project_workers")
        op.drop_table("project_workers")

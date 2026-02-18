"""Add development_area zone type and building generation fields

Revision ID: 002_dev_area_generation
Revises: 001_site_zones
Create Date: 2026-02-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002_dev_area_generation"
down_revision: Union[str, None] = "001_site_zones"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'development_area' to zone_type enum
    op.execute("ALTER TYPE zone_type ADD VALUE IF NOT EXISTS 'development_area'")

    # Add generation fields to buildings table
    op.add_column("buildings", sa.Column("generation_status", sa.String(20), nullable=True, server_default="idle"))
    op.add_column("buildings", sa.Column("generation_prompt", sa.Text(), nullable=True))
    op.add_column("buildings", sa.Column("meshy_task_id", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("buildings", "meshy_task_id")
    op.drop_column("buildings", "generation_prompt")
    op.drop_column("buildings", "generation_status")
    # Note: PostgreSQL does not support removing enum values directly.
    # The 'development_area' value will remain in the enum type.

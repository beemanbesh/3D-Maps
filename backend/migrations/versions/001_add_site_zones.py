"""Add site_zones table

Revision ID: 001_site_zones
Revises: None
Create Date: 2026-02-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
import geoalchemy2

# revision identifiers, used by Alembic.
revision: str = "001_site_zones"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create zone_type enum
    zone_type_enum = sa.Enum(
        "building", "residential", "road", "green_space", "parking", "water",
        name="zone_type",
    )
    zone_type_enum.create(op.get_bind(), checkfirst=True)

    # Create site_zones table
    op.create_table(
        "site_zones",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("zone_type", zone_type_enum, nullable=False),
        sa.Column("geometry", geoalchemy2.Geography("POLYGON", srid=4326), nullable=False),
        sa.Column("color", sa.String(7), nullable=False, server_default="#9b59b6"),
        sa.Column("properties", JSONB, nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Add GiST spatial index for efficient spatial queries
    op.create_index(
        "idx_site_zones_geometry",
        "site_zones",
        ["geometry"],
        postgresql_using="gist",
    )


def downgrade() -> None:
    op.drop_index("idx_site_zones_geometry", table_name="site_zones")
    op.drop_table("site_zones")
    sa.Enum(name="zone_type").drop(op.get_bind(), checkfirst=True)

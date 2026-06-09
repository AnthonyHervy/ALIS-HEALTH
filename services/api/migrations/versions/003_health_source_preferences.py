"""Add source preferences

Revision ID: 003_health_source_preferences
Revises: 002_health_sync_runs
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "003_health_source_preferences"
down_revision = "002_health_sync_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_source_preferences",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.String(length=40), nullable=False),
        sa.Column("preferred_source", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "domain", name="uq_health_source_preference_domain"),
    )
    op.create_index("ix_health_source_preferences_user_id", "health_source_preferences", ["user_id"])
    op.create_index("ix_health_source_preferences_domain", "health_source_preferences", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_health_source_preferences_domain", table_name="health_source_preferences")
    op.drop_index("ix_health_source_preferences_user_id", table_name="health_source_preferences")
    op.drop_table("health_source_preferences")

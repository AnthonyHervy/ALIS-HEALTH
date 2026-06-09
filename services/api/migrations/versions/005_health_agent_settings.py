"""Add AI agent settings

Revision ID: 005_health_agent_settings
Revises: 004_processing_snapshots
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "005_health_agent_settings"
down_revision = "004_processing_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_agent_settings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_health_agent_settings_user"),
    )
    op.create_index("ix_health_agent_settings_user_id", "health_agent_settings", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_health_agent_settings_user_id", table_name="health_agent_settings")
    op.drop_table("health_agent_settings")

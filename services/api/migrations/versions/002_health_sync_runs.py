"""add health sync runs

Revision ID: 002_health_sync_runs
Revises: 001_initial_healthconnect
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

revision = "002_health_sync_runs"
down_revision = "001_initial_healthconnect"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_sync_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_id", sa.String(length=36), sa.ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("trigger", sa.String(length=30), nullable=False),
        sa.Column("sync_mode", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("records_received", sa.Integer(), nullable=False),
        sa.Column("duplicate", sa.Boolean(), nullable=False),
        sa.Column("data_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("network_type", sa.String(length=40), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_sync_runs_user_id", "health_sync_runs", ["user_id"])
    op.create_index("ix_health_sync_runs_trigger", "health_sync_runs", ["trigger"])
    op.create_index("ix_health_sync_runs_status", "health_sync_runs", ["status"])
    op.create_index("ix_health_sync_runs_created_at", "health_sync_runs", ["created_at"])


def downgrade() -> None:
    op.drop_table("health_sync_runs")

"""Add processing jobs and dashboard snapshots

Revision ID: 004_processing_snapshots
Revises: 003_health_source_preferences
Create Date: 2026-05-26
"""

from alembic import op
import sqlalchemy as sa


revision = "004_processing_snapshots"
down_revision = "003_health_source_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_processing_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("source_sync_run_id", sa.String(length=36), sa.ForeignKey("health_sync_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_health_processing_jobs_user_id", "health_processing_jobs", ["user_id"])
    op.create_index("ix_health_processing_jobs_kind", "health_processing_jobs", ["kind"])
    op.create_index("ix_health_processing_jobs_status", "health_processing_jobs", ["status"])
    op.create_index("ix_health_processing_jobs_created_at", "health_processing_jobs", ["created_at"])

    op.create_table(
        "health_dashboard_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_sync_run_id", sa.String(length=36), sa.ForeignKey("health_sync_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_health_dashboard_snapshot_user"),
    )
    op.create_index("ix_health_dashboard_snapshots_user_id", "health_dashboard_snapshots", ["user_id"])
    op.create_index("ix_health_dashboard_snapshots_computed_at", "health_dashboard_snapshots", ["computed_at"])


def downgrade() -> None:
    op.drop_index("ix_health_dashboard_snapshots_computed_at", table_name="health_dashboard_snapshots")
    op.drop_index("ix_health_dashboard_snapshots_user_id", table_name="health_dashboard_snapshots")
    op.drop_table("health_dashboard_snapshots")
    op.drop_index("ix_health_processing_jobs_created_at", table_name="health_processing_jobs")
    op.drop_index("ix_health_processing_jobs_status", table_name="health_processing_jobs")
    op.drop_index("ix_health_processing_jobs_kind", table_name="health_processing_jobs")
    op.drop_index("ix_health_processing_jobs_user_id", table_name="health_processing_jobs")
    op.drop_table("health_processing_jobs")

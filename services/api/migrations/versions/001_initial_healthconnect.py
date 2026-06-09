"""initial healthconnect schema

Revision ID: 001_initial_healthconnect
Revises:
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa

revision = "001_initial_healthconnect"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "health_device_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("device_name", sa.String(length=255), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_health_device_tokens_user_id", "health_device_tokens", ["user_id"])
    op.create_index("ix_health_device_tokens_token_hash", "health_device_tokens", ["token_hash"])
    op.create_table(
        "health_data_sources",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=True),
        sa.Column("device_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "source_type", "device_id", name="uq_health_data_source_identity"),
    )
    op.create_index("ix_health_data_sources_user_id", "health_data_sources", ["user_id"])
    op.create_table(
        "health_raw_batches",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False, unique=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_health_raw_batches_user_id", "health_raw_batches", ["user_id"])
    op.create_index("ix_health_raw_batches_source_id", "health_raw_batches", ["source_id"])
    op.create_index("ix_health_raw_batches_idempotency_key", "health_raw_batches", ["idempotency_key"])
    op.create_table(
        "health_observations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_id", sa.String(length=36), sa.ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index("ix_health_observations_user_id", "health_observations", ["user_id"])
    op.create_index("ix_health_observations_type", "health_observations", ["type"])
    op.create_index("ix_health_observations_timestamp", "health_observations", ["timestamp"])
    op.create_table(
        "health_intervals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_id", sa.String(length=36), sa.ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index("ix_health_intervals_user_id", "health_intervals", ["user_id"])
    op.create_index("ix_health_intervals_type", "health_intervals", ["type"])
    op.create_index("ix_health_intervals_start_time", "health_intervals", ["start_time"])
    op.create_table(
        "health_sleep_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("interval_id", sa.String(length=36), sa.ForeignKey("health_intervals.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("total_duration_minutes", sa.Integer(), nullable=True),
        sa.Column("deep_sleep_minutes", sa.Integer(), nullable=True),
        sa.Column("rem_sleep_minutes", sa.Integer(), nullable=True),
        sa.Column("light_sleep_minutes", sa.Integer(), nullable=True),
        sa.Column("awake_minutes", sa.Integer(), nullable=True),
        sa.Column("stages", sa.JSON(), nullable=True),
    )
    op.create_table(
        "health_workouts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("interval_id", sa.String(length=36), sa.ForeignKey("health_intervals.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("activity_type", sa.String(length=80), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("distance_meters", sa.Float(), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=True),
        sa.Column("avg_heart_rate", sa.Integer(), nullable=True),
        sa.Column("max_heart_rate", sa.Integer(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_table(
        "health_nutrition_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_id", sa.String(length=36), sa.ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("meal_type", sa.String(length=50), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbohydrates_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index("ix_health_nutrition_records_user_id", "health_nutrition_records", ["user_id"])
    op.create_index("ix_health_nutrition_records_timestamp", "health_nutrition_records", ["timestamp"])
    op.create_table(
        "health_hydration_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=36), sa.ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("batch_id", sa.String(length=36), sa.ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("volume_liters", sa.Float(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index("ix_health_hydration_records_user_id", "health_hydration_records", ["user_id"])
    op.create_index("ix_health_hydration_records_start_time", "health_hydration_records", ["start_time"])
    op.create_table(
        "health_daily_aggregates",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("window", sa.String(length=10), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_daily_aggregates_user_id", "health_daily_aggregates", ["user_id"])
    op.create_index("ix_health_daily_aggregates_date", "health_daily_aggregates", ["date"])
    op.create_index("ix_health_daily_aggregates_window", "health_daily_aggregates", ["window"])


def downgrade() -> None:
    for table in (
        "health_daily_aggregates",
        "health_hydration_records",
        "health_nutrition_records",
        "health_workouts",
        "health_sleep_sessions",
        "health_intervals",
        "health_observations",
        "health_raw_batches",
        "health_data_sources",
        "health_device_tokens",
        "health_users",
    ):
        op.drop_table(table)

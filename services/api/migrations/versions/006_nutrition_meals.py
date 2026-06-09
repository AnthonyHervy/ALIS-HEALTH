"""Add nutrition meal analysis tables

Revision ID: 006_health_nutrition_meals
Revises: 005_health_agent_settings
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa


revision = "006_health_nutrition_meals"
down_revision = "005_health_agent_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_nutrition_food_references",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("source_id", sa.String(length=120), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("energy_kcal_100g", sa.Float(), nullable=False),
        sa.Column("protein_g_100g", sa.Float(), nullable=False),
        sa.Column("carbohydrates_g_100g", sa.Float(), nullable=False),
        sa.Column("fat_g_100g", sa.Float(), nullable=False),
        sa.Column("default_serving_g", sa.Float(), nullable=True),
        sa.Column("dataset_version", sa.String(length=80), nullable=False),
        sa.Column("raw", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "source_id", name="uq_nutrition_food_reference_source"),
    )
    op.create_index("ix_health_nutrition_food_references_source", "health_nutrition_food_references", ["source"])
    op.create_index("ix_health_nutrition_food_references_source_id", "health_nutrition_food_references", ["source_id"])
    op.create_index("ix_health_nutrition_food_references_barcode", "health_nutrition_food_references", ["barcode"])
    op.create_index("ix_health_nutrition_food_references_name", "health_nutrition_food_references", ["name"])

    op.create_table(
        "health_nutrition_meals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("meal_type", sa.String(length=50), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("confidence", sa.String(length=20), nullable=True),
        sa.Column("validation_blocked", sa.Boolean(), nullable=False),
        sa.Column("kcal_min", sa.Float(), nullable=True),
        sa.Column("kcal_max", sa.Float(), nullable=True),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbohydrates_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("model_name", sa.String(length=120), nullable=True),
        sa.Column("prompt_version", sa.String(length=80), nullable=True),
        sa.Column("dataset_versions", sa.JSON(), nullable=True),
        sa.Column("source_trace", sa.JSON(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "validated_nutrition_record_id",
            sa.String(length=36),
            sa.ForeignKey("health_nutrition_records.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_nutrition_meals_user_id", "health_nutrition_meals", ["user_id"])
    op.create_index("ix_health_nutrition_meals_status", "health_nutrition_meals", ["status"])
    op.create_index("ix_health_nutrition_meals_consumed_at", "health_nutrition_meals", ["consumed_at"])
    op.create_index("ix_health_nutrition_meals_created_at", "health_nutrition_meals", ["created_at"])

    op.create_table(
        "health_nutrition_meal_photos",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_id", sa.String(length=36), sa.ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_path", sa.Text(), nullable=True),
        sa.Column("thumbnail_path", sa.Text(), nullable=True),
        sa.Column("content_type", sa.String(length=120), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_nutrition_meal_photos_meal_id", "health_nutrition_meal_photos", ["meal_id"])
    op.create_index("ix_health_nutrition_meal_photos_created_at", "health_nutrition_meal_photos", ["created_at"])

    op.create_table(
        "health_nutrition_analysis_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_id", sa.String(length=36), sa.ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("health_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_health_nutrition_analysis_jobs_meal_id", "health_nutrition_analysis_jobs", ["meal_id"])
    op.create_index("ix_health_nutrition_analysis_jobs_user_id", "health_nutrition_analysis_jobs", ["user_id"])
    op.create_index("ix_health_nutrition_analysis_jobs_status", "health_nutrition_analysis_jobs", ["status"])
    op.create_index("ix_health_nutrition_analysis_jobs_created_at", "health_nutrition_analysis_jobs", ["created_at"])

    op.create_table(
        "health_nutrition_meal_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_id", sa.String(length=36), sa.ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "reference_id",
            sa.String(length=36),
            sa.ForeignKey("health_nutrition_food_references.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("detected_name", sa.String(length=255), nullable=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=40), nullable=True),
        sa.Column("source_id", sa.String(length=120), nullable=True),
        sa.Column("portion_g", sa.Float(), nullable=False),
        sa.Column("included", sa.Boolean(), nullable=False),
        sa.Column("confidence", sa.String(length=20), nullable=True),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbohydrates_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_health_nutrition_meal_items_meal_id", "health_nutrition_meal_items", ["meal_id"])
    op.create_index("ix_health_nutrition_meal_items_reference_id", "health_nutrition_meal_items", ["reference_id"])
    op.create_index("ix_health_nutrition_meal_items_barcode", "health_nutrition_meal_items", ["barcode"])
    op.create_index("ix_health_nutrition_meal_items_created_at", "health_nutrition_meal_items", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_health_nutrition_meal_items_created_at", table_name="health_nutrition_meal_items")
    op.drop_index("ix_health_nutrition_meal_items_barcode", table_name="health_nutrition_meal_items")
    op.drop_index("ix_health_nutrition_meal_items_reference_id", table_name="health_nutrition_meal_items")
    op.drop_index("ix_health_nutrition_meal_items_meal_id", table_name="health_nutrition_meal_items")
    op.drop_table("health_nutrition_meal_items")
    op.drop_index("ix_health_nutrition_analysis_jobs_created_at", table_name="health_nutrition_analysis_jobs")
    op.drop_index("ix_health_nutrition_analysis_jobs_status", table_name="health_nutrition_analysis_jobs")
    op.drop_index("ix_health_nutrition_analysis_jobs_user_id", table_name="health_nutrition_analysis_jobs")
    op.drop_index("ix_health_nutrition_analysis_jobs_meal_id", table_name="health_nutrition_analysis_jobs")
    op.drop_table("health_nutrition_analysis_jobs")
    op.drop_index("ix_health_nutrition_meal_photos_created_at", table_name="health_nutrition_meal_photos")
    op.drop_index("ix_health_nutrition_meal_photos_meal_id", table_name="health_nutrition_meal_photos")
    op.drop_table("health_nutrition_meal_photos")
    op.drop_index("ix_health_nutrition_meals_created_at", table_name="health_nutrition_meals")
    op.drop_index("ix_health_nutrition_meals_consumed_at", table_name="health_nutrition_meals")
    op.drop_index("ix_health_nutrition_meals_status", table_name="health_nutrition_meals")
    op.drop_index("ix_health_nutrition_meals_user_id", table_name="health_nutrition_meals")
    op.drop_table("health_nutrition_meals")
    op.drop_index("ix_health_nutrition_food_references_name", table_name="health_nutrition_food_references")
    op.drop_index("ix_health_nutrition_food_references_barcode", table_name="health_nutrition_food_references")
    op.drop_index("ix_health_nutrition_food_references_source_id", table_name="health_nutrition_food_references")
    op.drop_index("ix_health_nutrition_food_references_source", table_name="health_nutrition_food_references")
    op.drop_table("health_nutrition_food_references")

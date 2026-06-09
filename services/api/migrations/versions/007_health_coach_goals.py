"""Add coach goals to agent settings

Revision ID: 007_health_coach_goals
Revises: 006_health_nutrition_meals
Create Date: 2026-05-31
"""

from alembic import op
import sqlalchemy as sa


revision = "007_health_coach_goals"
down_revision = "006_health_nutrition_meals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("health_agent_settings", sa.Column("coach_goals", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("health_agent_settings", "coach_goals")

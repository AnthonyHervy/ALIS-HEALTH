import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uuid_str() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class HealthUser(Base):
    __tablename__ = "health_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class HealthDeviceToken(Base):
    __tablename__ = "health_device_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DataSource(Base):
    __tablename__ = "health_data_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "source_type", "device_id", name="uq_health_data_source_identity"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(50))
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class HealthRawBatch(Base):
    __tablename__ = "health_raw_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="CASCADE"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HealthSyncRun(Base):
    __tablename__ = "health_sync_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True)
    trigger: Mapped[str] = mapped_column(String(30), default="unknown", index=True)
    sync_mode: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    records_received: Mapped[int] = mapped_column(Integer, default=0)
    duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    data_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    data_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    network_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class HealthProcessingJob(Base):
    __tablename__ = "health_processing_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40), default="dashboard_snapshot", index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    source_sync_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_sync_runs.id", ondelete="SET NULL"), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HealthDashboardSnapshot(Base):
    __tablename__ = "health_dashboard_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_health_dashboard_snapshot_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_sync_run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_sync_runs.id", ondelete="SET NULL"), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class HealthSourcePreference(Base):
    __tablename__ = "health_source_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "domain", name="uq_health_source_preference_domain"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    domain: Mapped[str] = mapped_column(String(40), index=True)
    preferred_source: Mapped[str] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class HealthAgentSetting(Base):
    __tablename__ = "health_agent_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_health_agent_settings_user"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    coach_goals: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class NutritionFoodReference(Base):
    __tablename__ = "health_nutrition_food_references"
    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_nutrition_food_reference_source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    source: Mapped[str] = mapped_column(String(40), index=True)
    source_id: Mapped[str] = mapped_column(String(120), index=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    energy_kcal_100g: Mapped[float] = mapped_column(Float)
    protein_g_100g: Mapped[float] = mapped_column(Float)
    carbohydrates_g_100g: Mapped[float] = mapped_column(Float)
    fat_g_100g: Mapped[float] = mapped_column(Float)
    default_serving_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    dataset_version: Mapped[str] = mapped_column(String(80))
    raw_json: Mapped[dict | None] = mapped_column("raw", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class NutritionMeal(Base):
    __tablename__ = "health_nutrition_meals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    meal_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    consumed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    validation_blocked: Mapped[bool] = mapped_column(Boolean, default=True)
    kcal_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    kcal_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbohydrates_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    dataset_versions_json: Mapped[dict | None] = mapped_column("dataset_versions", JSON, nullable=True)
    source_trace_json: Mapped[dict | None] = mapped_column("source_trace", JSON, nullable=True)
    result_json: Mapped[dict | None] = mapped_column("result", JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    validated_nutrition_record_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("health_nutrition_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class NutritionMealPhoto(Base):
    __tablename__ = "health_nutrition_meal_photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    meal_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), index=True)
    original_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)


class NutritionAnalysisJob(Base):
    __tablename__ = "health_nutrition_analysis_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    meal_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NutritionMealItem(Base):
    __tablename__ = "health_nutrition_meal_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    meal_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_nutrition_meals.id", ondelete="CASCADE"), index=True)
    reference_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("health_nutrition_food_references.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    detected_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    portion_g: Mapped[float] = mapped_column(Float)
    included: Mapped[bool] = mapped_column(Boolean, default=True)
    confidence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbohydrates_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class HealthObservation(Base):
    __tablename__ = "health_observations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20))
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class HealthInterval(Base):
    __tablename__ = "health_intervals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class HealthSleepSession(Base):
    __tablename__ = "health_sleep_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    interval_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_intervals.id", ondelete="CASCADE"), unique=True)
    total_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deep_sleep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rem_sleep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    light_sleep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    awake_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stages: Mapped[list | None] = mapped_column(JSON, nullable=True)


class HealthWorkout(Base):
    __tablename__ = "health_workouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    interval_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_intervals.id", ondelete="CASCADE"), unique=True)
    activity_type: Mapped[str] = mapped_column(String(80))
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class HealthNutritionRecord(Base):
    __tablename__ = "health_nutrition_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    meal_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbohydrates_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class HealthHydrationRecord(Base):
    __tablename__ = "health_hydration_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_data_sources.id", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("health_raw_batches.id", ondelete="SET NULL"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    volume_liters: Mapped[float] = mapped_column(Float)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class HealthDailyAggregate(Base):
    __tablename__ = "health_daily_aggregates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("health_users.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    window: Mapped[str] = mapped_column(String(10), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

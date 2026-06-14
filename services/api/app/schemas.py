from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RegisterDeviceRequest(BaseModel):
    pairing_code: str
    device_name: str | None = None


class RegisterDeviceResponse(BaseModel):
    user_id: str
    device_token: str


class HeartRateRecord(BaseModel):
    timestamp: datetime
    bpm: int = Field(ge=0, le=300)
    metadata: dict | None = None


class HrvRecord(BaseModel):
    timestamp: datetime
    rmssd_ms: float = Field(ge=0)
    metadata: dict | None = None


class StepsRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    count: int = Field(ge=0)
    metadata: dict | None = None


class SleepStage(BaseModel):
    stage: str
    start_time: datetime
    end_time: datetime


class SleepRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    stages: list[SleepStage] | None = None
    metadata: dict | None = None


class WorkoutRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    activity_type: str
    distance_meters: float | None = None
    calories: int | None = None
    avg_heart_rate: int | None = None
    max_heart_rate: int | None = None
    metadata: dict | None = None


class CaloriesRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    calories: float = Field(ge=0)
    is_active: bool = True
    metadata: dict | None = None


class DistanceRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    meters: float = Field(ge=0)
    metadata: dict | None = None


class ScalarObservationRecord(BaseModel):
    timestamp: datetime
    value: float = Field(ge=0)
    metadata: dict | None = None


class BloodGlucoseRecord(BaseModel):
    timestamp: datetime
    glucose_mg_dl: float = Field(ge=0)
    relation_to_meal: int | None = None
    meal_type: int | None = None
    metadata: dict | None = None


class RestingHeartRateRecord(BaseModel):
    timestamp: datetime
    bpm: int = Field(ge=0, le=300)
    metadata: dict | None = None


class BodyTemperatureRecord(BaseModel):
    timestamp: datetime
    temperature_celsius: float
    measurement_location: int | None = None
    metadata: dict | None = None


class Vo2MaxRecord(BaseModel):
    timestamp: datetime
    ml_per_kg_min: float = Field(ge=0)
    measurement_method: int | None = None
    metadata: dict | None = None


class WeightRecord(BaseModel):
    timestamp: datetime
    kg: float = Field(ge=0)
    metadata: dict | None = None


class NutritionRecord(BaseModel):
    timestamp: datetime
    meal_type: str | None = None
    name: str | None = None
    energy_kcal: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbohydrates_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    metadata: dict | None = None


class HydrationRecord(BaseModel):
    start_time: datetime
    end_time: datetime
    volume_liters: float = Field(ge=0)
    metadata: dict | None = None


class HealthBatchRequest(BaseModel):
    source_type: Literal["healthconnect", "healthkit", "garmin", "manual"]
    device_name: str | None = None
    device_id: str | None = None
    data_start: datetime
    data_end: datetime
    sync_trigger: Literal["manual", "background", "portal", "unknown"] = "unknown"
    sync_mode: Literal["initial_full_history", "initial_30d", "incremental"] | None = None
    network_type: str | None = None
    heart_rate: list[HeartRateRecord] | None = None
    hrv: list[HrvRecord] | None = None
    steps: list[StepsRecord] | None = None
    sleep: list[SleepRecord] | None = None
    workouts: list[WorkoutRecord] | None = None
    calories: list[CaloriesRecord] | None = None
    distance: list[DistanceRecord] | None = None
    blood_glucose: list[BloodGlucoseRecord] | None = None
    resting_heart_rate: list[RestingHeartRateRecord] | None = None
    body_temperature: list[BodyTemperatureRecord] | None = None
    vo2_max: list[Vo2MaxRecord] | None = None
    weight: list[WeightRecord] | None = None
    nutrition: list[NutritionRecord] | None = None
    hydration: list[HydrationRecord] | None = None
    raw_records: dict[str, list[dict]] | None = None


class HealthBatchResponse(BaseModel):
    batch_id: str
    status: str
    records_received: int
    message: str


class SyncRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str | None
    trigger: str
    sync_mode: str | None
    status: str
    records_received: int
    duplicate: bool
    data_start: datetime | None
    data_end: datetime | None
    network_type: str | None
    error_message: str | None
    created_at: datetime


class SyncRunListResponse(BaseModel):
    runs: list[SyncRunResponse]


class SyncRunSummaryResponse(BaseModel):
    total_runs: int
    success_runs: int
    error_runs: int
    duplicate_runs: int
    records_received: int
    last_success_at: datetime | None
    last_manual_at: datetime | None
    last_background_at: datetime | None
    latest_network_type: str | None
    recent_runs: list[SyncRunResponse]


class SyncRunReportRequest(BaseModel):
    trigger: Literal["manual", "background", "portal", "unknown"] = "unknown"
    sync_mode: Literal["initial_full_history", "initial_30d", "incremental"] | None = None
    status: Literal["success", "failed", "skipped"] = "skipped"
    records_received: int = Field(default=0, ge=0)
    duplicate: bool = False
    data_start: datetime | None = None
    data_end: datetime | None = None
    network_type: str | None = None
    error_message: str | None = None


class SourcePreferencesRequest(BaseModel):
    preferences: dict[Literal["activity", "sleep", "workouts", "nutrition"], str | None]


class SourceConfigResponse(BaseModel):
    detected_sources: dict[str, list[str]]
    preferred_sources: dict[str, str | None]
    effective_sources: dict[str, str | None]
    source_badge: str


class AgentPromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20000)


class AgentPromptResponse(BaseModel):
    prompt: str
    is_default: bool
    updated_at: datetime | None = None


class CoachGoal(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    priority: int = Field(ge=1, le=20)
    enabled: bool = True


class CoachGoalsRequest(BaseModel):
    goals: list[CoachGoal] = Field(min_length=1, max_length=12)


class CoachGoalsResponse(BaseModel):
    goals: list[CoachGoal]
    is_default: bool
    updated_at: datetime | None = None


class RecomputeRequest(BaseModel):
    windows: list[Literal["24h", "7d", "30d"]] = ["24h", "7d", "30d"]


class RecomputeResponse(BaseModel):
    windows: list[str]
    aggregates_written: int


class CoachMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CoachChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    mode: Literal["coach", "plan"] = "coach"
    history: list[CoachMessage] = Field(default_factory=list)
    language: Literal["fr", "en"] | None = None


class CoachAdvice(BaseModel):
    title: str
    summary: str
    action: str


class CoachAction(BaseModel):
    slug: str
    label: str
    priority: int
    reason: str
    action: str
    tone: Literal["green", "orange", "red"]


class CoachTodayAdviceResponse(BaseModel):
    version: str
    generated_at: str
    model: str
    advice: CoachAdvice
    actions: list[CoachAction] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"]
    context_window: Literal["24h"]
    fallback: bool = False


class CoachChatResponse(BaseModel):
    version: str
    generated_at: str
    model: str
    response: str
    fallback: bool = False


class NutritionMealItemEdit(BaseModel):
    id: str
    portion_g: float | None = Field(default=None, gt=0)
    included: bool | None = None
    reference_id: str | None = None


class NutritionMealUpdateRequest(BaseModel):
    items: list[NutritionMealItemEdit] = Field(default_factory=list)


class NutritionFoodReferenceResponse(BaseModel):
    id: str
    source: str
    source_id: str
    barcode: str | None = None
    name: str
    energy_kcal_100g: float
    protein_g_100g: float
    carbohydrates_g_100g: float
    fat_g_100g: float
    dataset_version: str


class NutritionFoodSearchResponse(BaseModel):
    foods: list[NutritionFoodReferenceResponse]


class NutritionDatasetSourceStatus(BaseModel):
    source: str
    reference_count: int
    dataset_versions: list[str]


class NutritionDatasetStatusResponse(BaseModel):
    ciqual_loaded: bool
    openfoodfacts_loaded: bool
    total_references: int
    sources: list[NutritionDatasetSourceStatus]


class NutritionOllamaDiagnosticResponse(BaseModel):
    base_url: str
    model: str
    reachable: bool
    model_available: bool
    error_message: str | None = None


class NutritionJobDiagnosticResponse(BaseModel):
    pending: int
    running: int
    failed: int


class NutritionDiagnosticResponse(BaseModel):
    api_status: Literal["ok"]
    datasets: NutritionDatasetStatusResponse
    ollama: NutritionOllamaDiagnosticResponse
    jobs: NutritionJobDiagnosticResponse


class NutritionPhotoResponse(BaseModel):
    id: str
    thumbnail_url: str | None = None
    original_filename: str | None = None
    purged: bool


class NutritionMealItemResponse(BaseModel):
    id: str
    name: str
    detected_name: str | None = None
    barcode: str | None = None
    source: str | None = None
    source_id: str | None = None
    portion_g: float
    included: bool
    confidence: str | None = None
    energy_kcal: float | None = None
    protein_g: float | None = None
    carbohydrates_g: float | None = None
    fat_g: float | None = None


class NutritionAnalysisJobResponse(BaseModel):
    id: str
    status: str
    attempts: int
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class NutritionMealResponse(BaseModel):
    id: str
    status: str
    meal_type: str | None = None
    consumed_at: datetime
    title: str | None = None
    photo_count: int
    photos: list[NutritionPhotoResponse] = Field(default_factory=list)
    items: list[NutritionMealItemResponse] = Field(default_factory=list)
    confidence: str | None = None
    validation_blocked: bool
    kcal_min: float | None = None
    kcal_max: float | None = None
    energy_kcal: float | None = None
    protein_g: float | None = None
    carbohydrates_g: float | None = None
    fat_g: float | None = None
    model_name: str | None = None
    prompt_version: str | None = None
    dataset_versions: dict | None = None
    source_trace: dict | None = None
    analysis_job: NutritionAnalysisJobResponse | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class NutritionMealListResponse(BaseModel):
    meals: list[NutritionMealResponse]

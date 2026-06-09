import hashlib
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DataSource,
    HealthHydrationRecord,
    HealthInterval,
    HealthNutritionRecord,
    HealthObservation,
    HealthRawBatch,
    HealthSleepSession,
    HealthSyncRun,
    HealthWorkout,
)
from app.schemas import HealthBatchRequest


OBSERVATION_RANGES = {
    "heart_rate": (30, 300),
    "hrv": (5, 300),
    "steps": (0, 100_000),
    "active_calories": (0, 10_000),
    "calories": (0, 10_000),
    "distance": (0, 200_000),
    "blood_glucose": (20, 600),
    "resting_heart_rate": (30, 120),
    "body_temperature": (25, 45),
    "vo2_max": (5, 100),
    "weight": (1, 500),
}


def is_valid_observation(kind: str, value: float) -> bool:
    bounds = OBSERVATION_RANGES.get(kind)
    return True if bounds is None else bounds[0] <= value <= bounds[1]


def sleep_minutes_from_stages(stages: list[dict], fallback_minutes: int) -> tuple[int, int, int, int, int]:
    deep = rem = light = awake = 0
    for stage in stages:
        start = datetime.fromisoformat(stage["start_time"])
        end = datetime.fromisoformat(stage["end_time"])
        duration = int((end - start).total_seconds() / 60)
        stage_name = str(stage["stage"]).lower()
        if stage_name == "deep":
            deep += duration
        elif stage_name == "rem":
            rem += duration
        elif stage_name in {"light", "sleeping"}:
            light += duration
        elif stage_name in {"awake", "out_of_bed"}:
            awake += duration
    total = deep + rem + light
    return total or fallback_minutes, deep, rem, light, awake


class HealthNormalizer:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def ingest_batch(self, user_id: str, request: HealthBatchRequest) -> tuple[HealthRawBatch, int, bool, HealthSyncRun]:
        source = await self._get_or_create_source(user_id, request)
        payload = request.model_dump(mode="json")
        idempotency_key = hashlib.sha256(
            json.dumps({"user_id": user_id, "payload": payload}, sort_keys=True).encode("utf-8")
        ).hexdigest()
        existing = await self.db.scalar(
            select(HealthRawBatch).where(HealthRawBatch.idempotency_key == idempotency_key)
        )
        if existing is not None:
            sync_run = await self._record_sync_run(
                user_id=user_id,
                source_id=source.id,
                batch_id=existing.id,
                request=request,
                records_received=0,
                duplicate=True,
            )
            await self.db.commit()
            return existing, 0, True, sync_run

        batch = HealthRawBatch(
            user_id=user_id,
            source_id=source.id,
            idempotency_key=idempotency_key,
            payload=payload,
            status="pending",
        )
        self.db.add(batch)
        await self.db.flush()
        records_received = self._count_records(payload)
        records_created = await self.normalize_batch(batch, source)
        batch.status = "completed"
        batch.processed_at = datetime.utcnow()
        sync_run = await self._record_sync_run(
            user_id=user_id,
            source_id=source.id,
            batch_id=batch.id,
            request=request,
            records_received=max(records_received, records_created),
            duplicate=False,
        )
        await self.db.commit()
        return batch, max(records_received, records_created), False, sync_run

    async def _record_sync_run(
        self,
        *,
        user_id: str,
        source_id: str,
        batch_id: str,
        request: HealthBatchRequest,
        records_received: int,
        duplicate: bool,
    ) -> HealthSyncRun:
        sync_run = HealthSyncRun(
            user_id=user_id,
            source_id=source_id,
            batch_id=batch_id,
            trigger=request.sync_trigger,
            sync_mode=request.sync_mode,
            status="success",
            records_received=records_received,
            duplicate=duplicate,
            data_start=request.data_start,
            data_end=request.data_end,
            network_type=request.network_type,
        )
        self.db.add(sync_run)
        await self.db.flush()
        return sync_run

    async def _get_or_create_source(self, user_id: str, request: HealthBatchRequest) -> DataSource:
        source = await self.db.scalar(
            select(DataSource).where(
                DataSource.user_id == user_id,
                DataSource.source_type == request.source_type,
                DataSource.device_id == request.device_id,
            )
        )
        if source is not None:
            return source

        source = DataSource(
            user_id=user_id,
            source_type=request.source_type,
            device_name=request.device_name,
            device_id=request.device_id,
        )
        self.db.add(source)
        await self.db.flush()
        return source

    def _count_records(self, payload: dict) -> int:
        count = 0
        for key in (
            "heart_rate",
            "hrv",
            "steps",
            "sleep",
            "workouts",
            "calories",
            "distance",
            "blood_glucose",
            "resting_heart_rate",
            "body_temperature",
            "vo2_max",
            "weight",
            "nutrition",
            "hydration",
        ):
            count += len(payload.get(key) or [])
        count += sum(len(records) for records in (payload.get("raw_records") or {}).values())
        return count

    async def normalize_batch(self, batch: HealthRawBatch, source: DataSource) -> int:
        payload = batch.payload
        created = 0
        created += self._add_observations(batch, source, payload)
        created += await self._add_sleep(batch, source, payload)
        created += await self._add_workouts(batch, source, payload)
        created += self._add_nutrition(batch, source, payload)
        created += self._add_hydration(batch, source, payload)
        return created

    def _add_observation(
        self,
        batch: HealthRawBatch,
        source: DataSource,
        kind: str,
        timestamp: str,
        value: float,
        unit: str,
        metadata: dict | None = None,
    ) -> int:
        if not is_valid_observation(kind, value):
            return 0
        self.db.add(
            HealthObservation(
                user_id=batch.user_id,
                source_id=source.id,
                batch_id=batch.id,
                type=kind,
                timestamp=datetime.fromisoformat(timestamp),
                value=value,
                unit=unit,
                metadata_json=metadata,
            )
        )
        return 1

    def _add_observations(self, batch: HealthRawBatch, source: DataSource, payload: dict) -> int:
        created = 0
        for record in payload.get("heart_rate") or []:
            created += self._add_observation(batch, source, "heart_rate", record["timestamp"], float(record["bpm"]), "bpm", record.get("metadata"))
        for record in payload.get("hrv") or []:
            created += self._add_observation(batch, source, "hrv", record["timestamp"], float(record["rmssd_ms"]), "ms", record.get("metadata"))
        for record in payload.get("steps") or []:
            created += self._add_observation(
                batch,
                source,
                "steps",
                record["end_time"],
                float(record["count"]),
                "count",
                {
                    **(record.get("metadata") or {}),
                    "start_time": record["start_time"],
                    "end_time": record["end_time"],
                },
            )
        for record in payload.get("calories") or []:
            kind = "active_calories" if record.get("is_active", True) else "calories"
            created += self._add_observation(
                batch,
                source,
                kind,
                record["end_time"],
                float(record["calories"]),
                "kcal",
                {
                    **(record.get("metadata") or {}),
                    "start_time": record["start_time"],
                    "end_time": record["end_time"],
                },
            )
        for record in payload.get("distance") or []:
            created += self._add_observation(
                batch,
                source,
                "distance",
                record["end_time"],
                float(record["meters"]),
                "m",
                {
                    **(record.get("metadata") or {}),
                    "start_time": record["start_time"],
                    "end_time": record["end_time"],
                },
            )
        for record in payload.get("blood_glucose") or []:
            created += self._add_observation(batch, source, "blood_glucose", record["timestamp"], float(record["glucose_mg_dl"]), "mg/dL", record.get("metadata"))
        for record in payload.get("resting_heart_rate") or []:
            created += self._add_observation(batch, source, "resting_heart_rate", record["timestamp"], float(record["bpm"]), "bpm", record.get("metadata"))
        for record in payload.get("body_temperature") or []:
            created += self._add_observation(batch, source, "body_temperature", record["timestamp"], float(record["temperature_celsius"]), "celsius", record.get("metadata"))
        for record in payload.get("vo2_max") or []:
            created += self._add_observation(batch, source, "vo2_max", record["timestamp"], float(record["ml_per_kg_min"]), "ml/kg/min", record.get("metadata"))
        for record in payload.get("weight") or []:
            created += self._add_observation(batch, source, "weight", record["timestamp"], float(record["kg"]), "kg", record.get("metadata"))
        return created

    async def _add_sleep(self, batch: HealthRawBatch, source: DataSource, payload: dict) -> int:
        created = 0
        for record in payload.get("sleep") or []:
            start = datetime.fromisoformat(record["start_time"])
            end = datetime.fromisoformat(record["end_time"])
            fallback = int((end - start).total_seconds() / 60)
            stages = record.get("stages") or []
            total, deep, rem, light, awake = sleep_minutes_from_stages(stages, fallback)
            interval = HealthInterval(
                user_id=batch.user_id,
                source_id=source.id,
                batch_id=batch.id,
                type="sleep",
                start_time=start,
                end_time=end,
                metadata_json=record.get("metadata"),
            )
            self.db.add(interval)
            await self.db.flush()
            self.db.add(
                HealthSleepSession(
                    interval_id=interval.id,
                    total_duration_minutes=total,
                    deep_sleep_minutes=deep or None,
                    rem_sleep_minutes=rem or None,
                    light_sleep_minutes=light or None,
                    awake_minutes=awake or None,
                    stages=stages or None,
                )
            )
            created += 1
        return created

    async def _add_workouts(self, batch: HealthRawBatch, source: DataSource, payload: dict) -> int:
        created = 0
        for record in payload.get("workouts") or []:
            start = datetime.fromisoformat(record["start_time"])
            end = datetime.fromisoformat(record["end_time"])
            duration = int((end - start).total_seconds() / 60)
            interval = HealthInterval(
                user_id=batch.user_id,
                source_id=source.id,
                batch_id=batch.id,
                type="workout",
                start_time=start,
                end_time=end,
                metadata_json=record.get("metadata"),
            )
            self.db.add(interval)
            await self.db.flush()
            self.db.add(
                HealthWorkout(
                    interval_id=interval.id,
                    activity_type=record["activity_type"],
                    duration_minutes=duration,
                    distance_meters=record.get("distance_meters"),
                    calories=record.get("calories"),
                    avg_heart_rate=record.get("avg_heart_rate"),
                    max_heart_rate=record.get("max_heart_rate"),
                    metadata_json=record.get("metadata"),
                )
            )
            created += 1
        return created

    def _add_nutrition(self, batch: HealthRawBatch, source: DataSource, payload: dict) -> int:
        created = 0
        for record in payload.get("nutrition") or []:
            self.db.add(
                HealthNutritionRecord(
                    user_id=batch.user_id,
                    source_id=source.id,
                    batch_id=batch.id,
                    timestamp=datetime.fromisoformat(record["timestamp"]),
                    meal_type=record.get("meal_type"),
                    name=record.get("name"),
                    energy_kcal=record.get("energy_kcal"),
                    protein_g=record.get("protein_g"),
                    carbohydrates_g=record.get("carbohydrates_g"),
                    fat_g=record.get("fat_g"),
                    metadata_json=record.get("metadata"),
                )
            )
            created += 1
        return created

    def _add_hydration(self, batch: HealthRawBatch, source: DataSource, payload: dict) -> int:
        created = 0
        for record in payload.get("hydration") or []:
            self.db.add(
                HealthHydrationRecord(
                    user_id=batch.user_id,
                    source_id=source.id,
                    batch_id=batch.id,
                    start_time=datetime.fromisoformat(record["start_time"]),
                    end_time=datetime.fromisoformat(record["end_time"]),
                    volume_liters=record["volume_liters"],
                    metadata_json=record.get("metadata"),
                )
            )
            created += 1
        return created

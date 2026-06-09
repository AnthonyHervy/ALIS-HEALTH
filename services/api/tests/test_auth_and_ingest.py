from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models import (
    DataSource,
    HealthHydrationRecord,
    HealthNutritionRecord,
    HealthObservation,
    HealthRawBatch,
    HealthSleepSession,
    HealthWorkout,
)


def sample_batch(now: datetime) -> dict:
    start = now - timedelta(hours=8)
    sleep_start = now - timedelta(hours=9)
    sleep_end = now - timedelta(hours=2)
    workout_start = now - timedelta(hours=3)
    workout_end = now - timedelta(hours=2, minutes=15)

    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": start.isoformat(),
        "data_end": now.isoformat(),
        "heart_rate": [{"timestamp": now.isoformat(), "bpm": 62}],
        "hrv": [{"timestamp": now.isoformat(), "rmssd_ms": 54.5}],
        "steps": [{"start_time": start.isoformat(), "end_time": now.isoformat(), "count": 8200}],
        "sleep": [
            {
                "start_time": sleep_start.isoformat(),
                "end_time": sleep_end.isoformat(),
                "stages": [
                    {
                        "stage": "deep",
                        "start_time": sleep_start.isoformat(),
                        "end_time": (sleep_start + timedelta(hours=1)).isoformat(),
                    },
                    {
                        "stage": "rem",
                        "start_time": (sleep_start + timedelta(hours=1)).isoformat(),
                        "end_time": (sleep_start + timedelta(hours=2)).isoformat(),
                    },
                    {
                        "stage": "light",
                        "start_time": (sleep_start + timedelta(hours=2)).isoformat(),
                        "end_time": sleep_end.isoformat(),
                    },
                ],
            }
        ],
        "workouts": [
            {
                "start_time": workout_start.isoformat(),
                "end_time": workout_end.isoformat(),
                "activity_type": "strength_training",
                "calories": 240,
                "avg_heart_rate": 118,
                "metadata": {"exercise_type_code": 70, "dataOrigin": "com.google.android.apps.fitness"},
            }
        ],
        "nutrition": [
            {
                "timestamp": (now - timedelta(hours=5)).isoformat(),
                "meal_type": "lunch",
                "name": "Lunch",
                "energy_kcal": 720,
                "protein_g": 42,
                "carbohydrates_g": 70,
                "fat_g": 24,
            }
        ],
        "hydration": [
            {
                "start_time": start.isoformat(),
                "end_time": now.isoformat(),
                "volume_liters": 1.4,
            }
        ],
        "weight": [{"timestamp": now.isoformat(), "kg": 78.2}],
        "raw_records": {
            "Nutrition": [{"metadata": {"id": "nutrition-1"}, "energy": {"inKilocalories": 720}}],
            "Hydration": [{"metadata": {"id": "hydration-1"}, "volume": {"inLiters": 1.4}}],
        },
    }


@pytest.mark.asyncio
async def test_pairing_registers_device_and_allows_authenticated_ingest(test_app, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        rejected = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "wrong", "device_name": "Pixel"},
        )
        assert rejected.status_code == 401

        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        assert registered.status_code == 200
        token = registered.json()["device_token"]

        batch = sample_batch(datetime(2026, 5, 19, 12, 0, tzinfo=UTC))
        ingested = await client.post(
            "/api/v1/ingest/health",
            json=batch,
            headers={"Authorization": f"Bearer {token}"},
        )

    assert ingested.status_code == 200
    body = ingested.json()
    assert body["status"] == "completed"
    assert body["records_received"] > 0

    assert (await db_session.execute(select(HealthRawBatch))).scalars().all()
    assert (await db_session.execute(select(DataSource))).scalars().one().source_type == "healthconnect"
    assert len((await db_session.execute(select(HealthObservation))).scalars().all()) >= 4
    assert len((await db_session.execute(select(HealthSleepSession))).scalars().all()) == 1
    assert len((await db_session.execute(select(HealthWorkout))).scalars().all()) == 1
    assert len((await db_session.execute(select(HealthNutritionRecord))).scalars().all()) == 1
    assert len((await db_session.execute(select(HealthHydrationRecord))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_ingest_preserves_activity_and_biometric_metadata(test_app, db_session):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        token = registered.json()["device_token"]
        now = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
        batch = {
            "source_type": "healthconnect",
            "device_name": "Pixel Test",
            "device_id": "pixel-test-1",
            "data_start": (now - timedelta(hours=1)).isoformat(),
            "data_end": now.isoformat(),
            "heart_rate": [
                {
                    "timestamp": now.isoformat(),
                    "bpm": 92,
                    "metadata": {"id": "hr-garmin", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                }
            ],
            "hrv": [
                {
                    "timestamp": now.isoformat(),
                    "rmssd_ms": 41,
                    "metadata": {"id": "hrv-ultrahuman", "dataOrigin": "com.ultrahuman.android"},
                }
            ],
            "steps": [
                {
                    "start_time": (now - timedelta(minutes=20)).isoformat(),
                    "end_time": now.isoformat(),
                    "count": 3504,
                    "metadata": {"id": "steps-garmin", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                }
            ],
            "calories": [
                {
                    "start_time": (now - timedelta(minutes=20)).isoformat(),
                    "end_time": now.isoformat(),
                    "calories": 210,
                    "is_active": True,
                    "metadata": {"id": "cal-garmin", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                }
            ],
            "distance": [
                {
                    "start_time": (now - timedelta(minutes=20)).isoformat(),
                    "end_time": now.isoformat(),
                    "meters": 494,
                    "metadata": {"id": "distance-garmin", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                }
            ],
        }

        ingested = await client.post(
            "/api/v1/ingest/health",
            json=batch,
            headers={"Authorization": f"Bearer {token}"},
        )

    assert ingested.status_code == 200
    rows = await db_session.execute(select(HealthObservation.type, HealthObservation.metadata_json))
    metadata_by_type = {kind: metadata for kind, metadata in rows.all()}
    assert metadata_by_type["steps"]["dataOrigin"] == "com.garmin.android.apps.connectmobile"
    assert metadata_by_type["active_calories"]["dataOrigin"] == "com.garmin.android.apps.connectmobile"
    assert metadata_by_type["distance"]["dataOrigin"] == "com.garmin.android.apps.connectmobile"
    assert metadata_by_type["heart_rate"]["dataOrigin"] == "com.garmin.android.apps.connectmobile"
    assert metadata_by_type["hrv"]["dataOrigin"] == "com.ultrahuman.android"


@pytest.mark.asyncio
async def test_ingest_is_idempotent_for_identical_payload(test_app):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        token = registered.json()["device_token"]
        headers = {"Authorization": f"Bearer {token}"}
        batch = sample_batch(datetime(2026, 5, 19, 12, 0, tzinfo=UTC))

        first = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        second = await client.post("/api/v1/ingest/health", json=batch, headers=headers)

    assert first.status_code == 200
    assert first.json()["records_received"] > 0
    assert second.status_code == 200
    assert second.json()["records_received"] == 0
    assert second.json()["message"] == "duplicate batch"


@pytest.mark.asyncio
async def test_revoke_blocks_subsequent_ingest(test_app):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        token = registered.json()["device_token"]
        headers = {"Authorization": f"Bearer {token}"}

        revoked = await client.post("/api/v1/auth/revoke", headers=headers)
        rejected = await client.post(
            "/api/v1/ingest/health",
            json=sample_batch(datetime(2026, 5, 19, 12, 0, tzinfo=UTC)),
            headers=headers,
        )

    assert revoked.status_code == 200
    assert rejected.status_code == 401

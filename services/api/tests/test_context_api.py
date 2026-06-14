from copy import deepcopy
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from tests.test_auth_and_ingest import sample_batch


def multisource_batch() -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-05-19T00:00:00+00:00",
        "data_end": "2026-05-20T12:00:00+00:00",
        "steps": [
            {"start_time": "2026-05-19T08:00:00+00:00", "end_time": "2026-05-19T20:00:00+00:00", "count": 50554}
        ],
        "sleep": [
            {
                "start_time": "2026-05-18T22:30:00+00:00",
                "end_time": "2026-05-19T05:00:00+00:00",
                "stages": [],
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "sleep-garmin-only"},
            },
            {
                "start_time": "2026-05-19T22:10:00+00:00",
                "end_time": "2026-05-20T05:10:00+00:00",
                "stages": [{"stage": "awake", "start_time": "2026-05-20T02:00:00+00:00", "end_time": "2026-05-20T02:05:00+00:00"}],
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "sleep-garmin"},
            },
            {
                "start_time": "2026-05-19T22:20:00+00:00",
                "end_time": "2026-05-20T05:20:00+00:00",
                "stages": [
                    {"stage": "awake", "start_time": "2026-05-20T01:00:00+00:00", "end_time": "2026-05-20T01:05:00+00:00"},
                    {"stage": "awake", "start_time": "2026-05-20T03:00:00+00:00", "end_time": "2026-05-20T03:05:00+00:00"},
                ],
                "metadata": {"dataOrigin": "com.ultrahuman.android", "id": "sleep-ultrahuman"},
            },
        ],
        "workouts": [
            {
                "start_time": "2026-05-19T07:00:00+00:00",
                "end_time": "2026-05-19T07:45:00+00:00",
                "activity_type": "running",
                "distance_meters": 8000,
                "calories": 600,
                "metadata": {"dataOrigin": "com.google.android.apps.fitness", "id": "run-google"},
            },
            {
                "start_time": "2026-05-19T07:00:00+00:00",
                "end_time": "2026-05-19T07:42:00+00:00",
                "activity_type": "running",
                "distance_meters": 8200,
                "calories": 620,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "run-garmin"},
            },
            {
                "start_time": "2026-05-20T06:30:00+00:00",
                "end_time": "2026-05-20T07:00:00+00:00",
                "activity_type": "strength_training",
                "calories": 180,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "strength-garmin"},
            },
            {
                "start_time": "2026-05-20T08:30:00+00:00",
                "end_time": "2026-05-20T09:00:00+00:00",
                "activity_type": "running_treadmill",
                "distance_meters": 5000,
                "calories": 430,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "run-treadmill-garmin"},
            },
            {
                "start_time": "2026-05-20T09:30:00+00:00",
                "end_time": "2026-05-20T10:00:00+00:00",
                "activity_type": "pilates",
                "calories": 80,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "pilates-garmin"},
            },
            {
                "start_time": "2026-05-20T08:00:00+00:00",
                "end_time": "2026-05-20T08:20:00+00:00",
                "activity_type": "other",
                "calories": 50,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "other-garmin"},
            },
            {
                "start_time": "2026-05-20T10:30:00+00:00",
                "end_time": "2026-05-20T11:00:00+00:00",
                "activity_type": "other",
                "calories": 210,
                "metadata": {
                    "dataOrigin": "com.garmin.android.apps.connectmobile",
                    "id": "rowing-garmin",
                    "exercise_type_code": 53,
                },
            },
        ],
        "raw_records": {
            "Steps": [
                {
                    "startTime": "2026-05-19T08:00:00+00:00",
                    "endTime": "2026-05-19T20:00:00+00:00",
                    "count": 17334,
                    "metadata": {"id": "steps-garmin", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                },
                {
                    "startTime": "2026-05-19T08:00:00+00:00",
                    "endTime": "2026-05-19T20:00:00+00:00",
                    "count": 20204,
                    "metadata": {"id": "steps-android", "dataOrigin": "android"},
                },
                {
                    "startTime": "2026-05-19T08:00:00+00:00",
                    "endTime": "2026-05-19T20:00:00+00:00",
                    "count": 13016,
                    "metadata": {"id": "steps-google", "dataOrigin": "com.google.android.apps.fitness"},
                },
            ]
        },
    }


def distance_only_run_batch(data_end: str = "2026-05-24T13:00:00+00:00") -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-05-23T22:46:28+00:00",
        "data_end": data_end,
        "workouts": [
            {
                "start_time": "2026-05-24T06:04:40+00:00",
                "end_time": "2026-05-24T07:59:59+00:00",
                "activity_type": "running",
                "metadata": {
                    "dataOrigin": "com.garmin.android.apps.connectmobile",
                    "id": "semi-garmin",
                    "clientRecordId": "semi-client",
                },
            }
        ],
        "distance": [
            {
                "start_time": "2026-05-24T06:04:40+00:00",
                "end_time": "2026-05-24T07:59:59+00:00",
                "meters": 21097,
            }
        ],
        "raw_records": {
            "Distance": [
                {
                    "startTime": "2026-05-24T06:04:40+00:00",
                    "endTime": "2026-05-24T07:59:59+00:00",
                    "distance": {"inMeters": 21097},
                    "metadata": {
                        "dataOrigin": "com.garmin.android.apps.connectmobile",
                        "id": "distance-semi-garmin",
                    },
                }
            ]
        },
    }


def life_balance_batch() -> dict:
    batch = distance_only_run_batch()
    batch["sleep"] = [
        {
            "start_time": "2026-05-23T22:42:59+00:00",
            "end_time": "2026-05-24T03:10:59+00:00",
            "stages": [
                {"stage": "awake", "start_time": "2026-05-23T23:12:00+00:00", "end_time": "2026-05-23T23:16:00+00:00"},
                {"stage": "awake", "start_time": "2026-05-24T00:35:00+00:00", "end_time": "2026-05-24T00:39:00+00:00"},
                {"stage": "awake", "start_time": "2026-05-24T01:42:00+00:00", "end_time": "2026-05-24T01:47:00+00:00"},
                {"stage": "awake", "start_time": "2026-05-24T02:58:00+00:00", "end_time": "2026-05-24T03:03:00+00:00"},
            ],
            "metadata": {"dataOrigin": "com.ultrahuman.android", "id": "short-night-ultrahuman"},
        }
    ]
    return batch


def corrected_steps_reliability_batch() -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-06-14T00:00:00+00:00",
        "data_end": "2026-06-14T18:00:00+00:00",
        "raw_records": {
            "Steps": [
                {
                    "startTime": "2026-06-14T08:00:00+00:00",
                    "endTime": "2026-06-14T18:00:00+00:00",
                    "count": 6000,
                    "metadata": {"dataOrigin": "android", "id": "raw-android-steps"},
                },
                {
                    "startTime": "2026-06-14T08:00:00+00:00",
                    "endTime": "2026-06-14T18:00:00+00:00",
                    "count": 15459,
                    "metadata": {
                        "dataOrigin": "com.garmin.android.apps.connectmobile",
                        "id": "raw-garmin-steps",
                    },
                },
            ]
        },
    }


def incomplete_raw_activity_batch() -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-05-28T00:00:00+00:00",
        "data_end": "2026-05-31T08:00:00+00:00",
        "steps": [
            {
                "start_time": "2026-05-29T08:00:00+00:00",
                "end_time": "2026-05-29T20:00:00+00:00",
                "count": 8600,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "normalized-garmin-steps-1"},
            },
            {
                "start_time": "2026-05-30T08:00:00+00:00",
                "end_time": "2026-05-30T20:00:00+00:00",
                "count": 9200,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "normalized-garmin-steps-2"},
            },
        ],
        "raw_records": {
            "Steps": [
                {
                    "startTime": "2026-05-29T08:00:00+00:00",
                    "endTime": "2026-05-29T08:05:00+00:00",
                    "count": 12,
                    "metadata": {
                        "dataOrigin": "com.garmin.android.apps.connectmobile",
                        "id": "partial-garmin-steps",
                    },
                },
                {
                    "startTime": "2026-05-30T08:00:00+00:00",
                    "endTime": "2026-05-30T10:00:00+00:00",
                    "count": 2600,
                    "metadata": {
                        "dataOrigin": "com.garmin.android.apps.connectmobile",
                        "id": "partial-garmin-steps-2",
                    },
                }
            ]
        },
    }


def morning_partial_batch() -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-05-25T00:00:00+00:00",
        "data_end": "2026-05-26T08:00:00+00:00",
        "steps": [
            {
                "start_time": "2026-05-26T06:30:00+00:00",
                "end_time": "2026-05-26T08:00:00+00:00",
                "count": 76,
            }
        ],
        "sleep": [
            {
                "start_time": "2026-05-24T23:00:00+00:00",
                "end_time": "2026-05-25T05:15:00+00:00",
                "stages": [
                    {"stage": "awake", "start_time": "2026-05-25T02:00:00+00:00", "end_time": "2026-05-25T02:05:00+00:00"},
                ],
                "metadata": {"dataOrigin": "com.ultrahuman.android", "id": "sleep-previous-night"},
            }
        ],
        "workouts": [
            {
                "start_time": "2026-05-25T10:00:00+00:00",
                "end_time": "2026-05-25T11:00:00+00:00",
                "activity_type": "running",
                "distance_meters": 9000,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "run-previous-day"},
            }
        ],
        "raw_records": {
            "Steps": [
                {
                    "startTime": "2026-05-25T07:00:00+00:00",
                    "endTime": "2026-05-25T21:00:00+00:00",
                    "count": 18000,
                    "metadata": {"id": "steps-previous-day", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                },
                {
                    "startTime": "2026-05-26T06:30:00+00:00",
                    "endTime": "2026-05-26T08:00:00+00:00",
                    "count": 76,
                    "metadata": {"id": "steps-today-so-far", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                },
            ]
        },
    }


def cardio_metrics_batch() -> dict:
    return {
        "source_type": "healthconnect",
        "device_name": "Pixel Test",
        "device_id": "pixel-test-1",
        "data_start": "2026-06-02T00:00:00+00:00",
        "data_end": "2026-06-03T20:00:00+00:00",
        "heart_rate": [
            {"timestamp": "2026-06-02T07:00:00+00:00", "bpm": 55},
            {"timestamp": "2026-06-03T06:00:00+00:00", "bpm": 50},
            {"timestamp": "2026-06-03T17:30:00+00:00", "bpm": 158},
        ],
        "hrv": [
            {"timestamp": "2026-06-02T05:00:00+00:00", "rmssd_ms": 44.0},
            {"timestamp": "2026-06-03T05:00:00+00:00", "rmssd_ms": 62.0},
        ],
        "resting_heart_rate": [
            {"timestamp": "2026-06-02T05:10:00+00:00", "bpm": 54},
            {"timestamp": "2026-06-03T05:10:00+00:00", "bpm": 53},
        ],
        "vo2_max": [
            {"timestamp": "2026-06-02T08:00:00+00:00", "ml_per_kg_min": 47.7},
            {"timestamp": "2026-06-03T08:00:00+00:00", "ml_per_kg_min": 48.0},
        ],
    }


def scores_by_slug(payload: dict) -> dict:
    return {score["slug"]: score for score in payload["life_balance_scores"]["scores"]}


def assert_life_balance_shape(payload: dict) -> None:
    scores = scores_by_slug(payload)
    assert set(scores) == {"sleep", "recovery", "movement"}
    for score in scores.values():
        assert {"slug", "label", "value", "tone", "confidence", "explanation", "contributors"} <= set(score)
        assert score["tone"] in {"green", "orange", "red"}
        assert 0 <= score["value"] <= 100
        assert isinstance(score["contributors"], list)


@pytest.mark.asyncio
async def test_processing_recompute_builds_context_windows(test_app):
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

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        recomputed = await client.post(
            "/api/v1/processing/recompute",
            json={"windows": ["24h", "7d", "30d"]},
            headers=headers,
        )
        overview = await client.get("/api/v1/context/overview?window=7d", headers=headers)
        sleep = await client.get("/api/v1/context/sleep?window=7d", headers=headers)
        nutrition = await client.get("/api/v1/context/nutrition?window=7d", headers=headers)
        workouts = await client.get("/api/v1/context/workouts?window=7d", headers=headers)

    assert ingested.status_code == 200
    assert recomputed.status_code == 200
    assert recomputed.json()["windows"] == ["24h", "7d", "30d"]

    assert overview.status_code == 200
    overview_json = overview.json()
    assert overview_json["window"] == "7d"
    assert overview_json["sleep"]["sessions"] == 1
    assert overview_json["sleep"]["average_duration_minutes"] == 420
    assert overview_json["sleep"]["latest_sleep_end"].startswith("2026-05-19T10:00:00")
    assert overview_json["nutrition"]["energy_kcal"] == 720
    assert round(overview_json["nutrition"]["average_daily_energy_kcal"], 1) == 102.9
    assert overview_json["nutrition"]["latest_meal_at"].startswith("2026-05-19T07:00:00")
    assert overview_json["workouts"]["sessions"] == 1
    assert overview_json["workouts"]["latest_workout_at"].startswith("2026-05-19T09:45:00")
    assert overview_json["workouts"]["by_activity_type"] == [
        {
            "activity_type": "strength_training",
            "sessions": 1,
            "duration_minutes": 45,
            "calories": 240,
            "distance_meters": 0.0,
        }
    ]
    assert overview_json["workouts"]["running_distance_meters"] == 0.0
    assert overview_json["training_load"]["status"] in {"low", "balanced", "high"}
    assert overview_json["activity"]["steps"] == 8200
    assert overview_json["activity"]["average_daily_steps"] == 1171
    assert overview_json["activity"]["step_records"] == 1
    assert overview_json["activity"]["active_calorie_records"] == 0
    assert overview_json["activity"]["distance_records"] == 0
    series_by_date = {item["date"]: item for item in overview_json["series"]}
    assert list(series_by_date) == [
        "2026-05-13",
        "2026-05-14",
        "2026-05-15",
        "2026-05-16",
        "2026-05-17",
        "2026-05-18",
        "2026-05-19",
    ]
    assert series_by_date["2026-05-19"] == {
        "date": "2026-05-19",
        "steps": 8200,
        "active_calories_kcal": 0.0,
        "distance_meters": 0.0,
        "sleep_minutes": 420,
        "workout_minutes": 45,
        "workouts": 1,
        "energy_kcal": 720.0,
        "protein_g": 42.0,
        "carbohydrates_g": 70.0,
        "fat_g": 24.0,
        "hydration_liters": 1.4,
        "heart_rate_min_bpm": 62.0,
        "heart_rate_max_bpm": 62.0,
        "resting_heart_rate_bpm": 0.0,
        "hrv_rmssd_ms": 54.5,
        "vo2_max_ml_kg_min": 0.0,
    }

    assert sleep.status_code == 200
    assert sleep.json()["total_duration_minutes"] == 420

    assert nutrition.status_code == 200
    assert nutrition.json()["protein_g"] == 42
    assert nutrition.json()["latest_meal_at"].startswith("2026-05-19T07:00:00")

    assert workouts.status_code == 200
    assert workouts.json()["duration_minutes"] == 45


@pytest.mark.asyncio
async def test_context_rejects_unknown_window(test_app):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        token = registered.json()["device_token"]
        response = await client.get(
            "/api/v1/context/overview?window=90d",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_context_uses_domain_sources_and_deduplicates_multisource_data(test_app):
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

        ingested = await client.post("/api/v1/ingest/health", json=multisource_batch(), headers=headers)
        overview = await client.get("/api/v1/context/overview?window=7d", headers=headers)
        sources = await client.get("/api/v1/config/sources", headers=headers)

    assert ingested.status_code == 200
    assert sources.status_code == 200
    source_payload = sources.json()
    assert source_payload["effective_sources"]["activity"] == "android"
    assert source_payload["effective_sources"]["sleep"] == "com.ultrahuman.android"
    assert source_payload["source_badge"] == "Custom"

    assert overview.status_code == 200
    payload = overview.json()
    assert payload["source_badge"] == "Custom"
    assert payload["effective_sources"]["activity"] == "android"
    assert payload["activity"]["steps"] == 20204
    assert payload["activity"]["average_daily_steps"] == 2886
    series_by_date = {item["date"]: item for item in payload["series"]}
    assert list(series_by_date) == [
        "2026-05-14",
        "2026-05-15",
        "2026-05-16",
        "2026-05-17",
        "2026-05-18",
        "2026-05-19",
        "2026-05-20",
    ]
    assert series_by_date["2026-05-19"]["steps"] == 20204
    assert series_by_date["2026-05-19"]["sleep_minutes"] == 390
    assert series_by_date["2026-05-20"]["sleep_minutes"] == 420
    assert series_by_date["2026-05-20"]["workout_minutes"] == 90
    assert payload["sleep"]["sessions"] == 2
    assert payload["sleep"]["average_duration_minutes"] == 405
    assert payload["sleep"]["average_bed_time"] == "00:25"
    assert payload["sleep"]["average_wake_time"] == "07:10"
    assert payload["sleep"]["latest_sleep_start"].startswith("2026-05-19T22:20:00")
    assert payload["sleep"]["latest_sleep_end"].startswith("2026-05-20T05:20:00")
    assert payload["sleep"]["awakenings_count"] == 2
    assert payload["sleep"]["latest_sleep_awakenings_count"] == 2
    assert payload["workouts"]["sessions"] == 4
    assert payload["workouts"]["distance_meters"] == 13200
    assert payload["workouts"]["running_distance_meters"] == 13200
    assert [item["activity_type"] for item in payload["workouts"]["history"]] == ["rowing", "running", "strength_training", "running"]
    assert payload["workouts"]["by_activity_type"] == [
        {
            "activity_type": "rowing",
            "sessions": 1,
            "duration_minutes": 30,
            "calories": 210,
            "distance_meters": 0.0,
        },
        {
            "activity_type": "running",
            "sessions": 2,
            "duration_minutes": 72,
            "calories": 1050,
            "distance_meters": 13200.0,
        },
        {
            "activity_type": "strength_training",
            "sessions": 1,
            "duration_minutes": 30,
            "calories": 180,
            "distance_meters": 0.0,
        },
    ]


@pytest.mark.asyncio
async def test_dashboard_exposes_health_connect_source_diagnostics(test_app):
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

        await client.post("/api/v1/ingest/health", json=multisource_batch(), headers=headers)
        await client.put(
            "/api/v1/config/source-preferences",
            json={"preferences": {"activity": "com.garmin.android.apps.connectmobile"}},
            headers=headers,
        )
        dashboard = await client.post("/api/v1/context/dashboard/refresh", headers=headers)

    assert dashboard.status_code == 200
    diagnostics = dashboard.json()["source_diagnostics"]
    steps = diagnostics["domains"]["activity"]["metrics"]["steps"]

    assert steps["selected_source"] == "com.garmin.android.apps.connectmobile"
    assert steps["selected_source_label"] == "Garmin"
    assert steps["selected_value"] == 17334
    assert steps["latest_received_at"].startswith("2026-05-19T20:00:00")
    assert steps["status"] == "received"

    by_label = {item["source_label"]: item for item in steps["sources"]}
    assert by_label["Garmin"]["total"] == 17334
    assert by_label["Garmin"]["records"] == 1
    assert by_label["Garmin"]["selected"] is True
    assert by_label["Google Fit"]["total"] == 13016
    assert by_label["Google Fit"]["selected"] is False
    assert by_label["Android"]["total"] == 20204
    assert by_label["Android"]["selected"] is False

    hrv = diagnostics["domains"]["biometrics"]["metrics"]["hrv"]
    assert hrv["status"] == "not_received"
    assert hrv["selected_value"] is None


@pytest.mark.asyncio
async def test_context_estimates_steps_and_workout_distance_when_steps_are_missing(test_app):
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

        await client.post("/api/v1/ingest/health", json=distance_only_run_batch(), headers=headers)
        await client.post(
            "/api/v1/ingest/health",
            json=distance_only_run_batch("2026-05-24T13:00:01+00:00"),
            headers=headers,
        )
        overview = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert overview.status_code == 200
    payload = overview.json()
    assert payload["series"] == [
        {
            "date": "2026-05-24",
            "steps": 24820,
            "steps_estimated": True,
            "active_calories_kcal": 0.0,
            "distance_meters": 21097.0,
            "sleep_minutes": 0,
            "workout_minutes": 115,
            "workouts": 1,
            "energy_kcal": 0.0,
            "protein_g": 0.0,
            "carbohydrates_g": 0.0,
            "fat_g": 0.0,
            "hydration_liters": 0.0,
            "heart_rate_min_bpm": 0.0,
            "heart_rate_max_bpm": 0.0,
            "resting_heart_rate_bpm": 0.0,
            "hrv_rmssd_ms": 0.0,
            "vo2_max_ml_kg_min": 0.0,
        }
    ]
    assert payload["activity"]["steps"] == 24820
    assert payload["activity"]["steps_estimated_days"] == 1
    assert payload["workouts"]["sessions"] == 1
    assert payload["workouts"]["running_distance_meters"] == 21097
    assert payload["workouts"]["history"][0]["distance_meters"] == 21097


@pytest.mark.asyncio
async def test_source_preferences_can_override_default_domain_source(test_app):
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

        await client.post("/api/v1/ingest/health", json=multisource_batch(), headers=headers)
        saved = await client.put(
            "/api/v1/config/source-preferences",
            json={"preferences": {"activity": "android", "sleep": "com.garmin.android.apps.connectmobile"}},
            headers=headers,
        )
        overview = await client.get("/api/v1/context/overview?window=7d", headers=headers)

    assert saved.status_code == 200
    assert saved.json()["preferred_sources"]["activity"] == "android"
    assert overview.status_code == 200
    payload = overview.json()
    assert payload["effective_sources"]["activity"] == "android"
    assert payload["effective_sources"]["sleep"] == "com.garmin.android.apps.connectmobile"
    assert payload["activity"]["steps"] == 20204
    assert payload["sleep"]["latest_sleep_start"].startswith("2026-05-19T22:10:00")
    assert payload["sleep"]["awakenings_count"] == 1
    assert payload["sleep"]["latest_sleep_awakenings_count"] == 1


@pytest.mark.asyncio
async def test_today_window_uses_current_paris_calendar_day_only(test_app):
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

        await client.post("/api/v1/ingest/health", json=multisource_batch(), headers=headers)
        overview = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert overview.status_code == 200
    payload = overview.json()
    assert [item["date"] for item in payload["series"]] == ["2026-05-20"]
    assert payload["series"][0]["steps"] == 0
    assert payload["series"][0]["sleep_minutes"] == 420
    assert payload["series"][0]["workout_minutes"] == 90


@pytest.mark.asyncio
async def test_hermes_morning_brief_returns_24h_and_week_context(test_app):
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

        await client.post("/api/v1/ingest/health", json=multisource_batch(), headers=headers)
        response = await client.get("/api/v1/hermes/morning-brief", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["windows"]["last_24h"]["window"] == "24h"
    assert payload["windows"]["week"]["window"] == "7d"
    assert payload["summary"]["sleep"]["last_night_minutes"] == 420
    assert payload["summary"]["activity"]["average_daily_steps_7d"] == 2886
    assert_life_balance_shape(payload["windows"]["last_24h"])
    assert payload["summary"]["life_balance_scores"] == payload["morning_context"]["life_balance_scores"]
    assert payload["summary"]["coach_actions"] == payload["morning_context"]["coach_actions"]
    assert payload["summary"]["coach_actions"][0]["action"]
    assert payload["summary"]["health_synthesis"]["value"] >= 0


@pytest.mark.asyncio
async def test_context_exposes_cardio_hrv_and_vo2_metrics_for_dashboard(test_app):
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

        ingested = await client.post("/api/v1/ingest/health", json=cardio_metrics_batch(), headers=headers)
        overview = await client.get("/api/v1/context/overview?window=7d", headers=headers)

    assert ingested.status_code == 200
    assert overview.status_code == 200
    payload = overview.json()
    biometrics = payload["biometrics"]
    assert biometrics["heart_rate_records"] == 3
    assert biometrics["heart_rate_min_bpm"] == 50.0
    assert biometrics["heart_rate_max_bpm"] == 158.0
    assert round(biometrics["average_heart_rate_bpm"], 1) == 87.7
    assert biometrics["hrv_records"] == 2
    assert biometrics["hrv_rmssd_ms"] == 53.0
    assert biometrics["resting_heart_rate_records"] == 2
    assert biometrics["resting_heart_rate_bpm"] == 53.5
    assert biometrics["vo2_max_records"] == 2
    assert round(biometrics["vo2_max_ml_kg_min"], 2) == 47.85

    series_by_date = {item["date"]: item for item in payload["series"]}
    assert series_by_date["2026-06-02"]["heart_rate_min_bpm"] == 55.0
    assert series_by_date["2026-06-02"]["heart_rate_max_bpm"] == 55.0
    assert series_by_date["2026-06-02"]["resting_heart_rate_bpm"] == 54.0
    assert series_by_date["2026-06-02"]["hrv_rmssd_ms"] == 44.0
    assert series_by_date["2026-06-02"]["vo2_max_ml_kg_min"] == 47.7
    assert series_by_date["2026-06-03"]["heart_rate_min_bpm"] == 50.0
    assert series_by_date["2026-06-03"]["heart_rate_max_bpm"] == 158.0
    assert series_by_date["2026-06-03"]["resting_heart_rate_bpm"] == 53.0
    assert series_by_date["2026-06-03"]["hrv_rmssd_ms"] == 62.0
    assert series_by_date["2026-06-03"]["vo2_max_ml_kg_min"] == 48.0


@pytest.mark.asyncio
async def test_hermes_morning_brief_uses_previous_complete_day_when_today_is_partial(test_app):
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

        await client.post("/api/v1/ingest/health", json=morning_partial_batch(), headers=headers)
        response = await client.get("/api/v1/hermes/morning-brief", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["morning_context"]["is_today_partial"] is True
    assert payload["morning_context"]["recommended_context"] == "previous_day"
    assert payload["morning_context"]["today_so_far"]["steps"] == 76
    assert payload["morning_context"]["previous_day"]["steps"] == 18000
    assert payload["morning_context"]["last_night"]["duration_minutes"] == 375
    assert payload["summary"]["sleep"]["last_night_minutes"] == 375
    assert payload["summary"]["activity"]["steps_reference"] == 18000
    assert payload["summary"]["activity"]["steps_today_so_far"] == 76
    assert payload["summary"]["training"]["sessions_reference"] == 1


@pytest.mark.asyncio
async def test_hermes_morning_brief_treats_wake_day_as_partial_even_with_sleep_logged_today(test_app):
    batch = morning_partial_batch()
    batch["sleep"].append(
        {
            "start_time": "2026-05-25T23:15:00+00:00",
            "end_time": "2026-05-26T06:15:00+00:00",
            "stages": [
                {"stage": "awake", "start_time": "2026-05-26T02:00:00+00:00", "end_time": "2026-05-26T02:05:00+00:00"},
            ],
            "metadata": {"dataOrigin": "com.ultrahuman.android", "id": "sleep-current-wake-day"},
        }
    )

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

        await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/hermes/morning-brief", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["morning_context"]["is_today_partial"] is True
    assert payload["morning_context"]["recommended_context"] == "previous_day"
    assert payload["morning_context"]["last_night"]["duration_minutes"] == 420
    assert payload["summary"]["sleep"]["last_night_minutes"] == 420
    assert payload["summary"]["activity"]["steps_reference"] == 18000
    assert payload["summary"]["activity"]["steps_today_so_far"] == 76

    scores = scores_by_slug(payload["summary"])
    assert scores["sleep"]["value"] >= 85
    assert scores["movement"]["value"] >= 80
    assert payload["summary"]["health_synthesis"]["value"] >= 85
    assert payload["summary"]["health_synthesis"]["tone"] == "green"
    assert payload["summary"]["nutrition"]["status"] == "not_logged"
    assert payload["summary"]["nutrition"]["score_impact"] == "not_penalized"
    assert "ne signifie pas" in payload["summary"]["nutrition"]["message"]


@pytest.mark.asyncio
async def test_morning_scores_use_last_night_even_when_today_already_has_training(test_app):
    batch = morning_partial_batch()
    batch["workouts"].append(
        {
            "start_time": "2026-05-26T07:00:00+00:00",
            "end_time": "2026-05-26T07:42:00+00:00",
            "activity_type": "running",
            "distance_meters": 7000,
            "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "run-today"},
        }
    )

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

        await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/hermes/morning-brief", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    scores = scores_by_slug(payload["summary"])
    assert payload["morning_context"]["is_today_partial"] is True
    assert payload["morning_context"]["recommended_context"] == "previous_day"
    assert payload["morning_context"]["last_night"]["duration_minutes"] == 375
    assert scores["sleep"]["value"] > 0
    assert scores["sleep"]["contributors"][0]["value"] == 375
    assert payload["summary"]["training"]["duration_minutes_reference"] == 60
    assert payload["summary"]["training"]["duration_minutes_today_so_far"] == 42


@pytest.mark.asyncio
async def test_life_balance_scores_are_calibrated_for_short_night_and_half_marathon(test_app):
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

        await client.post("/api/v1/ingest/health", json=life_balance_batch(), headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert_life_balance_shape(payload)
    scores = scores_by_slug(payload)
    assert scores["sleep"]["value"] == 58
    assert scores["sleep"]["tone"] == "orange"
    assert scores["recovery"]["value"] in range(48, 53)
    assert scores["recovery"]["tone"] == "orange"
    assert scores["movement"]["value"] == 100
    assert scores["movement"]["tone"] == "green"
    assert any(item["key"] == "duration_minutes" for item in scores["sleep"]["contributors"])
    assert any(item["key"] == "workout_minutes" for item in scores["recovery"]["contributors"])
    assert any(item["key"] == "steps" for item in scores["movement"]["contributors"])


@pytest.mark.asyncio
async def test_recovery_score_reports_recent_variability_when_available(test_app):
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
        batch = life_balance_batch()
        batch["hrv"] = [
            {"timestamp": "2026-05-24T03:35:00+00:00", "rmssd_ms": 62.0},
            {"timestamp": "2026-05-24T04:05:00+00:00", "rmssd_ms": 58.0},
        ]

        await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert response.status_code == 200
    recovery = scores_by_slug(response.json())["recovery"]
    assert recovery["confidence"] == "medium"
    assert "variabilité cardiaque" in recovery["explanation"]
    assert "HRV" not in recovery["explanation"]
    assert any(item["key"] == "hrv_rmssd_ms" for item in recovery["contributors"])


@pytest.mark.asyncio
async def test_dashboard_context_bundles_windows_sync_and_sources(test_app):
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

        await client.post("/api/v1/ingest/health", json=life_balance_batch(), headers=headers)
        response = await client.get("/api/v1/context/dashboard", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["windows"]["last_24h"]["window"] == "24h"
    assert payload["windows"]["week"]["window"] == "7d"
    assert payload["windows"]["month"]["window"] == "30d"
    assert_life_balance_shape(payload["windows"]["last_24h"])
    assert payload["latest_sync_run"]["status"] == "success"
    assert payload["sync_summary"]["total_runs"] == 1
    assert "detected_sources" in payload["source_config"]
    assert payload["snapshot_version"] == "2026-06-14.1"
    assert payload["snapshot_status"] == "fresh"
    assert payload["snapshot_freshness"]["status"] == "fresh"
    assert payload["snapshot_freshness"]["source_sync_run_id"] == payload["latest_sync_run"]["id"]
    assert payload["coach_summary"]["version"] == "2026-06-14.1"
    assert payload["coach_summary"]["windows"]["last_24h"]["sleep_minutes"] > 0
    assert payload["coach_summary"]["source_reliability"]["activity"]["status"] in {"received", "not_received"}
    assert payload["generated_at"]
    assert payload["computed_at"]
    assert payload["is_stale"] is False
    assert payload["data_status"]["freshness"]["status"] == "fresh"
    assert payload["data_status"]["freshness"]["records_received"] > 0
    assert payload["data_status"]["domains"]["sleep"]["status"] == "measured"
    assert payload["data_status"]["domains"]["activity"]["source"]
    assert payload["data_status"]["domains"]["nutrition"]["status"] == "missing"


@pytest.mark.asyncio
async def test_dashboard_bundle_exposes_data_reliability_for_steps(test_app):
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

        await client.post("/api/v1/ingest/health", json=corrected_steps_reliability_batch(), headers=headers)
        response = await client.post("/api/v1/context/dashboard/refresh", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    steps_reliability = payload["data_reliability"]["metrics"]["steps"]
    assert steps_reliability["status"] == "corrected"
    assert steps_reliability["selected_source_label"] == "Garmin"
    assert steps_reliability["selected_value"] == 15459
    assert payload["coach_summary"]["source_reliability"]["steps"]["status"] == "corrected"


@pytest.mark.asyncio
async def test_dashboard_context_serves_existing_snapshot_without_recomputing(test_app, db_session, monkeypatch):
    from app.models import HealthDashboardSnapshot
    from app.services.context import HealthContextService

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )
        token = registered.json()["device_token"]
        user_id = registered.json()["user_id"]
        headers = {"Authorization": f"Bearer {token}"}

        await client.post("/api/v1/ingest/health", json=life_balance_batch(), headers=headers)
        first = await client.get("/api/v1/context/dashboard", headers=headers)

        async def fail_if_called(*_args, **_kwargs):
            raise AssertionError("dashboard endpoint should serve the stored snapshot")

        monkeypatch.setattr(HealthContextService, "overview", fail_if_called)
        second = await client.get("/api/v1/context/dashboard", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["windows"]["week"]["window"] == "7d"
    snapshot = await db_session.scalar(
        select(HealthDashboardSnapshot).where(HealthDashboardSnapshot.user_id == user_id)
    )
    assert snapshot is not None


@pytest.mark.asyncio
async def test_processing_run_next_computes_pending_dashboard_job(test_app):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Processor"},
        )
        token = registered.json()["device_token"]
        headers = {"Authorization": f"Bearer {token}"}

        await client.post("/api/v1/ingest/health", json=life_balance_batch(), headers=headers)
        processed = await client.post("/api/v1/processing/run-next", headers=headers)
        dashboard = await client.get("/api/v1/context/dashboard", headers=headers)

    assert processed.status_code == 200
    assert processed.json()["status"] == "processed"
    assert processed.json()["snapshot"]["windows"]["last_24h"]["window"] == "24h"
    assert dashboard.json()["is_stale"] is False


@pytest.mark.asyncio
async def test_dashboard_refresh_endpoint_recomputes_snapshot_immediately(test_app):
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

        await client.post("/api/v1/ingest/health", json=morning_partial_batch(), headers=headers)
        response = await client.post("/api/v1/context/dashboard/refresh", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_stale"] is False
    assert payload["morning_context"]["is_today_partial"] is True
    assert payload["source_sync_run_id"] == payload["latest_sync_run"]["id"]


@pytest.mark.asyncio
async def test_morning_context_flags_missing_sleep_without_implying_zero(test_app):
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

        await client.post("/api/v1/ingest/health", json=distance_only_run_batch(), headers=headers)
        response = await client.post("/api/v1/context/dashboard/refresh", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["morning_context"]["status"] == "sleep_missing"
    assert payload["morning_context"]["title"] == "Nuit non mesurée"
    assert "pas de données sommeil" in payload["morning_context"]["message"].lower()
    assert payload["morning_context"]["last_night"]["duration_minutes"] == 0
    assert payload["windows"]["last_24h"]["coach_actions"][0]["slug"] == "sleep_data_missing"
    assert payload["morning_context"]["coach_actions"][0]["slug"] == "sleep_data_missing"


@pytest.mark.asyncio
async def test_daily_activity_supplements_incomplete_raw_steps_from_normalized_observations(test_app):
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

        await client.post("/api/v1/ingest/health", json=incomplete_raw_activity_batch(), headers=headers)
        duplicate_history_batch = deepcopy(incomplete_raw_activity_batch())
        duplicate_history_batch["data_end"] = "2026-05-31T08:05:00+00:00"
        duplicate_history_batch.pop("raw_records")
        await client.post("/api/v1/ingest/health", json=duplicate_history_batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=7d", headers=headers)
        dashboard = await client.post("/api/v1/context/dashboard/refresh", headers=headers)

    assert response.status_code == 200
    series = {day["date"]: day for day in response.json()["series"]}
    assert series["2026-05-29"]["steps"] == 8600
    assert series["2026-05-30"]["steps"] == 9200
    assert response.json()["activity"]["steps_recovered_days"] == 2
    assert dashboard.status_code == 200
    assert dashboard.json()["data_status"]["domains"]["activity"]["status"] == "corrected"
    assert dashboard.json()["data_status"]["domains"]["activity"]["confidence"] == "medium"


@pytest.mark.asyncio
async def test_daily_activity_does_not_recover_garmin_steps_from_unknown_normalized_observations(test_app):
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

        batch = incomplete_raw_activity_batch()
        batch["data_start"] = "2026-06-02T00:00:00+00:00"
        batch["data_end"] = "2026-06-02T18:00:00+00:00"
        batch["steps"] = [
            {
                "start_time": "2026-06-02T15:34:00+00:00",
                "end_time": "2026-06-02T18:00:00+00:00",
                "count": 6834,
            }
        ]
        batch["raw_records"] = {
            "Steps": [
                {
                    "startTime": "2026-06-02T07:18:00+00:00",
                    "endTime": "2026-06-02T07:43:00+00:00",
                    "count": 590,
                    "metadata": {"id": "partial-garmin-steps", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                }
            ]
        }

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert ingested.status_code == 200
    assert response.status_code == 200
    series = {day["date"]: day for day in response.json()["series"]}
    assert series["2026-06-02"]["steps"] == 590
    assert "steps_recovered" not in series["2026-06-02"]
    assert response.json()["activity"]["steps_recovered_days"] == 0


@pytest.mark.asyncio
async def test_daily_activity_keeps_highest_updated_garmin_step_record(test_app):
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

        batch = {
            "source_type": "healthconnect",
            "device_name": "Pixel Test",
            "device_id": "pixel-test-1",
            "data_start": "2026-06-05T00:00:00+00:00",
            "data_end": "2026-06-05T12:00:00+00:00",
            "raw_records": {
                "Steps": [
                    {
                        "startTime": "2026-06-05T06:00:00+00:00",
                        "endTime": "2026-06-05T12:00:00+00:00",
                        "count": 2385,
                        "metadata": {
                            "id": "garmin-steps-today",
                            "dataOrigin": "com.garmin.android.apps.connectmobile",
                        },
                    }
                ]
            },
        }
        updated_batch = deepcopy(batch)
        updated_batch["data_end"] = "2026-06-05T19:00:00+00:00"
        updated_batch["raw_records"]["Steps"][0]["endTime"] = "2026-06-05T19:00:00+00:00"
        updated_batch["raw_records"]["Steps"][0]["count"] = 7420

        first = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        second = await client.post("/api/v1/ingest/health", json=updated_batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=7d", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert response.status_code == 200
    series = {day["date"]: day for day in response.json()["series"]}
    assert series["2026-06-05"]["steps"] == 7420
    assert response.json()["activity"]["steps"] == 7420


@pytest.mark.asyncio
async def test_daily_activity_sums_incremental_normalized_steps_without_duplicate_overlap(test_app):
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

        batch = {
            "source_type": "healthconnect",
            "device_name": "Pixel Test",
            "device_id": "pixel-test-1",
            "data_start": "2026-06-06T06:00:00+00:00",
            "data_end": "2026-06-06T10:00:00+00:00",
            "sync_trigger": "background",
            "sync_mode": "incremental",
            "steps": [
                {
                    "start_time": "2026-06-06T06:00:00+00:00",
                    "end_time": "2026-06-06T08:00:00+00:00",
                    "count": 1200,
                    "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "garmin-steps-1"},
                },
                {
                    "start_time": "2026-06-06T08:00:00+00:00",
                    "end_time": "2026-06-06T10:00:00+00:00",
                    "count": 2500,
                    "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "garmin-steps-2"},
                },
            ],
        }
        overlap_batch = deepcopy(batch)
        overlap_batch["data_start"] = "2026-06-06T08:00:00+00:00"
        overlap_batch["data_end"] = "2026-06-06T13:00:00+00:00"
        overlap_batch["steps"] = [
            batch["steps"][1],
            {
                "start_time": "2026-06-06T10:00:00+00:00",
                "end_time": "2026-06-06T13:00:00+00:00",
                "count": 1587,
                "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "garmin-steps-3"},
            },
        ]

        first = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        second = await client.post("/api/v1/ingest/health", json=overlap_batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert response.status_code == 200
    series = {day["date"]: day for day in response.json()["series"]}
    assert series["2026-06-06"]["steps"] == 5287
    assert response.json()["activity"]["steps"] == 5287


@pytest.mark.asyncio
async def test_daily_activity_recovers_best_normalized_steps_when_effective_source_lags(test_app):
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

        batch = {
            "source_type": "healthconnect",
            "device_name": "Pixel Test",
            "device_id": "pixel-test-1",
            "data_start": "2026-06-14T00:00:00+00:00",
            "data_end": "2026-06-14T18:00:00+00:00",
            "steps": [
                {
                    "start_time": "2026-06-14T08:00:00+00:00",
                    "end_time": "2026-06-14T18:00:00+00:00",
                    "count": 6371,
                    "metadata": {"dataOrigin": "com.garmin.android.apps.connectmobile", "id": "garmin-steps"},
                },
                {
                    "start_time": "2026-06-14T08:00:00+00:00",
                    "end_time": "2026-06-14T18:00:00+00:00",
                    "count": 12362,
                    "metadata": {"dataOrigin": "com.google.android.apps.fitness", "id": "google-steps"},
                },
                {
                    "start_time": "2026-06-14T08:00:00+00:00",
                    "end_time": "2026-06-14T18:00:00+00:00",
                    "count": 16843,
                    "metadata": {"dataOrigin": "com.android.healthconnect.phone.example", "id": "healthconnect-steps"},
                },
            ],
            "raw_records": {
                "Steps": [
                    {
                        "startTime": "2026-06-14T08:00:00+00:00",
                        "endTime": "2026-06-14T18:00:00+00:00",
                        "count": 84,
                        "metadata": {"dataOrigin": "com.google.android.apps.fitness", "id": "raw-google-steps"},
                    }
                ]
            },
        }

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert ingested.status_code == 200
    assert response.status_code == 200
    series = {day["date"]: day for day in response.json()["series"]}
    assert series["2026-06-14"]["steps"] == 16843
    assert series["2026-06-14"]["steps_recovered"] is True
    assert response.json()["activity"]["source"] == "com.android.healthconnect.phone.example"
    assert response.json()["activity"]["steps"] == 16843


@pytest.mark.asyncio
async def test_context_treats_health_connect_swimming_codes_as_training(test_app):
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

        batch = {
            "source_type": "healthconnect",
            "device_name": "Pixel Test",
            "device_id": "pixel-test-1",
            "data_start": "2026-06-05T00:00:00+00:00",
            "data_end": "2026-06-05T13:00:00+00:00",
            "workouts": [
                {
                    "start_time": "2026-06-05T10:00:00+00:00",
                    "end_time": "2026-06-05T10:45:00+00:00",
                    "activity_type": "other",
                    "calories": 320,
                    "metadata": {
                        "id": "swim-garmin",
                        "dataOrigin": "com.garmin.android.apps.connectmobile",
                        "exercise_type_code": 74,
                    },
                }
            ],
        }

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert ingested.status_code == 200
    assert response.status_code == 200
    payload = response.json()
    assert payload["workouts"]["sessions"] == 1
    assert payload["workouts"]["duration_minutes"] == 45
    assert payload["workouts"]["history"][0]["activity_type"] == "swimming"
    assert payload["workouts"]["by_activity_type"][0]["activity_type"] == "swimming"
    series = {day["date"]: day for day in payload["series"]}
    assert series["2026-06-05"]["workouts"] == 1
    assert series["2026-06-05"]["workout_minutes"] == 45


@pytest.mark.asyncio
async def test_context_uses_total_calories_when_active_calories_are_missing(test_app):
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

        batch = incomplete_raw_activity_batch()
        batch["data_start"] = "2026-06-02T00:00:00+00:00"
        batch["data_end"] = "2026-06-02T20:00:00+00:00"
        batch["steps"] = []
        batch["calories"] = [
            {
                "start_time": "2026-06-02T06:00:00+00:00",
                "end_time": "2026-06-02T20:00:00+00:00",
                "calories": 2365.62,
                "is_active": False,
                "metadata": {"id": "total-calories", "dataOrigin": "android"},
            }
        ]
        batch["raw_records"] = {"Steps": []}

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert ingested.status_code == 200
    assert response.status_code == 200
    assert response.json()["activity"]["active_calories_kcal"] == pytest.approx(2365.62)
    assert response.json()["activity"]["average_daily_active_calories_kcal"] == pytest.approx(2365.62)


@pytest.mark.asyncio
async def test_context_keeps_unknown_total_calories_when_activity_source_is_selected(test_app):
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

        batch = incomplete_raw_activity_batch()
        batch["data_start"] = "2026-06-02T00:00:00+00:00"
        batch["data_end"] = "2026-06-02T20:00:00+00:00"
        batch["steps"] = [
            {
                "start_time": "2026-06-02T06:00:00+00:00",
                "end_time": "2026-06-02T20:00:00+00:00",
                "count": 3797,
                "metadata": {"id": "google-fit-steps", "dataOrigin": "com.google.android.apps.fitness"},
            }
        ]
        batch["calories"] = [
            {
                "start_time": "2026-06-02T06:00:00+00:00",
                "end_time": "2026-06-02T20:00:00+00:00",
                "calories": 2365.62,
                "is_active": False,
                "metadata": {"id": "unknown-total-calories"},
            }
        ]
        batch["raw_records"] = {
            "Steps": [
                {
                    "startTime": "2026-06-02T06:00:00+00:00",
                    "endTime": "2026-06-02T20:00:00+00:00",
                    "count": 3797,
                    "metadata": {"id": "raw-google-fit-steps", "dataOrigin": "com.google.android.apps.fitness"},
                }
            ]
        }

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        response = await client.get("/api/v1/context/overview?window=24h", headers=headers)

    assert ingested.status_code == 200
    assert response.status_code == 200
    assert response.json()["effective_sources"]["activity"] == "com.google.android.apps.fitness"
    assert response.json()["activity"]["steps"] == 3797
    assert response.json()["activity"]["active_calories_kcal"] == pytest.approx(2365.62)


@pytest.mark.asyncio
async def test_context_keeps_repeated_unknown_calorie_intervals_without_metadata(test_app, db_session):
    from app.models import HealthObservation, HealthUser
    from app.services.context import HealthContextService

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={"pairing_code": "dev-pairing-code", "device_name": "Pixel"},
        )

    user_id = registered.json()["user_id"]
    assert await db_session.scalar(select(HealthUser).where(HealthUser.id == user_id))
    db_session.add_all(
        [
            HealthObservation(
                user_id=user_id,
                type="calories",
                timestamp=datetime.fromisoformat("2026-06-02T02:00:00+00:00"),
                value=19.24,
                unit="kcal",
                metadata={},
            ),
            HealthObservation(
                user_id=user_id,
                type="calories",
                timestamp=datetime.fromisoformat("2026-06-02T02:15:00+00:00"),
                value=19.24,
                unit="kcal",
                metadata={},
            ),
        ]
    )
    await db_session.commit()

    response = await HealthContextService(db_session).overview(user_id, "24h")

    assert response["activity"]["active_calories_kcal"] == pytest.approx(38.48)

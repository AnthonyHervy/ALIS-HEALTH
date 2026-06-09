from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models import HealthProcessingJob
from tests.test_auth_and_ingest import sample_batch


@pytest.mark.asyncio
async def test_ingest_records_latest_sync_run(test_app):
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
        batch["sync_trigger"] = "manual"
        batch["sync_mode"] = "initial_full_history"
        batch["network_type"] = "wifi"

        ingested = await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        latest = await client.get("/api/v1/sync-runs/latest", headers=headers)

    assert ingested.status_code == 200
    assert latest.status_code == 200
    payload = latest.json()
    assert payload["status"] == "success"
    assert payload["trigger"] == "manual"
    assert payload["sync_mode"] == "initial_full_history"
    assert payload["network_type"] == "wifi"
    assert payload["records_received"] == ingested.json()["records_received"]
    assert payload["batch_id"] == ingested.json()["batch_id"]
    assert payload["duplicate"] is False
    assert payload["data_start"].startswith("2026-05-19T04:00:00")
    assert payload["data_end"].startswith("2026-05-19T12:00:00")


@pytest.mark.asyncio
async def test_sync_run_list_is_newest_first_and_marks_duplicate_batches(test_app):
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
        batch["sync_trigger"] = "background"
        batch["sync_mode"] = "incremental"

        await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        await client.post("/api/v1/ingest/health", json=batch, headers=headers)
        runs = await client.get("/api/v1/sync-runs?limit=2", headers=headers)

    assert runs.status_code == 200
    payload = runs.json()
    assert len(payload["runs"]) == 2
    assert payload["runs"][0]["duplicate"] is True
    assert payload["runs"][0]["records_received"] == 0
    assert payload["runs"][1]["duplicate"] is False


@pytest.mark.asyncio
async def test_sync_run_summary_tracks_recent_history_and_totals(test_app):
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

        manual_batch = sample_batch(datetime(2026, 5, 19, 12, 0, tzinfo=UTC))
        manual_batch["sync_trigger"] = "manual"
        manual_batch["network_type"] = "wifi"
        background_batch = sample_batch(datetime(2026, 5, 19, 13, 0, tzinfo=UTC))
        background_batch["sync_trigger"] = "background"
        background_batch["sync_mode"] = "incremental"
        background_batch["network_type"] = "cellular"

        await client.post("/api/v1/ingest/health", json=manual_batch, headers=headers)
        await client.post("/api/v1/ingest/health", json=background_batch, headers=headers)
        await client.post("/api/v1/ingest/health", json=background_batch, headers=headers)
        summary = await client.get("/api/v1/sync-runs/summary", headers=headers)

    assert summary.status_code == 200
    payload = summary.json()
    assert payload["total_runs"] == 3
    assert payload["success_runs"] == 3
    assert payload["error_runs"] == 0
    assert payload["duplicate_runs"] == 1
    assert payload["records_received"] > 0
    assert payload["last_manual_at"] is not None
    assert payload["last_background_at"] is not None
    assert payload["latest_network_type"] == "cellular"
    assert len(payload["recent_runs"]) == 3
    assert payload["recent_runs"][0]["duplicate"] is True


@pytest.mark.asyncio
async def test_sync_run_report_records_failed_and_skipped_background_attempts(test_app):
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

        failed = await client.post(
            "/api/v1/sync-runs/report",
            json={
                "trigger": "background",
                "sync_mode": "incremental",
                "status": "failed",
                "network_type": "cellular",
                "error_message": "Health Connect background permission missing",
            },
            headers=headers,
        )
        skipped = await client.post(
            "/api/v1/sync-runs/report",
            json={
                "trigger": "background",
                "status": "skipped",
                "error_message": "cooldown",
            },
            headers=headers,
        )
        summary = await client.get("/api/v1/sync-runs/summary", headers=headers)

    assert failed.status_code == 200
    assert skipped.status_code == 200
    assert failed.json()["status"] == "failed"
    payload = summary.json()
    assert payload["total_runs"] == 2
    assert payload["success_runs"] == 0
    assert payload["error_runs"] == 2
    assert payload["last_background_at"] is not None


@pytest.mark.asyncio
async def test_successful_ingest_enqueues_dashboard_processing_job(test_app, db_session):
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

        response = await client.post("/api/v1/ingest/health", json=batch, headers=headers)

    assert response.status_code == 200
    job = await db_session.scalar(select(HealthProcessingJob))
    assert job is not None
    assert job.status == "pending"
    assert job.kind == "dashboard_snapshot"
    assert job.source_sync_run_id is not None

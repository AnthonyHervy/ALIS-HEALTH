from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HealthDashboardSnapshot, HealthProcessingJob, HealthSyncRun
from app.schemas import SyncRunResponse
from app.services.context import HealthContextService
from app.services.sources import SourceConfigService


class ProcessingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def enqueue_dashboard_job(self, user_id: str, source_sync_run_id: str | None = None) -> HealthProcessingJob:
        pending = await self.db.scalar(
            select(HealthProcessingJob).where(
                HealthProcessingJob.user_id == user_id,
                HealthProcessingJob.kind == "dashboard_snapshot",
                HealthProcessingJob.status == "pending",
            )
        )
        if pending is not None:
            pending.source_sync_run_id = source_sync_run_id or pending.source_sync_run_id
            pending.updated_at = datetime.utcnow()
            await self.db.flush()
            return pending

        job = HealthProcessingJob(
            user_id=user_id,
            kind="dashboard_snapshot",
            status="pending",
            source_sync_run_id=source_sync_run_id,
        )
        self.db.add(job)
        await self.db.flush()
        return job

    async def next_pending_job(self) -> HealthProcessingJob | None:
        return await self.db.scalar(
            select(HealthProcessingJob)
            .where(HealthProcessingJob.status == "pending")
            .order_by(HealthProcessingJob.created_at)
            .limit(1)
        )

    async def run_job(self, job: HealthProcessingJob) -> HealthDashboardSnapshot:
        job.status = "running"
        job.attempts = int(job.attempts or 0) + 1
        job.started_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await self.db.flush()
        try:
            snapshot = await self.compute_dashboard_snapshot(job.user_id, job.source_sync_run_id)
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            job.finished_at = datetime.utcnow()
            job.updated_at = datetime.utcnow()
            await self.db.commit()
            raise
        job.status = "completed"
        job.error_message = None
        job.finished_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await self.db.commit()
        return snapshot

    async def latest_dashboard_snapshot(self, user_id: str) -> HealthDashboardSnapshot | None:
        return await self.db.scalar(
            select(HealthDashboardSnapshot)
            .where(HealthDashboardSnapshot.user_id == user_id)
            .order_by(HealthDashboardSnapshot.computed_at.desc())
            .limit(1)
        )

    async def compute_dashboard_snapshot(self, user_id: str, source_sync_run_id: str | None = None) -> HealthDashboardSnapshot:
        context = HealthContextService(self.db)
        source_service = SourceConfigService(self.db)
        windows = {
            "last_24h": await context.overview(user_id, "24h"),
            "week": await context.overview(user_id, "7d"),
            "month": await context.overview(user_id, "30d"),
        }
        payload = {
            "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
            "windows": windows,
            "morning_context": context.morning_context(windows),
            "source_config": await source_service.config(user_id),
        }
        snapshot = await self.latest_dashboard_snapshot(user_id)
        computed_at = datetime.utcnow()
        if snapshot is None:
            snapshot = HealthDashboardSnapshot(
                user_id=user_id,
                source_sync_run_id=source_sync_run_id,
                payload=payload,
                computed_at=computed_at,
            )
            self.db.add(snapshot)
        else:
            snapshot.source_sync_run_id = source_sync_run_id
            snapshot.payload = payload
            snapshot.computed_at = computed_at
        await self.db.flush()
        return snapshot

    async def dashboard_response(self, user_id: str, latest: HealthSyncRun | None, summary: object) -> dict:
        snapshot = await self.latest_dashboard_snapshot(user_id)
        if snapshot is None:
            snapshot = await self.compute_dashboard_snapshot(user_id, latest.id if latest else None)
            await self.db.commit()

        latest_payload = SyncRunResponse.model_validate(latest).model_dump(mode="json") if latest else None
        payload = dict(snapshot.payload)
        if "morning_context" not in payload and "windows" in payload:
            payload["morning_context"] = HealthContextService(self.db).morning_context(payload["windows"])
        payload["computed_at"] = snapshot.computed_at.replace(tzinfo=timezone.utc).isoformat()
        payload["source_sync_run_id"] = snapshot.source_sync_run_id
        payload["is_stale"] = bool(latest and snapshot.source_sync_run_id != latest.id)
        payload["latest_sync_run"] = latest_payload
        payload["sync_summary"] = summary.model_dump(mode="json")
        payload["data_status"] = self._data_status(payload, latest_payload, payload["sync_summary"])
        return payload

    def _data_status(self, payload: dict, latest_payload: dict | None, summary: dict) -> dict:
        windows = payload.get("windows") or {}
        last_24h = windows.get("last_24h") or {}
        week = windows.get("week") or {}
        morning = payload.get("morning_context") or {}
        freshness = self._freshness_status(payload, latest_payload, summary)
        return {
            "freshness": freshness,
            "domains": {
                "sleep": self._sleep_status(last_24h, morning),
                "activity": self._activity_status(last_24h, week),
                "workouts": self._workout_status(last_24h),
                "nutrition": self._nutrition_status(last_24h),
            },
        }

    def _freshness_status(self, payload: dict, latest_payload: dict | None, summary: dict) -> dict:
        last_success_at = summary.get("last_success_at")
        is_stale = bool(payload.get("is_stale"))
        if not last_success_at:
            status = "empty"
            label = "Aucune synchronisation réussie"
            explanation = "Le cockpit ne dispose pas encore de données synchronisées."
        elif is_stale:
            status = "stale"
            label = "Mise à jour en arrière-plan"
            explanation = "De nouvelles données sont arrivées, mais le snapshot affiché doit être recalculé."
        else:
            status = "fresh"
            label = "Données à jour"
            explanation = "Le snapshot affiché correspond à la dernière synchronisation connue."
        return {
            "status": status,
            "label": label,
            "explanation": explanation,
            "computed_at": payload.get("computed_at"),
            "last_success_at": last_success_at,
            "last_manual_at": summary.get("last_manual_at"),
            "last_background_at": summary.get("last_background_at"),
            "latest_run_status": latest_payload.get("status") if latest_payload else None,
            "records_received": int(summary.get("records_received") or 0),
            "is_stale": is_stale,
        }

    def _sleep_status(self, overview: dict, morning: dict) -> dict:
        sleep = overview.get("sleep") or {}
        last_night = morning.get("last_night") or {}
        minutes = int(
            last_night.get("duration_minutes")
            or sleep.get("average_duration_minutes")
            or sleep.get("total_duration_minutes")
            or 0
        )
        source = last_night.get("source") or sleep.get("source")
        if minutes <= 0:
            return self._domain_status(
                "missing",
                "low",
                source,
                "Sommeil non mesuré",
                "Aucune nuit exploitable n'est présente dans la fenêtre récente.",
            )
        return self._domain_status(
            "measured",
            "high" if source else "medium",
            source,
            "Sommeil mesuré",
            "Une nuit récente est disponible pour le calcul du sommeil et de la récupération.",
        )

    def _activity_status(self, overview: dict, week_overview: dict | None = None) -> dict:
        activity = overview.get("activity") or {}
        week_activity = (week_overview or {}).get("activity") or {}
        steps = int(activity.get("steps") or 0)
        estimated_days = int(activity.get("steps_estimated_days") or 0)
        recovered_days = int(activity.get("steps_recovered_days") or 0) or int(week_activity.get("steps_recovered_days") or 0)
        source = activity.get("source")
        if steps <= 0:
            return self._domain_status(
                "missing",
                "low",
                source,
                "Activité non mesurée",
                "Aucun pas ou distance exploitable n'est présent dans la fenêtre récente.",
            )
        if estimated_days:
            return self._domain_status(
                "estimated",
                "medium",
                source,
                "Activité estimée",
                "Une partie des pas est estimée depuis la distance faute de pas fiables.",
            )
        if recovered_days:
            return self._domain_status(
                "corrected",
                "medium",
                source,
                "Activité corrigée",
                "Des journées partielles ont été reconstruites depuis les observations normalisées.",
            )
        return self._domain_status(
            "measured",
            "high" if source else "medium",
            source,
            "Activité mesurée",
            "Les pas proviennent de la source sélectionnée.",
        )

    def _workout_status(self, overview: dict) -> dict:
        workouts = overview.get("workouts") or {}
        sessions = int(workouts.get("sessions") or 0)
        source = workouts.get("source")
        if sessions <= 0:
            return self._domain_status(
                "none",
                "high" if source else "medium",
                source,
                "Aucun entraînement détecté",
                "Aucune séance sportive n'est présente sur la fenêtre affichée.",
            )
        return self._domain_status(
            "measured",
            "high" if source else "medium",
            source,
            "Entraînements mesurés",
            "Les entraînements proviennent de la source sélectionnée.",
        )

    def _nutrition_status(self, overview: dict) -> dict:
        nutrition = overview.get("nutrition") or {}
        meals = int(nutrition.get("meals") or 0)
        energy = float(nutrition.get("energy_kcal") or 0)
        if meals <= 0 and energy <= 0:
            return self._domain_status(
                "missing",
                "low",
                None,
                "Nutrition non renseignée",
                "Aucun repas exploitable n'est présent dans la fenêtre récente.",
            )
        return self._domain_status(
            "measured",
            "medium",
            None,
            "Nutrition renseignée",
            "Des repas ou apports nutritionnels sont disponibles.",
        )

    def _domain_status(self, status: str, confidence: str, source: str | None, label: str, explanation: str) -> dict:
        return {
            "status": status,
            "confidence": confidence,
            "source": source,
            "label": label,
            "explanation": explanation,
        }

    async def clear_dashboard_jobs(self, user_id: str) -> None:
        await self.db.execute(
            delete(HealthProcessingJob).where(
                HealthProcessingJob.user_id == user_id,
                HealthProcessingJob.kind == "dashboard_snapshot",
                HealthProcessingJob.status == "pending",
            )
        )

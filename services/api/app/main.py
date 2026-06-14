import json
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.core.database import engine, get_session
from app.deps import current_token, current_user
from app.models import HealthSyncRun, HealthUser, NutritionFoodReference, NutritionMeal
from app.models import NutritionAnalysisJob
from app.schemas import (
    AgentPromptRequest,
    AgentPromptResponse,
    CoachChatRequest,
    CoachChatResponse,
    CoachGoalsRequest,
    CoachGoalsResponse,
    CoachTodayAdviceResponse,
    HealthBatchRequest,
    HealthBatchResponse,
    NutritionDatasetSourceStatus,
    NutritionDatasetStatusResponse,
    NutritionDiagnosticResponse,
    NutritionJobDiagnosticResponse,
    NutritionMealListResponse,
    NutritionMealResponse,
    NutritionMealUpdateRequest,
    NutritionOllamaDiagnosticResponse,
    NutritionFoodReferenceResponse,
    NutritionFoodSearchResponse,
    RecomputeRequest,
    RecomputeResponse,
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    SourceConfigResponse,
    SourcePreferencesRequest,
    SyncRunReportRequest,
    SyncRunListResponse,
    SyncRunResponse,
    SyncRunSummaryResponse,
)
from app.services.agent_settings import AgentSettingsService
from app.services.auth import AuthService
from app.services.coach import CoachService
from app.services.context import HealthContextService
from app.services.normalizer import HealthNormalizer
from app.services.nutrition.analysis import NutritionAnalysisService
from app.services.nutrition.meals import NutritionMealService
from app.services.nutrition.references import NutritionReferenceService
from app.services.ollama import OllamaClient
from app.services.processing import ProcessingService
from app.services.sources import SourceConfigService


def requested_language(
    payload: CoachChatRequest | None = None,
    http_request: Request | None = None,
) -> str:
    if payload and payload.language in {"fr", "en"}:
        return payload.language
    header = (http_request.headers.get("accept-language") if http_request else "") or ""
    primary = header.split(",", 1)[0].split(";", 1)[0].strip().lower()
    if primary.startswith("en"):
        return "en"
    return "fr"


def create_app(settings: Settings = default_settings) -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.debug else settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.rate_limit_buckets = {}

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        limit = int(getattr(request.app.state.settings, "api_rate_limit_per_minute", 0) or 0)
        if limit <= 0 or request.url.path in {"/health/live", "/health/ready"}:
            return await call_next(request)

        window_seconds = int(getattr(request.app.state.settings, "api_rate_limit_window_seconds", 60) or 60)
        authorization = request.headers.get("authorization") or ""
        if authorization.lower().startswith("bearer "):
            key = f"token:{authorization.split(' ', 1)[1].strip()}"
        else:
            client_host = request.client.host if request.client else "unknown"
            key = f"ip:{client_host}"

        now = monotonic()
        buckets = request.app.state.rate_limit_buckets
        bucket = buckets.get(key)
        if bucket is None or now >= bucket["reset_at"]:
            bucket = {"count": 0, "reset_at": now + window_seconds}
            buckets[key] = bucket
        if bucket["count"] >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded"},
                headers={
                    "Retry-After": str(max(1, int(bucket["reset_at"] - now))),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
        bucket["count"] += 1
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - bucket["count"]))
        return response

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    def coach_service(db: AsyncSession) -> CoachService:
        llm = OllamaClient(
            settings.health_llm_base_url,
            settings.health_llm_model,
            timeout_seconds=settings.health_llm_timeout_seconds,
            context_tokens=settings.health_llm_context_tokens,
            keep_alive=settings.health_llm_keep_alive,
            think=settings.health_llm_think,
        )
        return CoachService(
            HealthContextService(db),
            llm,
            model=settings.health_llm_model,
            advice_max_tokens=settings.health_llm_advice_max_tokens,
            chat_max_tokens=settings.health_llm_chat_max_tokens,
            advice_timeout_seconds=settings.health_llm_advice_timeout_seconds,
            stream_first_token_timeout_seconds=settings.health_llm_stream_first_token_timeout_seconds,
            agent_settings=AgentSettingsService(db),
        )

    @app.get("/health/live")
    async def live():
        return {"status": "healthy", "app": settings.app_name}

    @app.get("/health/ready")
    async def ready():
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            return JSONResponse(status_code=503, content={"status": "unready"})
        return {"status": "ready", "app": settings.app_name}

    @app.post(f"{settings.api_v1_prefix}/auth/register", response_model=RegisterDeviceResponse)
    async def register_device(
        request: RegisterDeviceRequest,
        db: AsyncSession = Depends(get_session),
    ):
        user_id, token = await AuthService(db, settings).register_device(
            request.pairing_code,
            request.device_name,
        )
        return RegisterDeviceResponse(user_id=user_id, device_token=token)

    @app.post(f"{settings.api_v1_prefix}/auth/revoke")
    async def revoke_device(
        token: str = Depends(current_token),
        db: AsyncSession = Depends(get_session),
    ):
        await AuthService(db, settings).revoke_token(token)
        return {"status": "revoked"}

    @app.post(f"{settings.api_v1_prefix}/auth/rotate", response_model=RegisterDeviceResponse)
    async def rotate_device(
        token: str = Depends(current_token),
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        user_id, replacement = await AuthService(db, settings).rotate_token(token, user.id)
        return RegisterDeviceResponse(user_id=user_id, device_token=replacement)

    @app.post(f"{settings.api_v1_prefix}/ingest/health", response_model=HealthBatchResponse)
    async def ingest_health(
        request: HealthBatchRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        batch, records, duplicate, sync_run = await HealthNormalizer(db).ingest_batch(user.id, request)
        if not duplicate:
            await ProcessingService(db).enqueue_dashboard_job(user.id, sync_run.id)
            await db.commit()
        return HealthBatchResponse(
            batch_id=batch.id,
            status=batch.status,
            records_received=records,
            message="duplicate batch" if duplicate else "batch ingested",
        )

    @app.post(f"{settings.api_v1_prefix}/sync-runs/report", response_model=SyncRunResponse)
    async def report_sync_run(
        request: SyncRunReportRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        sync_run = HealthSyncRun(
            user_id=user.id,
            trigger=request.trigger,
            sync_mode=request.sync_mode,
            status=request.status,
            records_received=request.records_received,
            duplicate=request.duplicate,
            data_start=request.data_start,
            data_end=request.data_end,
            network_type=request.network_type,
            error_message=request.error_message,
        )
        db.add(sync_run)
        await db.commit()
        await db.refresh(sync_run)
        return sync_run

    @app.get(f"{settings.api_v1_prefix}/sync-runs/latest", response_model=SyncRunResponse | None)
    async def latest_sync_run(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await db.scalar(
            select(HealthSyncRun)
            .where(HealthSyncRun.user_id == user.id)
            .order_by(desc(HealthSyncRun.created_at))
            .limit(1)
        )

    @app.get(f"{settings.api_v1_prefix}/sync-runs/summary", response_model=SyncRunSummaryResponse)
    async def sync_run_summary(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await build_sync_run_summary(db, user.id)

    @app.get(f"{settings.api_v1_prefix}/sync-runs", response_model=SyncRunListResponse)
    async def sync_runs(
        limit: int = 20,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        limit = max(1, min(limit, 100))
        result = await db.execute(
            select(HealthSyncRun)
            .where(HealthSyncRun.user_id == user.id)
            .order_by(desc(HealthSyncRun.created_at))
            .limit(limit)
        )
        return SyncRunListResponse(runs=list(result.scalars()))

    @app.get(f"{settings.api_v1_prefix}/config/sources", response_model=SourceConfigResponse)
    async def source_config(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await SourceConfigService(db).config(user.id)

    @app.put(f"{settings.api_v1_prefix}/config/source-preferences", response_model=SourceConfigResponse)
    async def update_source_preferences(
        request: SourcePreferencesRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        response = await SourceConfigService(db).set_preferences(user.id, request.preferences)
        await ProcessingService(db).enqueue_dashboard_job(user.id)
        await db.commit()
        return response

    @app.get(f"{settings.api_v1_prefix}/config/agent-prompt", response_model=AgentPromptResponse)
    async def agent_prompt(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await AgentSettingsService(db).prompt_response(user.id)

    @app.put(f"{settings.api_v1_prefix}/config/agent-prompt", response_model=AgentPromptResponse)
    async def update_agent_prompt(
        request: AgentPromptRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        response = await AgentSettingsService(db).save_prompt(user.id, request.prompt)
        await db.commit()
        return response

    @app.get(f"{settings.api_v1_prefix}/config/coach-goals", response_model=CoachGoalsResponse)
    async def coach_goals(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await AgentSettingsService(db).goals_response(user.id)

    @app.put(f"{settings.api_v1_prefix}/config/coach-goals", response_model=CoachGoalsResponse)
    async def update_coach_goals(
        request: CoachGoalsRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        response = await AgentSettingsService(db).save_goals(
            user.id,
            [goal.model_dump() for goal in request.goals],
        )
        await db.commit()
        return response

    @app.post(f"{settings.api_v1_prefix}/processing/recompute", response_model=RecomputeResponse)
    async def recompute(
        request: RecomputeRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        written = await HealthContextService(db).recompute(user.id, list(request.windows))
        latest = await latest_sync_run_for_user(db, user.id)
        await ProcessingService(db).compute_dashboard_snapshot(user.id, latest.id if latest else None)
        await db.commit()
        return RecomputeResponse(windows=list(request.windows), aggregates_written=written)

    @app.post(f"{settings.api_v1_prefix}/processing/run-next")
    async def processing_run_next(
        _user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        service = ProcessingService(db)
        job = await service.next_pending_job()
        if job is None:
            return {"status": "idle", "job_id": None, "snapshot": None}
        snapshot = await service.run_job(job)
        return {"status": "processed", "job_id": job.id, "snapshot": snapshot.payload}

    @app.get(f"{settings.api_v1_prefix}/context/overview")
    async def context_overview(
        window: str = "7d",
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await HealthContextService(db).overview(user.id, window)

    @app.get(f"{settings.api_v1_prefix}/context/dashboard")
    async def context_dashboard(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        latest = await latest_sync_run_for_user(db, user.id)
        summary = await build_sync_run_summary(db, user.id)
        return await ProcessingService(db).dashboard_response(user.id, latest, summary)

    @app.post(f"{settings.api_v1_prefix}/context/dashboard/refresh")
    async def context_dashboard_refresh(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        latest = await latest_sync_run_for_user(db, user.id)
        service = ProcessingService(db)
        await service.clear_dashboard_jobs(user.id)
        await service.compute_dashboard_snapshot(user.id, latest.id if latest else None)
        await db.commit()
        summary = await build_sync_run_summary(db, user.id)
        return await service.dashboard_response(user.id, latest, summary)

    @app.get(f"{settings.api_v1_prefix}/context/sleep")
    async def context_sleep(
        window: str = "7d",
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await HealthContextService(db).sleep(user.id, window)

    @app.get(f"{settings.api_v1_prefix}/context/nutrition")
    async def context_nutrition(
        window: str = "7d",
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await HealthContextService(db).nutrition(user.id, window)

    @app.post(
        f"{settings.api_v1_prefix}/nutrition/meals",
        response_model=NutritionMealResponse,
        status_code=201,
    )
    async def create_nutrition_meal(
        photos: list[UploadFile] = File(...),
        consumed_at: datetime | None = Form(default=None),
        meal_type: str | None = Form(default=None),
        notes: str | None = Form(default=None),
        barcode: str | None = Form(default=None),
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).create_meal(user, photos, consumed_at, meal_type, notes, barcode)

    @app.get(f"{settings.api_v1_prefix}/nutrition/meals", response_model=NutritionMealListResponse)
    async def list_nutrition_meals(
        limit: int = 50,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).list_meals(user, limit)

    @app.get(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}", response_model=NutritionMealResponse)
    async def get_nutrition_meal(
        meal_id: str,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).response(meal_id, user.id)

    @app.get(f"{settings.api_v1_prefix}/nutrition/foods/search", response_model=NutritionFoodSearchResponse)
    async def search_nutrition_foods(
        q: str,
        limit: int = 20,
        _user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        foods = await NutritionReferenceService(db).search(q, limit)
        return NutritionFoodSearchResponse(
            foods=[
                NutritionFoodReferenceResponse(
                    id=food.id,
                    source=food.source,
                    source_id=food.source_id,
                    barcode=food.barcode,
                    name=food.name,
                    energy_kcal_100g=food.energy_kcal_100g,
                    protein_g_100g=food.protein_g_100g,
                    carbohydrates_g_100g=food.carbohydrates_g_100g,
                    fat_g_100g=food.fat_g_100g,
                    dataset_version=food.dataset_version,
                )
                for food in foods
            ]
        )

    async def nutrition_dataset_status_payload(db: AsyncSession) -> NutritionDatasetStatusResponse:
        result = await db.execute(
            select(
                NutritionFoodReference.source,
                NutritionFoodReference.dataset_version,
                func.count(NutritionFoodReference.id),
            )
            .group_by(NutritionFoodReference.source, NutritionFoodReference.dataset_version)
            .order_by(NutritionFoodReference.source, NutritionFoodReference.dataset_version)
        )
        grouped: dict[str, dict[str, object]] = {}
        total = 0
        for source, dataset_version, count in result.all():
            source_status = grouped.setdefault(source, {"reference_count": 0, "dataset_versions": []})
            source_status["reference_count"] = int(source_status["reference_count"]) + int(count)
            source_status["dataset_versions"].append(dataset_version)
            total += int(count)
        sources = [
            NutritionDatasetSourceStatus(
                source=source,
                reference_count=int(payload["reference_count"]),
                dataset_versions=list(payload["dataset_versions"]),
            )
            for source, payload in grouped.items()
        ]
        loaded_sources = {source.source for source in sources}
        return NutritionDatasetStatusResponse(
            ciqual_loaded="ciqual" in loaded_sources,
            openfoodfacts_loaded="openfoodfacts" in loaded_sources,
            total_references=total,
            sources=sources,
        )

    async def nutrition_ollama_diagnostic_payload() -> NutritionOllamaDiagnosticResponse:
        base_url = settings.nutrition_llm_base_url.rstrip("/")
        model = settings.nutrition_vision_model
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{base_url}/api/tags")
                response.raise_for_status()
            models = response.json().get("models") or []
            model_names = {str(item.get("name") or "") for item in models if isinstance(item, dict)}
            return NutritionOllamaDiagnosticResponse(
                base_url=base_url,
                model=model,
                reachable=True,
                model_available=model in model_names,
            )
        except Exception as exc:
            return NutritionOllamaDiagnosticResponse(
                base_url=base_url,
                model=model,
                reachable=False,
                model_available=False,
                error_message=str(exc),
            )

    async def nutrition_job_diagnostic_payload(db: AsyncSession) -> NutritionJobDiagnosticResponse:
        result = await db.execute(
            select(NutritionAnalysisJob.status, func.count(NutritionAnalysisJob.id))
            .join(NutritionMeal, NutritionMeal.id == NutritionAnalysisJob.meal_id)
            .where(
                (NutritionAnalysisJob.status != "failed")
                | ((NutritionAnalysisJob.status == "failed") & (NutritionMeal.status == "error"))
            )
            .group_by(NutritionAnalysisJob.status)
        )
        counts = {status: int(count) for status, count in result.all()}
        return NutritionJobDiagnosticResponse(
            pending=counts.get("pending", 0),
            running=counts.get("running", 0),
            failed=counts.get("failed", 0),
        )

    @app.get(f"{settings.api_v1_prefix}/nutrition/datasets/status", response_model=NutritionDatasetStatusResponse)
    async def nutrition_dataset_status(
        _user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await nutrition_dataset_status_payload(db)

    @app.get(f"{settings.api_v1_prefix}/nutrition/diagnostics", response_model=NutritionDiagnosticResponse)
    async def nutrition_diagnostics(
        _user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return NutritionDiagnosticResponse(
            api_status="ok",
            datasets=await nutrition_dataset_status_payload(db),
            ollama=await nutrition_ollama_diagnostic_payload(),
            jobs=await nutrition_job_diagnostic_payload(db),
        )

    @app.patch(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}", response_model=NutritionMealResponse)
    async def update_nutrition_meal(
        meal_id: str,
        request: NutritionMealUpdateRequest,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).update_meal(meal_id, user, request)

    @app.post(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}/validate", response_model=NutritionMealResponse)
    async def validate_nutrition_meal(
        meal_id: str,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).validate_meal(meal_id, user)

    @app.post(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}/reanalyze", response_model=NutritionMealResponse)
    async def reanalyze_nutrition_meal(
        meal_id: str,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await NutritionMealService(db, settings).reanalyze_meal(meal_id, user)

    @app.delete(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}", status_code=204)
    async def delete_nutrition_meal(
        meal_id: str,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        await NutritionMealService(db, settings).delete_meal(meal_id, user)

    @app.get(f"{settings.api_v1_prefix}/nutrition/meals/{{meal_id}}/photos/{{photo_id}}/thumbnail")
    async def nutrition_meal_thumbnail(
        meal_id: str,
        photo_id: str,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        photo = await NutritionMealService(db, settings).photo_for_user(meal_id, photo_id, user.id)
        path = Path(photo.thumbnail_path or "")
        if not path.exists():
            raise HTTPException(status_code=404, detail="Nutrition thumbnail not found")
        return FileResponse(path, media_type=photo.content_type or "image/jpeg")

    @app.post(f"{settings.api_v1_prefix}/nutrition/processing/run-next")
    async def nutrition_processing_run_next(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        meal = await NutritionAnalysisService(db, settings=settings).run_next(user_id=user.id, raise_on_error=False)
        if meal is None:
            return {"status": "idle", "meal_id": None}
        response = await NutritionMealService(db, settings).response(meal.id, user.id)
        return {"status": meal.status, "meal_id": meal.id, "analysis_job": response.analysis_job}

    @app.get(f"{settings.api_v1_prefix}/context/workouts")
    async def context_workouts(
        window: str = "7d",
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await HealthContextService(db).workouts(user.id, window)

    @app.get(f"{settings.api_v1_prefix}/hermes/morning-brief")
    async def hermes_morning_brief(
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await HealthContextService(db).morning_brief(user.id)

    @app.get(f"{settings.api_v1_prefix}/coach/today-advice", response_model=CoachTodayAdviceResponse)
    async def coach_today_advice(
        http_request: Request,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await coach_service(db).today_advice(user.id, language=requested_language(http_request=http_request))

    @app.get(f"{settings.api_v1_prefix}/coach/status")
    async def coach_status(
        _user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        return await coach_service(db).llm.status()

    @app.post(f"{settings.api_v1_prefix}/coach/chat", response_model=CoachChatResponse)
    async def coach_chat(
        payload: CoachChatRequest,
        http_request: Request,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        response = await coach_service(db).chat(
            user.id,
            payload.message,
            payload.history,
            payload.mode,
            language=requested_language(payload, http_request),
        )
        return CoachChatResponse(
            version="healthconnect.coach.chat.v1",
            generated_at=datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
            model=settings.health_llm_model,
            response=response,
            fallback=False,
        )

    @app.post(f"{settings.api_v1_prefix}/coach/chat/stream")
    async def coach_chat_stream(
        payload: CoachChatRequest,
        http_request: Request,
        user: HealthUser = Depends(current_user),
        db: AsyncSession = Depends(get_session),
    ):
        language = requested_language(payload, http_request)

        async def events():
            yield "event: meta\n"
            yield "data: " + json.dumps(
                {
                    "model": settings.health_llm_model,
                    "version": "healthconnect.coach.chat_stream.v1",
                }
            ) + "\n\n"
            try:
                async for chunk in coach_service(db).stream_chat(
                    user.id,
                    payload.message,
                    payload.history,
                    payload.mode,
                    language=language,
                ):
                    yield "event: delta\n"
                    yield "data: " + json.dumps({"text": chunk}, ensure_ascii=False) + "\n\n"
                yield "event: done\n"
                yield "data: {}\n\n"
            except Exception as exc:
                yield "event: error\n"
                yield "data: " + json.dumps({"message": str(exc)}, ensure_ascii=False) + "\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")

    return app


async def latest_sync_run_for_user(db: AsyncSession, user_id: str) -> HealthSyncRun | None:
    return await db.scalar(
        select(HealthSyncRun)
        .where(HealthSyncRun.user_id == user_id)
        .order_by(desc(HealthSyncRun.created_at))
        .limit(1)
    )


async def build_sync_run_summary(db: AsyncSession, user_id: str) -> SyncRunSummaryResponse:
    result = await db.execute(
        select(HealthSyncRun)
        .where(HealthSyncRun.user_id == user_id)
        .order_by(desc(HealthSyncRun.created_at))
    )
    runs = list(result.scalars())
    return SyncRunSummaryResponse(
        total_runs=len(runs),
        success_runs=sum(1 for run in runs if run.status == "success"),
        error_runs=sum(1 for run in runs if run.status != "success"),
        duplicate_runs=sum(1 for run in runs if run.duplicate),
        records_received=sum(run.records_received or 0 for run in runs),
        last_success_at=next((run.created_at for run in runs if run.status == "success"), None),
        last_manual_at=next((run.created_at for run in runs if run.trigger == "manual"), None),
        last_background_at=next((run.created_at for run in runs if run.trigger == "background"), None),
        latest_network_type=next((run.network_type for run in runs if run.network_type), None),
        recent_runs=runs[:10],
    )


app = create_app()

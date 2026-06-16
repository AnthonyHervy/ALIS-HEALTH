from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    HealthDailyAggregate,
    HealthDashboardSnapshot,
    HealthHydrationRecord,
    HealthInterval,
    HealthNutritionRecord,
    HealthObservation,
    HealthRawBatch,
    HealthSleepSession,
    HealthSyncRun,
    HealthWorkout,
)
from app.services.sources import (
    SourceConfigService,
    data_origin,
    enrich_dashboard_reliability_payload,
    parse_iso,
    record_dedupe_id,
    selected_raw_daily_sums,
)

WINDOWS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}

PARIS = ZoneInfo("Europe/Paris")
WINDOW_DAYS = {"24h": 1, "7d": 7, "30d": 30}
TRAINING_ACTIVITY_TYPES = {
    "running",
    "cycling",
    "stationary_biking",
    "spinning",
    "strength_training",
    "rowing",
    "swimming",
}
ESTIMATED_STEP_METERS = 0.85
STEP_SELECTED_SOURCE_FALLBACK_RATIO = 1.5
STEP_NORMALIZED_SOURCE_FALLBACK_RATIO = 1.2
STEP_NORMALIZED_SOURCE_MIN_DELTA = 1_000
ACTIVITY_TYPE_ALIASES = {
    "run": "running",
    "running": "running",
    "running_treadmill": "running",
    "treadmill_running": "running",
    "cycling": "cycling",
    "indoor_cycling": "stationary_biking",
    "stationary_biking": "stationary_biking",
    "spinning": "spinning",
    "rpm": "spinning",
    "strength": "strength_training",
    "strength_training": "strength_training",
    "weightlifting": "strength_training",
    "weight_lifting": "strength_training",
    "rowing": "rowing",
    "rowing_machine": "rowing",
    "rower": "rowing",
    "swim": "swimming",
    "swimming": "swimming",
    "pool_swimming": "swimming",
    "swimming_pool": "swimming",
    "open_water_swimming": "swimming",
    "swimming_open_water": "swimming",
}


def canonical_activity_type(activity_type: str | None) -> str:
    normalized = str(activity_type or "").strip().lower().replace(" ", "_").replace("-", "_")
    return ACTIVITY_TYPE_ALIASES.get(normalized, normalized)


def canonical_workout_activity_type(workout: HealthWorkout) -> str:
    metadata = workout.metadata_json or {}
    exercise_type_code = str(metadata.get("exercise_type_code") or "")
    if exercise_type_code == "53":
        return "rowing"
    if exercise_type_code in {"73", "74"}:
        return "swimming"
    return canonical_activity_type(workout.activity_type)


def validate_window(window: str) -> str:
    if window not in WINDOWS:
        raise ValueError("Unsupported window")
    return window


def json_timestamp(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def local_date(value: datetime) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(PARIS).date()


def local_time_minutes(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    local = value.astimezone(PARIS)
    return local.hour * 60 + local.minute


def format_minutes_as_time(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


class HealthContextService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def recompute(self, user_id: str, windows: list[str]) -> int:
        written = 0
        for window in windows:
            payload = await self.overview(user_id, window)
            await self.db.execute(
                delete(HealthDailyAggregate).where(
                    HealthDailyAggregate.user_id == user_id,
                    HealthDailyAggregate.window == window,
                )
            )
            self.db.add(
                HealthDailyAggregate(
                    user_id=user_id,
                    date=datetime.utcnow().date(),
                    window=window,
                    payload=payload,
                )
            )
            written += 1
        await self.db.commit()
        return written

    async def overview(self, user_id: str, window: str) -> dict:
        validate_window(window)
        source_config = await SourceConfigService(self.db).config(user_id)
        sleep = await self.sleep(user_id, window, source_config=source_config)
        nutrition = await self.nutrition(user_id, window)
        workouts = await self.workouts(user_id, window, source_config=source_config)
        activity = await self.activity(user_id, window, source_config=source_config)
        biometrics = await self.biometrics(user_id, window)
        series = await self.daily_series(user_id, window, source_config=source_config)
        activity["steps"] = int(sum(day["steps"] for day in series))
        activity["active_calories_kcal"] = float(sum(day["active_calories_kcal"] for day in series))
        activity["distance_meters"] = float(sum(day["distance_meters"] for day in series))
        step_source = next((day.get("steps_source") for day in reversed(series) if day.get("steps_source")), None)
        if step_source:
            activity["source"] = step_source
        activity["average_daily_steps"] = int(sum(day["steps"] for day in series) / len(series)) if series else 0
        activity["average_daily_active_calories_kcal"] = (
            float(sum(day["active_calories_kcal"] for day in series) / len(series)) if series else 0.0
        )
        activity["steps_estimated_days"] = sum(1 for day in series if day.get("steps_estimated"))
        activity["steps_recovered_days"] = sum(1 for day in series if day.get("steps_recovered"))
        training_load = self._training_load(sleep, workouts)
        payload = {
            "window": window,
            "sleep": sleep,
            "nutrition": nutrition,
            "workouts": workouts,
            "activity": activity,
            "biometrics": biometrics,
            "training_load": training_load,
            "series": series,
            "detected_sources": source_config["detected_sources"],
            "preferred_sources": source_config["preferred_sources"],
            "effective_sources": source_config["effective_sources"],
            "source_badge": source_config["source_badge"],
        }
        if window == "24h":
            payload["life_balance_scores"] = self._life_balance_scores(sleep, workouts, activity, biometrics)
            payload["coach_actions"] = self._coach_actions(sleep, workouts, activity, training_load, nutrition)
        return payload

    def morning_context(self, windows: dict) -> dict:
        last_24h = windows.get("last_24h") or {}
        week = windows.get("week") or {}
        today = self._last_series_day(last_24h) or self._last_series_day(week)
        previous_day = self._previous_series_day(week, today.get("date") if today else None)
        last_night = self._last_night_context(last_24h, week)
        today_sleep_minutes = int((today or {}).get("sleep_minutes") or 0)
        today_steps = int((today or {}).get("steps") or 0)
        previous_steps = int((previous_day or {}).get("steps") or 0)
        last_night_wake_day = self._last_night_wake_day(last_night)
        last_night_woke_today = bool(
            today
            and last_night_wake_day
            and last_night_wake_day == today.get("date")
        )
        activity_still_sparse = today_steps < max(500, previous_steps * 0.1)
        is_today_partial = bool(
            today
            and previous_day
            and last_night["duration_minutes"] > 0
            and (
                last_night_woke_today
                or (today_sleep_minutes == 0 and activity_still_sparse)
            )
        )
        reference_day = previous_day if is_today_partial else today
        reference = "previous_day" if is_today_partial else "today_so_far"
        if is_today_partial or today_sleep_minutes == 0:
            sleep_for_scores = self._score_sleep_context(last_night)
            if last_night["duration_minutes"] <= 0:
                week_sleep = week.get("sleep") or {}
                sleep_for_scores["data_available"] = False
                sleep_for_scores["recovery_fallback_minutes"] = int(
                    week_sleep.get("average_duration_minutes")
                    or week_sleep.get("total_duration_minutes")
                    or 420
                )
            scores = self._life_balance_scores(
                sleep_for_scores,
                self._score_workout_context(reference_day),
                self._score_activity_context(reference_day),
                last_24h.get("biometrics") or week.get("biometrics") or {},
            )
        else:
            scores = last_24h.get("life_balance_scores") or {}
        coach_actions = last_24h.get("coach_actions") or self._coach_actions(
            self._score_sleep_context(last_night),
            self._score_workout_context(reference_day),
            self._score_activity_context(reference_day),
            week.get("training_load") or {},
            last_24h.get("nutrition") or {},
        )
        status = "ready"
        title = "Données du jour"
        message = "Les données récentes sont exploitables pour la lecture du jour."
        if is_today_partial:
            status = "partial_today"
            title = "Données du matin partielles"
            message = "Données du jour encore partielles : lecture basée sur la dernière journée complète et la dernière nuit mesurée."
        elif last_night["duration_minutes"] <= 0:
            status = "sleep_missing"
            title = "Nuit non mesurée"
            message = "Il n'y a pas de données sommeil exploitables sur la fenêtre récente : les scores de sommeil restent indisponibles et la récupération est estimée avec une fiabilité faible."
        return {
            "status": status,
            "title": title,
            "is_today_partial": is_today_partial,
            "recommended_context": reference,
            "message": message,
            "today_so_far": today or {},
            "previous_day": previous_day or {},
            "last_night": last_night,
            "life_balance_scores": scores,
            "coach_actions": coach_actions,
        }

    async def dashboard_bundle(self, user_id: str) -> dict | None:
        snapshot = await self.db.scalar(
            select(HealthDashboardSnapshot)
            .where(HealthDashboardSnapshot.user_id == user_id)
            .order_by(HealthDashboardSnapshot.computed_at.desc())
            .limit(1)
        )
        if snapshot is None:
            return None
        return enrich_dashboard_reliability_payload(snapshot.payload)

    async def morning_brief(self, user_id: str) -> dict:
        last_24h = await self.overview(user_id, "24h")
        week = await self.overview(user_id, "7d")
        windows = {"last_24h": last_24h, "week": week}
        morning_context = self.morning_context(windows)
        reference_day = (
            morning_context["previous_day"]
            if morning_context["recommended_context"] == "previous_day"
            else morning_context["today_so_far"]
        )
        today_so_far = morning_context["today_so_far"]
        last_night = morning_context["last_night"]
        summary_scores = morning_context["life_balance_scores"]
        return {
            "version": "healthconnect.hermes.morning_brief.v1",
            "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
            "windows": {
                "last_24h": last_24h,
                "week": week,
            },
            "morning_context": morning_context,
            "summary": {
                "life_balance_scores": summary_scores,
                "health_synthesis": self._health_synthesis(summary_scores, morning_context),
                "coach_actions": morning_context["coach_actions"],
                "recommended_context": morning_context["recommended_context"],
                "sleep": {
                    "last_night_minutes": last_night["duration_minutes"],
                    "week_average_minutes": week["sleep"]["average_duration_minutes"],
                    "latest_bed_time": last_night["start_time"],
                    "latest_wake_time": last_night["end_time"],
                    "awakenings_last_night": last_night["awakenings_count"],
                },
                "activity": {
                    "steps_today": int(reference_day.get("steps") or 0),
                    "steps_reference": int(reference_day.get("steps") or 0),
                    "steps_today_so_far": int(today_so_far.get("steps") or 0),
                    "average_daily_steps_7d": week["activity"]["average_daily_steps"],
                },
                "training": {
                    "sessions_today": int(reference_day.get("workouts") or 0),
                    "sessions_reference": int(reference_day.get("workouts") or 0),
                    "sessions_today_so_far": int(today_so_far.get("workouts") or 0),
                    "duration_minutes_reference": int(reference_day.get("workout_minutes") or 0),
                    "duration_minutes_today_so_far": int(today_so_far.get("workout_minutes") or 0),
                    "sessions_7d": week["workouts"]["sessions"],
                    "duration_minutes_7d": week["workouts"]["duration_minutes"],
                    "running_distance_meters_7d": week["workouts"]["running_distance_meters"],
                    "load": week["training_load"],
                },
                "nutrition": self._brief_nutrition_context(last_24h.get("nutrition") or {}),
                "biometrics": self._brief_biometrics_context(last_24h.get("biometrics") or week.get("biometrics") or {}),
            },
        }

    def _last_series_day(self, overview: dict) -> dict:
        series = overview.get("series") or []
        return dict(series[-1]) if series else {}

    def _last_night_wake_day(self, last_night: dict) -> str | None:
        end_time = last_night.get("end_time")
        if not end_time:
            return None
        parsed = parse_iso(str(end_time))
        if parsed is None:
            return None
        return local_date(parsed).isoformat()

    def _previous_series_day(self, overview: dict, today_date: str | None) -> dict:
        series = [dict(item) for item in (overview.get("series") or [])]
        if not series:
            return {}
        if not today_date:
            return series[-2] if len(series) >= 2 else {}
        for index, item in enumerate(series):
            if item.get("date") == today_date and index > 0:
                return series[index - 1]
        return series[-2] if len(series) >= 2 else {}

    def _last_night_context(self, last_24h: dict, week: dict) -> dict:
        sleep = last_24h.get("sleep") or {}
        duration = int(sleep.get("average_duration_minutes") or sleep.get("total_duration_minutes") or 0)
        if duration <= 0:
            sleep = week.get("sleep") or {}
            duration = self._sleep_duration_for_latest_night(week, sleep)
        return {
            "duration_minutes": duration,
            "start_time": sleep.get("latest_sleep_start"),
            "end_time": sleep.get("latest_sleep_end"),
            "awakenings_count": int(sleep.get("latest_sleep_awakenings_count") or sleep.get("awakenings_count") or 0),
            "source": sleep.get("source"),
        }

    def _sleep_duration_for_latest_night(self, overview: dict, sleep: dict) -> int:
        latest_end = sleep.get("latest_sleep_end")
        if latest_end:
            parsed = parse_iso(latest_end)
            if parsed is not None:
                wake_day = local_date(parsed).isoformat()
                for item in overview.get("series") or []:
                    if item.get("date") == wake_day:
                        return int(item.get("sleep_minutes") or 0)
        return int(sleep.get("average_duration_minutes") or sleep.get("total_duration_minutes") or 0)

    def _score_sleep_context(self, last_night: dict) -> dict:
        return {
            "average_duration_minutes": int(last_night.get("duration_minutes") or 0),
            "total_duration_minutes": int(last_night.get("duration_minutes") or 0),
            "latest_sleep_awakenings_count": int(last_night.get("awakenings_count") or 0),
            "awake_minutes": 0,
            "data_available": int(last_night.get("duration_minutes") or 0) > 0,
        }

    def _score_workout_context(self, day: dict | None) -> dict:
        day = day or {}
        return {
            "duration_minutes": int(day.get("workout_minutes") or 0),
            "sessions": int(day.get("workouts") or 0),
        }

    def _score_activity_context(self, day: dict | None) -> dict:
        day = day or {}
        return {
            "steps": int(day.get("steps") or 0),
            "distance_meters": float(day.get("distance_meters") or 0),
            "steps_estimated_days": int(bool(day.get("steps_estimated"))),
        }

    async def sleep(self, user_id: str, window: str, source_config: dict | None = None) -> dict:
        start = await self._window_start(user_id, window)
        source_config = source_config or await SourceConfigService(self.db).config(user_id)
        sessions = await self._selected_sleep_sessions(
            user_id,
            start,
            source_config["effective_sources"].get("sleep"),
        )
        session_count = len(sessions)
        total_minutes = sum(int(item["session"].total_duration_minutes or 0) for item in sessions)
        deep = sum(int(item["session"].deep_sleep_minutes or 0) for item in sessions)
        rem = sum(int(item["session"].rem_sleep_minutes or 0) for item in sessions)
        light = sum(int(item["session"].light_sleep_minutes or 0) for item in sessions)
        awake = sum(int(item["session"].awake_minutes or 0) for item in sessions)
        awakenings = sum(self._stage_awakenings(item["session"].stages or []) for item in sessions)
        latest = max(sessions, key=lambda item: item["interval"].end_time) if sessions else None
        latest_awakenings = self._stage_awakenings(latest["session"].stages or []) if latest else 0
        average_bed_time = self._average_time(
            [local_time_minutes(item["interval"].start_time) for item in sessions],
            sleep_start=True,
        )
        average_wake_time = self._average_time(
            [local_time_minutes(item["interval"].end_time) for item in sessions],
            sleep_start=False,
        )
        return {
            "window": window,
            "sessions": session_count,
            "total_duration_minutes": total_minutes,
            "average_duration_minutes": int(total_minutes / session_count) if session_count else 0,
            "deep_sleep_minutes": int(deep or 0),
            "rem_sleep_minutes": int(rem or 0),
            "light_sleep_minutes": int(light or 0),
            "awake_minutes": int(awake or 0),
            "awakenings_count": awakenings,
            "latest_sleep_awakenings_count": latest_awakenings,
            "latest_sleep_start": json_timestamp(latest["interval"].start_time if latest else None),
            "latest_sleep_end": json_timestamp(latest["interval"].end_time if latest else None),
            "average_bed_time": average_bed_time,
            "average_wake_time": average_wake_time,
            "source": source_config["effective_sources"].get("sleep"),
        }

    async def nutrition(self, user_id: str, window: str) -> dict:
        start = await self._window_start(user_id, window)
        nutrition_result = await self.db.execute(
            select(
                func.count(HealthNutritionRecord.id),
                func.coalesce(func.sum(HealthNutritionRecord.energy_kcal), 0),
                func.coalesce(func.sum(HealthNutritionRecord.protein_g), 0),
                func.coalesce(func.sum(HealthNutritionRecord.carbohydrates_g), 0),
                func.coalesce(func.sum(HealthNutritionRecord.fat_g), 0),
                func.max(HealthNutritionRecord.timestamp),
            ).where(HealthNutritionRecord.user_id == user_id, HealthNutritionRecord.timestamp >= start)
        )
        hydration_result = await self.db.execute(
            select(func.coalesce(func.sum(HealthHydrationRecord.volume_liters), 0)).where(
                HealthHydrationRecord.user_id == user_id,
                HealthHydrationRecord.start_time >= start,
            )
        )
        meals, energy, protein, carbs, fat, latest_meal_at = nutrition_result.one()
        hydration = hydration_result.scalar_one()
        day_count = max(1, len(await self._window_days(user_id, window)))
        return {
            "window": window,
            "meals": meals,
            "energy_kcal": float(energy or 0),
            "average_daily_energy_kcal": float(energy or 0) / day_count,
            "protein_g": float(protein or 0),
            "carbohydrates_g": float(carbs or 0),
            "fat_g": float(fat or 0),
            "hydration_liters": float(hydration or 0),
            "latest_meal_at": json_timestamp(latest_meal_at),
        }

    async def workouts(self, user_id: str, window: str, source_config: dict | None = None) -> dict:
        start = await self._window_start(user_id, window)
        source_config = source_config or await SourceConfigService(self.db).config(user_id)
        selected = await self._selected_workouts(
            user_id,
            start,
            source_config["effective_sources"].get("workouts"),
        )
        payloads = await self._raw_payloads(user_id)
        for item in selected:
            item["_distance_meters"] = self._resolved_workout_distance_meters(
                payloads,
                item,
                source_config["effective_sources"].get("workouts"),
            )
        by_type: dict[str, dict] = {}
        for item in selected:
            workout = item["workout"]
            activity_type = canonical_workout_activity_type(workout)
            bucket = by_type.setdefault(
                activity_type,
                {"sessions": 0, "duration_minutes": 0, "calories": 0, "distance_meters": 0.0},
            )
            bucket["sessions"] += 1
            bucket["duration_minutes"] += int(workout.duration_minutes or 0)
            bucket["calories"] += int(workout.calories or 0)
            bucket["distance_meters"] += float(item.get("_distance_meters") or 0)
        latest = max(selected, key=lambda item: item["interval"].end_time) if selected else None
        history = [
            {
                "date": local_date(item["interval"].start_time).isoformat(),
                "start_time": json_timestamp(item["interval"].start_time),
                "end_time": json_timestamp(item["interval"].end_time),
                "activity_type": canonical_workout_activity_type(item["workout"]),
                "duration_minutes": int(item["workout"].duration_minutes or 0),
                "calories": int(item["workout"].calories or 0),
                "distance_meters": float(item.get("_distance_meters") or 0),
            }
            for item in sorted(selected, key=lambda row: row["interval"].start_time, reverse=True)
        ]
        return {
            "window": window,
            "sessions": len(selected),
            "duration_minutes": sum(int(item["workout"].duration_minutes or 0) for item in selected),
            "calories": sum(int(item["workout"].calories or 0) for item in selected),
            "distance_meters": sum(float(item.get("_distance_meters") or 0) for item in selected),
            "running_distance_meters": sum(
                float(item.get("_distance_meters") or 0)
                for item in selected
                if canonical_workout_activity_type(item["workout"]) == "running"
            ),
            "latest_workout_at": json_timestamp(latest["interval"].end_time if latest else None),
            "source": source_config["effective_sources"].get("workouts"),
            "history": history,
            "by_activity_type": [
                {
                    "activity_type": activity_type,
                    "sessions": values["sessions"],
                    "duration_minutes": values["duration_minutes"],
                    "calories": values["calories"],
                    "distance_meters": values["distance_meters"],
                }
                for activity_type, values in sorted(by_type.items())
            ],
        }

    async def activity(self, user_id: str, window: str, source_config: dict | None = None) -> dict:
        start = await self._window_start(user_id, window)
        source_config = source_config or await SourceConfigService(self.db).config(user_id)
        payloads = await self._raw_payloads(user_id)
        selected_source = source_config["effective_sources"].get("activity")
        has_explicit_activity_source = bool((source_config.get("preferred_sources") or {}).get("activity"))
        raw_steps = selected_raw_daily_sums(
            payloads,
            record_type="Steps",
            value_path=["count"],
            selected_source=selected_source,
            start=start,
            fallback_to_best_source_ratio=None if has_explicit_activity_source else STEP_SELECTED_SOURCE_FALLBACK_RATIO,
        )
        raw_active_calories = selected_raw_daily_sums(
            payloads,
            record_type="ActiveCaloriesBurned",
            value_path=["energy", "inKilocalories"],
            selected_source=selected_source,
            start=start,
        )
        raw_distance = selected_raw_daily_sums(
            payloads,
            record_type="Distance",
            value_path=["distance", "inMeters"],
            selected_source=selected_source,
            start=start,
        )
        if raw_steps or raw_active_calories or raw_distance:
            activity_source = selected_source
            if raw_steps:
                activity_source = max(raw_steps.values(), key=lambda day: day["total"]).get("source") or activity_source
            return {
                "window": window,
                "steps": int(sum(day["total"] for day in raw_steps.values())),
                "active_calories_kcal": float(sum(day["total"] for day in raw_active_calories.values())),
                "distance_meters": float(sum(day["total"] for day in raw_distance.values())),
                "step_records": int(sum(day["records"] for day in raw_steps.values())),
                "active_calorie_records": int(sum(day["records"] for day in raw_active_calories.values())),
                "distance_records": int(sum(day["records"] for day in raw_distance.values())),
                "source": activity_source,
            }
        allowed_days = await self._window_days(user_id, window)
        normalized_activity = await self._normalized_daily_activity(user_id, start, set(allowed_days), selected_source)
        return {
            "window": window,
            "steps": int(sum(day["steps"] for day in normalized_activity.values())),
            "active_calories_kcal": float(sum(day["active_calories_kcal"] for day in normalized_activity.values())),
            "distance_meters": float(sum(day["distance_meters"] for day in normalized_activity.values())),
            "step_records": int(sum(day.get("step_records", 0) for day in normalized_activity.values())),
            "active_calorie_records": int(sum(day.get("active_calorie_records", 0) for day in normalized_activity.values())),
            "distance_records": int(sum(day.get("distance_records", 0) for day in normalized_activity.values())),
            "source": selected_source,
        }

    async def biometrics(self, user_id: str, window: str) -> dict:
        start = await self._window_start(user_id, window)
        result = await self.db.execute(
            select(
                HealthObservation.type,
                func.count(HealthObservation.id),
                func.avg(HealthObservation.value),
                func.max(HealthObservation.timestamp),
                func.min(HealthObservation.value),
                func.max(HealthObservation.value),
            )
            .where(
                HealthObservation.user_id == user_id,
                HealthObservation.timestamp >= start,
                HealthObservation.type.in_(["hrv", "heart_rate", "resting_heart_rate", "vo2_max"]),
            )
            .group_by(HealthObservation.type)
        )
        rows = {
            kind: {
                "count": int(count or 0),
                "average": float(average or 0),
                "latest_at": latest_at,
                "min": float(min_value or 0),
                "max": float(max_value or 0),
            }
            for kind, count, average, latest_at, min_value, max_value in result.all()
        }
        hrv = rows.get("hrv") or {}
        heart_rate = rows.get("heart_rate") or {}
        resting_heart_rate = rows.get("resting_heart_rate") or {}
        vo2_max = rows.get("vo2_max") or {}
        return {
            "window": window,
            "hrv_records": int(hrv.get("count") or 0),
            "hrv_rmssd_ms": float(hrv.get("average") or 0),
            "latest_hrv_at": json_timestamp(hrv.get("latest_at")),
            "heart_rate_records": int(heart_rate.get("count") or 0),
            "average_heart_rate_bpm": float(heart_rate.get("average") or 0),
            "heart_rate_min_bpm": float(heart_rate.get("min") or 0),
            "heart_rate_max_bpm": float(heart_rate.get("max") or 0),
            "latest_heart_rate_at": json_timestamp(heart_rate.get("latest_at")),
            "resting_heart_rate_records": int(resting_heart_rate.get("count") or 0),
            "resting_heart_rate_bpm": float(resting_heart_rate.get("average") or 0),
            "latest_resting_heart_rate_at": json_timestamp(resting_heart_rate.get("latest_at")),
            "vo2_max_records": int(vo2_max.get("count") or 0),
            "vo2_max_ml_kg_min": float(vo2_max.get("average") or 0),
            "latest_vo2_max_at": json_timestamp(vo2_max.get("latest_at")),
        }

    async def daily_series(self, user_id: str, window: str, source_config: dict | None = None) -> list[dict]:
        start = await self._window_start(user_id, window)
        allowed_days = await self._window_days(user_id, window)
        source_config = source_config or await SourceConfigService(self.db).config(user_id)
        payloads = await self._raw_payloads(user_id)
        selected_activity_source = source_config["effective_sources"].get("activity")
        has_explicit_activity_source = bool((source_config.get("preferred_sources") or {}).get("activity"))
        days: defaultdict[str, dict] = defaultdict(
            lambda: {
                "steps": 0,
                "active_calories_kcal": 0.0,
                "distance_meters": 0.0,
                "sleep_minutes": 0,
                "workout_minutes": 0,
                "workouts": 0,
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
        )
        for day in allowed_days:
            days[day]

        raw_steps = selected_raw_daily_sums(
            payloads,
            record_type="Steps",
            value_path=["count"],
            selected_source=selected_activity_source,
            start=start,
            allowed_days=set(allowed_days),
            day_tz=PARIS,
            fallback_to_best_source_ratio=None if has_explicit_activity_source else STEP_SELECTED_SOURCE_FALLBACK_RATIO,
        )
        raw_active_calories = selected_raw_daily_sums(
            payloads,
            record_type="ActiveCaloriesBurned",
            value_path=["energy", "inKilocalories"],
            selected_source=selected_activity_source,
            start=start,
            allowed_days=set(allowed_days),
            day_tz=PARIS,
        )
        raw_distance = selected_raw_daily_sums(
            payloads,
            record_type="Distance",
            value_path=["distance", "inMeters"],
            selected_source=selected_activity_source,
            start=start,
            allowed_days=set(allowed_days),
            day_tz=PARIS,
        )
        if raw_steps or raw_active_calories or raw_distance:
            for day, value in raw_steps.items():
                days[day]["steps"] = int(value["total"])
            for day, value in raw_active_calories.items():
                days[day]["active_calories_kcal"] = float(value["total"])
            for day, value in raw_distance.items():
                days[day]["distance_meters"] = float(value["total"])
            normalized_activity = await self._normalized_daily_activity(user_id, start, set(allowed_days), selected_activity_source)
            self._supplement_incomplete_raw_activity(days, normalized_activity, selected_activity_source)
        else:
            normalized_activity = await self._normalized_daily_activity(user_id, start, set(allowed_days), selected_activity_source)
            for day, values in normalized_activity.items():
                days[day]["steps"] = int(values["steps"])
                days[day]["active_calories_kcal"] = float(values["active_calories_kcal"])
                days[day]["distance_meters"] = float(values["distance_meters"])

        if not has_explicit_activity_source:
            best_normalized_steps = await self._best_normalized_steps_by_source(user_id, start, set(allowed_days))
            self._recover_best_normalized_steps(days, best_normalized_steps)

        sleep_sessions = await self._selected_sleep_sessions(
            user_id,
            start,
            source_config["effective_sources"].get("sleep"),
        )
        for item in sleep_sessions:
            interval = item["interval"]
            session = item["session"]
            day = local_date(interval.end_time).isoformat()
            if day in allowed_days:
                days[day]["sleep_minutes"] += int(session.total_duration_minutes or 0)

        workouts = await self._selected_workouts(
            user_id,
            start,
            source_config["effective_sources"].get("workouts"),
        )
        for item in workouts:
            day = local_date(item["interval"].start_time).isoformat()
            if day not in allowed_days:
                continue
            days[day]["workout_minutes"] += int(item["workout"].duration_minutes or 0)
            days[day]["workouts"] += 1

        nutrition_rows = await self.db.execute(
            select(
                HealthNutritionRecord.timestamp,
                HealthNutritionRecord.energy_kcal,
                HealthNutritionRecord.protein_g,
                HealthNutritionRecord.carbohydrates_g,
                HealthNutritionRecord.fat_g,
            ).where(
                HealthNutritionRecord.user_id == user_id,
                HealthNutritionRecord.timestamp >= start,
            )
        )
        for timestamp, energy, protein, carbs, fat in nutrition_rows.all():
            day = local_date(timestamp).isoformat()
            if day in allowed_days:
                days[day]["energy_kcal"] += float(energy or 0)
                days[day]["protein_g"] += float(protein or 0)
                days[day]["carbohydrates_g"] += float(carbs or 0)
                days[day]["fat_g"] += float(fat or 0)

        hydration_rows = await self.db.execute(
            select(HealthHydrationRecord.start_time, HealthHydrationRecord.volume_liters).where(
                HealthHydrationRecord.user_id == user_id,
                HealthHydrationRecord.start_time >= start,
            )
        )
        for timestamp, volume in hydration_rows.all():
            day = local_date(timestamp).isoformat()
            if day in allowed_days:
                days[day]["hydration_liters"] += float(volume or 0)

        biometric_rows = await self.db.execute(
            select(
                HealthObservation.timestamp,
                HealthObservation.type,
                HealthObservation.value,
            ).where(
                HealthObservation.user_id == user_id,
                HealthObservation.timestamp >= start,
                HealthObservation.type.in_(["heart_rate", "hrv", "resting_heart_rate", "vo2_max"]),
            )
        )
        biometric_values: defaultdict[str, defaultdict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for timestamp, kind, value in biometric_rows.all():
            day = local_date(timestamp).isoformat()
            if day in allowed_days:
                biometric_values[day][kind].append(float(value or 0))
        for day, values in biometric_values.items():
            heart_rates = values.get("heart_rate") or []
            if heart_rates:
                days[day]["heart_rate_min_bpm"] = float(min(heart_rates))
                days[day]["heart_rate_max_bpm"] = float(max(heart_rates))
            hrv_values = values.get("hrv") or []
            if hrv_values:
                days[day]["hrv_rmssd_ms"] = float(sum(hrv_values) / len(hrv_values))
            resting_values = values.get("resting_heart_rate") or []
            if resting_values:
                days[day]["resting_heart_rate_bpm"] = float(sum(resting_values) / len(resting_values))
            vo2_values = values.get("vo2_max") or []
            if vo2_values:
                days[day]["vo2_max_ml_kg_min"] = float(sum(vo2_values) / len(vo2_values))

        self._apply_step_estimates(days)

        return [{"date": day, **days[day]} for day in allowed_days]

    async def _normalized_daily_activity(
        self,
        user_id: str,
        start: datetime,
        allowed_days: set[str],
        selected_source: str | None = None,
    ) -> dict[str, dict]:
        observation_rows = await self.db.execute(
            select(
                HealthObservation.timestamp,
                HealthObservation.type,
                HealthObservation.value,
                HealthObservation.metadata_json,
                HealthObservation.batch_id,
            )
            .where(
                HealthObservation.user_id == user_id,
                HealthObservation.timestamp >= start,
                HealthObservation.type.in_(["steps", "active_calories", "calories", "distance"]),
            )
        )
        incremental_batch_ids = await self._incremental_activity_batch_ids(user_id, start)
        batches: defaultdict[str, dict] = defaultdict(
            lambda: defaultdict(
                lambda: {
                    "steps": 0,
                    "active_calories_kcal": 0.0,
                    "fallback_calories_kcal": 0.0,
                    "distance_meters": 0.0,
                    "step_records": 0,
                    "active_calorie_records": 0,
                    "fallback_calorie_records": 0,
                    "distance_records": 0,
                    "_seen": set(),
                }
            )
        )
        incremental_values: defaultdict[str, defaultdict[str, dict[tuple, float]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        for timestamp, kind, value, metadata, batch_id in observation_rows.all():
            day = local_date(timestamp).isoformat()
            if day not in allowed_days:
                continue
            metadata = metadata or {}
            origin = data_origin(metadata)
            is_unknown_total_calories = kind == "calories" and origin is None
            if selected_source and origin != selected_source and not is_unknown_total_calories:
                continue
            dedupe_key = (
                kind,
                day,
                timestamp,
                metadata.get("start_time"),
                metadata.get("end_time"),
                float(value or 0),
            )
            if batch_id in incremental_batch_ids:
                incremental_key = self._normalized_activity_dedupe_key(kind, day, timestamp, metadata, value)
                current_value = incremental_values[day][kind].get(incremental_key, 0.0)
                incremental_values[day][kind][incremental_key] = max(current_value, float(value or 0))
                continue
            bucket = batches[day][str(batch_id)]
            if dedupe_key in bucket["_seen"]:
                continue
            bucket["_seen"].add(dedupe_key)
            if kind == "steps":
                bucket["steps"] += int(value or 0)
                bucket["step_records"] += 1
            elif kind == "active_calories":
                bucket["active_calories_kcal"] += float(value or 0)
                bucket["active_calorie_records"] += 1
            elif kind == "calories":
                bucket["fallback_calories_kcal"] += float(value or 0)
                bucket["fallback_calorie_records"] += 1
            elif kind == "distance":
                bucket["distance_meters"] += float(value or 0)
                bucket["distance_records"] += 1
        values: defaultdict[str, dict] = defaultdict(
            lambda: {
                "steps": 0,
                "active_calories_kcal": 0.0,
                "distance_meters": 0.0,
                "step_records": 0,
                "active_calorie_records": 0,
                "distance_records": 0,
            }
        )
        for day in set(batches) | set(incremental_values):
            day_batches = batches.get(day, {})
            if day_batches:
                for metric, record_metric in (
                    ("steps", "step_records"),
                    ("distance_meters", "distance_records"),
                ):
                    bucket = max(day_batches.values(), key=lambda item: item[metric], default=None)
                    if bucket is not None:
                        values[day][metric] = bucket[metric]
                        values[day][record_metric] = bucket[record_metric]
                active_bucket = max(day_batches.values(), key=lambda item: item["active_calories_kcal"], default=None)
                fallback_bucket = max(day_batches.values(), key=lambda item: item["fallback_calories_kcal"], default=None)
                if active_bucket is not None and active_bucket["active_calories_kcal"]:
                    values[day]["active_calories_kcal"] = active_bucket["active_calories_kcal"]
                    values[day]["active_calorie_records"] = active_bucket["active_calorie_records"]
                elif fallback_bucket is not None and fallback_bucket["fallback_calories_kcal"]:
                    values[day]["active_calories_kcal"] = fallback_bucket["fallback_calories_kcal"]
                    values[day]["active_calorie_records"] = fallback_bucket["fallback_calorie_records"]
            incremental_day = incremental_values.get(day, {})
            incremental_steps = int(sum(incremental_day.get("steps", {}).values()))
            if incremental_steps > values[day]["steps"]:
                values[day]["steps"] = incremental_steps
                values[day]["step_records"] = len(incremental_day.get("steps", {}))
            incremental_distance = float(sum(incremental_day.get("distance", {}).values()))
            if incremental_distance > values[day]["distance_meters"]:
                values[day]["distance_meters"] = incremental_distance
                values[day]["distance_records"] = len(incremental_day.get("distance", {}))
            incremental_active = float(sum(incremental_day.get("active_calories", {}).values()))
            incremental_fallback = float(sum(incremental_day.get("calories", {}).values()))
            if incremental_active > values[day]["active_calories_kcal"]:
                values[day]["active_calories_kcal"] = incremental_active
                values[day]["active_calorie_records"] = len(incremental_day.get("active_calories", {}))
            elif (
                values[day]["active_calories_kcal"] == 0
                and incremental_fallback > values[day]["active_calories_kcal"]
            ):
                values[day]["active_calories_kcal"] = incremental_fallback
                values[day]["active_calorie_records"] = len(incremental_day.get("calories", {}))
        return values

    async def _best_normalized_steps_by_source(
        self,
        user_id: str,
        start: datetime,
        allowed_days: set[str],
    ) -> dict[str, dict]:
        observation_rows = await self.db.execute(
            select(
                HealthObservation.timestamp,
                HealthObservation.value,
                HealthObservation.metadata_json,
            )
            .where(
                HealthObservation.user_id == user_id,
                HealthObservation.timestamp >= start,
                HealthObservation.type == "steps",
            )
        )
        values_by_source: defaultdict[str, defaultdict[str, dict[tuple, float]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        for timestamp, value, metadata in observation_rows.all():
            day = local_date(timestamp).isoformat()
            if day not in allowed_days:
                continue
            metadata = metadata or {}
            origin = data_origin(metadata)
            if not origin:
                continue
            dedupe_key = self._normalized_activity_dedupe_key("steps", day, timestamp, metadata, value)
            current_value = values_by_source[day][origin].get(dedupe_key, 0.0)
            values_by_source[day][origin][dedupe_key] = max(current_value, float(value or 0))

        best_by_day: dict[str, dict] = {}
        for day, source_values in values_by_source.items():
            best_source, best_records = max(
                source_values.items(),
                key=lambda item: sum(item[1].values()),
            )
            best_by_day[day] = {
                "source": best_source,
                "steps": int(sum(best_records.values())),
                "step_records": len(best_records),
            }
        return best_by_day

    async def _incremental_activity_batch_ids(self, user_id: str, start: datetime) -> set[str]:
        result = await self.db.execute(
            select(HealthSyncRun.batch_id).where(
                HealthSyncRun.user_id == user_id,
                HealthSyncRun.batch_id.is_not(None),
                HealthSyncRun.data_end >= start,
                (HealthSyncRun.sync_mode == "incremental") | (HealthSyncRun.trigger == "background"),
            )
        )
        return {str(batch_id) for batch_id in result.scalars().all() if batch_id}

    def _normalized_activity_dedupe_key(
        self,
        kind: str,
        day: str,
        timestamp: datetime,
        metadata: dict,
        value: float,
    ) -> tuple:
        origin = data_origin(metadata) or "unknown"
        record_id = metadata.get("id") or metadata.get("clientRecordId") or metadata.get("client_record_id")
        if record_id:
            return (kind, day, origin, str(record_id))
        return (
            kind,
            day,
            origin,
            metadata.get("start_time") or timestamp.isoformat(),
            metadata.get("end_time") or timestamp.isoformat(),
        )

    def _supplement_incomplete_raw_activity(
        self,
        days: dict[str, dict],
        normalized_activity: dict[str, dict],
        selected_source: str | None = None,
    ) -> None:
        for day, normalized in normalized_activity.items():
            if day not in days:
                continue
            normalized_steps = int(normalized.get("steps") or 0)
            current_steps = int(days[day].get("steps") or 0)
            if normalized_steps and (
                current_steps == 0
                or (current_steps < 5_000 and current_steps < normalized_steps * 0.5)
            ):
                days[day]["steps"] = normalized_steps
                days[day]["steps_recovered"] = True
                if selected_source:
                    days[day]["steps_source"] = selected_source
            if not days[day].get("active_calories_kcal") and normalized.get("active_calories_kcal"):
                days[day]["active_calories_kcal"] = float(normalized["active_calories_kcal"])
            if not days[day].get("distance_meters") and normalized.get("distance_meters"):
                days[day]["distance_meters"] = float(normalized["distance_meters"])

    def _recover_best_normalized_steps(self, days: dict[str, dict], best_normalized_steps: dict[str, dict]) -> None:
        for day, best in best_normalized_steps.items():
            if day not in days:
                continue
            current_steps = int(days[day].get("steps") or 0)
            best_steps = int(best.get("steps") or 0)
            if best_steps <= current_steps:
                continue
            if current_steps <= 0 or (
                best_steps - current_steps >= STEP_NORMALIZED_SOURCE_MIN_DELTA
                and best_steps >= current_steps * STEP_NORMALIZED_SOURCE_FALLBACK_RATIO
            ):
                days[day]["steps"] = best_steps
                days[day]["step_records"] = max(
                    int(days[day].get("step_records") or 0),
                    int(best.get("step_records") or 0),
                )
                days[day]["steps_source"] = best.get("source")
                days[day]["steps_recovered"] = True

    async def _raw_payloads(self, user_id: str) -> list[dict]:
        result = await self.db.execute(
            select(HealthRawBatch.payload).where(HealthRawBatch.user_id == user_id)
        )
        return [payload for payload in result.scalars().all() if isinstance(payload, dict)]

    async def _selected_sleep_sessions(self, user_id: str, start: datetime, selected_source: str | None) -> list[dict]:
        result = await self.db.execute(
            select(HealthInterval, HealthSleepSession)
            .join(HealthSleepSession, HealthInterval.id == HealthSleepSession.interval_id)
            .where(HealthInterval.user_id == user_id, HealthInterval.end_time >= start)
            .order_by(HealthInterval.start_time)
        )
        candidates = [
            {
                "interval": interval,
                "session": session,
                "data_origin": data_origin(interval.metadata_json),
            }
            for interval, session in result.all()
        ]
        by_day: dict[str, list[dict]] = defaultdict(list)
        for item in candidates:
            by_day[local_date(item["interval"].end_time).isoformat()].append(item)

        selected: list[dict] = []
        for day_candidates in by_day.values():
            preferred = [item for item in day_candidates if item["data_origin"] == selected_source] if selected_source else day_candidates
            selected.extend(self._dedupe_sleep(preferred or day_candidates, selected_source))
        return sorted(selected, key=lambda item: item["interval"].start_time)

    async def _selected_workouts(self, user_id: str, start: datetime, selected_source: str | None) -> list[dict]:
        result = await self.db.execute(
            select(HealthInterval, HealthWorkout)
            .join(HealthWorkout, HealthInterval.id == HealthWorkout.interval_id)
            .where(HealthInterval.user_id == user_id, HealthInterval.start_time >= start)
            .order_by(HealthInterval.start_time)
        )
        candidates = [
            {
                "interval": interval,
                "workout": workout,
                "data_origin": data_origin(workout.metadata_json) or data_origin(interval.metadata_json),
            }
            for interval, workout in result.all()
        ]
        filtered = [item for item in candidates if item["data_origin"] == selected_source] if selected_source else candidates
        deduped = self._dedupe_workouts(filtered or candidates, selected_source)
        return [
            item
            for item in deduped
            if canonical_workout_activity_type(item["workout"]) in TRAINING_ACTIVITY_TYPES
        ]

    def _dedupe_sleep(self, candidates: list[dict], selected_source: str | None) -> list[dict]:
        selected: list[dict] = []
        for item in sorted(candidates, key=lambda row: row["interval"].start_time):
            duration = item["session"].total_duration_minutes or 0
            score = (
                0 if not selected_source or item["data_origin"] == selected_source else 1,
                -duration,
                -int(bool(item["session"].stages)),
            )
            self._merge_interval_candidate(selected, item, score)
        return selected

    def _dedupe_workouts(self, candidates: list[dict], selected_source: str | None) -> list[dict]:
        selected: list[dict] = []
        for item in sorted(candidates, key=lambda row: row["interval"].start_time):
            workout = item["workout"]
            score = (
                0 if not selected_source or item["data_origin"] == selected_source else 1,
                1 if canonical_workout_activity_type(workout) not in TRAINING_ACTIVITY_TYPES else 0,
                -int(workout.distance_meters is not None),
                -int(workout.calories is not None),
            )
            self._merge_interval_candidate(selected, item, score)
        return selected

    def _apply_step_estimates(self, days: dict[str, dict]) -> None:
        for values in days.values():
            distance_meters = float(values.get("distance_meters") or 0)
            if distance_meters < 500:
                continue
            estimated_steps = int(round(distance_meters / ESTIMATED_STEP_METERS))
            current_steps = int(values.get("steps") or 0)
            if current_steps < max(500, estimated_steps * 0.2):
                values["steps"] = estimated_steps
                values["steps_estimated"] = True

    def _resolved_workout_distance_meters(self, payloads: list[dict], item: dict, selected_source: str | None) -> float:
        workout_distance = float(item["workout"].distance_meters or 0)
        if workout_distance > 0:
            return workout_distance
        preferred_origin = item.get("data_origin") or selected_source
        distance = self._raw_distance_for_interval(payloads, item["interval"].start_time, item["interval"].end_time, preferred_origin)
        if distance > 0:
            return distance
        return self._raw_distance_for_interval(payloads, item["interval"].start_time, item["interval"].end_time, None)

    def _raw_distance_for_interval(
        self,
        payloads: list[dict],
        start_time: datetime,
        end_time: datetime,
        selected_source: str | None,
    ) -> float:
        start = self._utc_naive(start_time)
        end = self._utc_naive(end_time)
        total = 0.0
        seen: set[str] = set()
        for payload in payloads:
            for record in ((payload.get("raw_records") or {}).get("Distance") or []):
                origin = data_origin((record or {}).get("metadata")) or "unknown"
                if selected_source and origin != selected_source:
                    continue
                record_start = parse_iso(record.get("startTime"))
                record_end = parse_iso(record.get("endTime"))
                if not record_start or not record_end:
                    continue
                if self._interval_overlap_minutes(record_start, record_end, start, end) <= 0:
                    continue
                dedupe_id = record_dedupe_id(record, "Distance", origin)
                if dedupe_id in seen:
                    continue
                seen.add(dedupe_id)
                distance = ((record.get("distance") or {}).get("inMeters") if isinstance(record, dict) else None)
                if distance is not None:
                    total += float(distance)
        return total

    def _utc_naive(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def _merge_interval_candidate(self, selected: list[dict], item: dict, score: tuple) -> None:
        interval = item["interval"]
        for index, current in enumerate(selected):
            current_interval = current["interval"]
            overlap = self._interval_overlap_minutes(
                interval.start_time,
                interval.end_time,
                current_interval.start_time,
                current_interval.end_time,
            )
            min_duration = min(
                max((interval.end_time - interval.start_time).total_seconds() / 60, 1),
                max((current_interval.end_time - current_interval.start_time).total_seconds() / 60, 1),
            )
            if overlap >= 0.6 * min_duration:
                if score < current["_score"]:
                    item["_score"] = score
                    selected[index] = item
                return
        item["_score"] = score
        selected.append(item)

    def _interval_overlap_minutes(self, start: datetime, end: datetime, other_start: datetime, other_end: datetime) -> float:
        overlap_start = max(start, other_start)
        overlap_end = min(end, other_end)
        return max(0.0, (overlap_end - overlap_start).total_seconds() / 60)

    def _stage_awakenings(self, stages: list[dict]) -> int:
        return sum(1 for stage in stages if str(stage.get("stage", "")).lower() in {"awake", "out_of_bed"})

    def _average_time(self, values: list[int], *, sleep_start: bool) -> str | None:
        if not values:
            return None
        adjusted = [value + (24 * 60 if sleep_start and value < 12 * 60 else 0) for value in values]
        return format_minutes_as_time(round(sum(adjusted) / len(adjusted)))

    def _training_load(self, sleep: dict, workouts: dict) -> dict:
        sleep_minutes = int(sleep.get("average_duration_minutes") or 0)
        workout_minutes = int(workouts.get("duration_minutes") or 0)
        sessions = int(workouts.get("sessions") or 0)
        load_score = min(100, round((workout_minutes / 300) * 70 + sessions * 4))
        if sleep_minutes < 360 and load_score >= 45:
            status = "high"
            label = "Charge élevée"
            recommendation = "Sommeil court avec charge sportive notable : privilégier récupération ou séance légère."
        elif load_score < 25:
            status = "low"
            label = "Charge basse"
            recommendation = "Charge sportive faible sur la période."
        else:
            status = "balanced"
            label = "Charge équilibrée"
            recommendation = "Charge et sommeil cohérents pour maintenir le rythme."
        return {
            "score": load_score,
            "status": status,
            "label": label,
            "recommendation": recommendation,
            "inputs": {
                "average_sleep_minutes": sleep_minutes,
                "workout_minutes": workout_minutes,
                "workout_sessions": sessions,
            },
        }

    def _life_balance_scores(self, sleep: dict, workouts: dict, activity: dict, biometrics: dict | None = None) -> dict:
        scores = [
            self._sleep_balance_score(sleep),
            self._recovery_balance_score(sleep, workouts, biometrics or {}),
            self._movement_balance_score(activity, workouts),
        ]
        return {"window": "24h", "scores": scores}

    def _health_synthesis(self, scores: dict, morning_context: dict) -> dict:
        score_items = [item for item in scores.get("scores", []) if item.get("value") is not None]
        values = [int(item["value"]) for item in score_items]
        value = round(sum(values) / len(values)) if values else 0
        confidence = "medium" if any(item.get("confidence") == "low" for item in score_items) else "high"
        basis = (
            "Dernière nuit mesurée + dernière journée complète pour l'activité."
            if morning_context.get("is_today_partial")
            else "Données disponibles sur la journée en cours."
        )
        return {
            "value": value,
            "tone": self._score_tone(value),
            "confidence": confidence,
            "basis": basis,
            "explanation": (
                "Synthèse calculée à partir des scores sommeil, récupération et mouvement. "
                "L'absence de saisie nutrition ou hydratation réduit le contexte disponible mais ne pénalise pas le score santé."
            ),
            "contributors": [
                {
                    "slug": item.get("slug"),
                    "label": item.get("label"),
                    "value": item.get("value"),
                    "confidence": item.get("confidence"),
                }
                for item in score_items
            ],
        }

    def _brief_nutrition_context(self, nutrition: dict) -> dict:
        meals = int(nutrition.get("meals") or 0)
        energy = float(nutrition.get("energy_kcal") or 0)
        hydration = float(nutrition.get("hydration_liters") or 0)
        nutrition_logged = meals > 0 or energy > 0
        hydration_logged = hydration > 0
        return {
            "status": "logged" if nutrition_logged else "not_logged",
            "hydration_status": "logged" if hydration_logged else "not_logged",
            "meals_logged": meals,
            "energy_kcal": energy,
            "hydration_liters": hydration,
            "score_impact": "not_penalized",
            "message": (
                "Aucune saisie nutritionnelle récente ne signifie pas que l'utilisateur ne s'est pas nourri; "
                "c'est seulement une limite de contexte pour le coach."
                if not nutrition_logged
                else "Nutrition renseignée dans la fenêtre récente."
            ),
        }

    def _brief_biometrics_context(self, biometrics: dict) -> dict:
        hrv_records = int(biometrics.get("hrv_records") or 0)
        return {
            "hrv_records": hrv_records,
            "hrv_rmssd_ms": float(biometrics.get("hrv_rmssd_ms") or 0),
            "hrv_status": "measured" if hrv_records > 0 else "not_recent",
            "score_impact": "confidence_only",
            "message": (
                "Variabilité cardiaque récente disponible."
                if hrv_records > 0
                else "L'absence de variabilité cardiaque récente baisse la fiabilité, pas automatiquement le score santé."
            ),
        }

    def _coach_actions(
        self,
        sleep: dict,
        workouts: dict,
        activity: dict,
        training_load: dict,
        nutrition: dict,
    ) -> list[dict]:
        actions: list[dict] = []
        sleep_minutes = int(sleep.get("average_duration_minutes") or sleep.get("total_duration_minutes") or 0)
        workout_minutes = int(workouts.get("duration_minutes") or 0)
        steps = int(activity.get("steps") or 0)
        meals = int(nutrition.get("meals") or 0)
        energy = float(nutrition.get("energy_kcal") or 0)

        if sleep_minutes <= 0 or sleep.get("data_available") is False:
            actions.append(
                self._coach_action(
                    "sleep_data_missing",
                    "Clarifier le sommeil",
                    1,
                    "Aucune nuit exploitable n'est disponible dans la fenêtre récente.",
                    "Vérifie la synchronisation sommeil, puis garde une lecture prudente de ta récupération aujourd'hui.",
                    "orange",
                )
            )
        elif sleep_minutes < 360:
            actions.append(
                self._coach_action(
                    "protect_recovery",
                    "Protéger la récupération",
                    1,
                    f"Dernière nuit courte: {sleep_minutes} min.",
                    "Évite l'intensité gratuite aujourd'hui et vise une heure de coucher plus stable ce soir.",
                    "red",
                )
            )

        if training_load.get("status") == "high" or workout_minutes >= 90:
            actions.append(
                self._coach_action(
                    "consolidate_training",
                    "Consolider l'entraînement",
                    2,
                    f"Charge sportive récente: {workout_minutes} min.",
                    "Privilégie mobilité, hydratation, apport glucides/protéines et sensations avant une nouvelle séance dure.",
                    "orange",
                )
            )
        elif steps < 7500 and workout_minutes < 20:
            actions.append(
                self._coach_action(
                    "move_gently",
                    "Bouger sans forcer",
                    2,
                    f"Mouvement bas pour l'instant: {steps} pas.",
                    "Ajoute 20 à 30 minutes de marche facile si ton énergie le permet.",
                    "green",
                )
            )

        if meals == 0 and energy == 0:
            actions.append(
                self._coach_action(
                    "log_nutrition",
                    "Renseigner la nutrition",
                    3,
                    "Aucune donnée nutrition validée dans la fenêtre récente.",
                    "Ajoute au moins le repas principal pour fiabiliser les conseils énergie, protéines et récupération.",
                    "green",
                )
            )

        if not actions:
            actions.append(
                self._coach_action(
                    "maintain_rhythm",
                    "Maintenir le rythme",
                    1,
                    "Sommeil, mouvement et charge ne déclenchent pas d'alerte prioritaire.",
                    "Garde une journée structurée: mouvement facile, repas protéiné et coucher régulier.",
                    "green",
                )
            )
        return sorted(actions, key=lambda item: item["priority"])[:3]

    @staticmethod
    def _coach_action(slug: str, label: str, priority: int, reason: str, action: str, tone: str) -> dict:
        return {
            "slug": slug,
            "label": label,
            "priority": priority,
            "reason": reason,
            "action": action,
            "tone": tone,
        }

    def _score_tone(self, value: int | None) -> str:
        if value is None or value < 50:
            return "red"
        if value < 75:
            return "orange"
        return "green"

    def _score_payload(
        self,
        *,
        slug: str,
        label: str,
        value: float,
        confidence: str,
        explanation: str,
        contributors: list[dict],
    ) -> dict:
        score = max(0, min(100, round(value)))
        return {
            "slug": slug,
            "label": label,
            "value": score,
            "tone": self._score_tone(score),
            "confidence": confidence,
            "explanation": explanation,
            "contributors": contributors,
        }

    def _sleep_balance_score(self, sleep: dict) -> dict:
        duration = int(sleep.get("average_duration_minutes") or sleep.get("total_duration_minutes") or 0)
        awake = int(sleep.get("awake_minutes") or 0)
        awakenings = int(sleep.get("latest_sleep_awakenings_count") or sleep.get("awakenings_count") or 0)
        if duration <= 0 or sleep.get("data_available") is False:
            return self._score_payload(
                slug="sleep",
                label="Sommeil",
                value=0,
                confidence="low",
                explanation="Absence de données sommeil sur la fenêtre récente.",
                contributors=[],
            )
        duration_penalty = abs(duration - 450) / 4.8 if duration > 540 else max(0, 420 - duration) / 4.8
        score = 100 - duration_penalty - min(18, awake / 4) - min(14, awakenings * 1.5)
        explanation = "Durée et continuité de la dernière nuit."
        if duration < 360:
            explanation = "Durée courte, quelques perturbations nocturnes."
        elif duration < 450:
            explanation = "Sommeil correct mais encore perfectible."
        elif awakenings <= 2:
            explanation = "Durée et continuité favorables."
        return self._score_payload(
            slug="sleep",
            label="Sommeil",
            value=score,
            confidence="medium",
            explanation=explanation,
            contributors=[
                {"key": "duration_minutes", "label": "Durée", "value": duration},
                {"key": "awake_minutes", "label": "Temps éveillé", "value": awake},
                {"key": "awakenings", "label": "Réveils", "value": awakenings},
            ],
        )

    def _recovery_balance_score(self, sleep: dict, workouts: dict, biometrics: dict | None = None) -> dict:
        biometrics = biometrics or {}
        sleep_payload = self._sleep_balance_score(sleep)
        sleep_score = sleep_payload["value"]
        sleep_missing = sleep_payload["confidence"] == "low" and not sleep_payload.get("contributors")
        estimated_sleep_minutes = int(sleep.get("recovery_fallback_minutes") or 420)
        if sleep_missing:
            estimated_sleep = {
                "average_duration_minutes": estimated_sleep_minutes,
                "total_duration_minutes": estimated_sleep_minutes,
                "awake_minutes": 0,
                "latest_sleep_awakenings_count": 0,
                "data_available": True,
            }
            sleep_score = self._sleep_balance_score(estimated_sleep)["value"]
        workout_minutes = int(workouts.get("duration_minutes") or 0)
        sessions = int(workouts.get("sessions") or 0)
        load_penalty = min(32, workout_minutes / 5) + min(8, sessions * 2)
        hrv_records = int(biometrics.get("hrv_records") or 0)
        hrv_rmssd = float(biometrics.get("hrv_rmssd_ms") or 0)
        hrv_adjustment = max(-10, min(8, (hrv_rmssd - 45) / 4)) if hrv_records > 0 else 0
        score = sleep_score * 0.75 + 32 - load_penalty
        if hrv_records > 0 and not sleep_missing:
            score += hrv_adjustment
            explanation = "Sommeil, charge sportive et variabilité cardiaque récente alimentent l'estimation."
            confidence = "medium"
            if score < 50:
                explanation = "Sommeil, charge sportive et variabilité cardiaque récente suggèrent une récupération à surveiller."
            elif score >= 75:
                explanation = "Sommeil et variabilité cardiaque récente soutiennent une récupération favorable."
        else:
            explanation = "Estimation basée sur sommeil et charge sportive récente, sans mesure fiable de variabilité cardiaque récente."
            confidence = "low"
        if sleep_missing:
            explanation = "Fiabilité faible : sommeil non mesuré, récupération estimée avec une nuit moyenne."
        if score < 50:
            if hrv_records <= 0:
                explanation = "Sommeil et charge sportive suggèrent une récupération à surveiller."
            if sleep_missing:
                explanation = "Fiabilité faible : récupération à surveiller, sommeil estimé faute de mesure."
        elif score < 75:
            if hrv_records <= 0:
                explanation = "Récupération correcte mais prudence si la fatigue est présente."
            if sleep_missing:
                explanation = "Fiabilité faible : récupération estimée avec une nuit moyenne faute de mesure sommeil."
        contributors = [
            {"key": "sleep_score", "label": "Score sommeil estimé" if sleep_missing else "Score sommeil", "value": sleep_score},
            {"key": "sleep_data_quality", "label": "Fiabilité sommeil", "value": "faible" if sleep_missing else "mesurée"},
            {"key": "workout_minutes", "label": "Charge du jour", "value": workout_minutes},
            {"key": "workout_sessions", "label": "Séances", "value": sessions},
        ]
        if hrv_records > 0:
            contributors.append({"key": "hrv_rmssd_ms", "label": "Variabilité cardiaque moyenne", "value": round(hrv_rmssd, 1)})
        return self._score_payload(
            slug="recovery",
            label="Récupération",
            value=score,
            confidence=confidence,
            explanation=explanation,
            contributors=contributors,
        )

    def _movement_balance_score(self, activity: dict, workouts: dict) -> dict:
        steps = int(activity.get("steps") or 0)
        distance_meters = float(activity.get("distance_meters") or 0)
        workout_minutes = int(workouts.get("duration_minutes") or 0)
        score = min(80, steps / 10_000 * 80) + min(10, distance_meters / 10_000 * 10) + min(10, workout_minutes / 60 * 10)
        explanation = "Pas, distance et sport du jour."
        if steps < 5_000 and workout_minutes < 20:
            explanation = "Mouvement faible pour l'instant aujourd'hui."
        elif steps >= 10_000 or workout_minutes >= 60:
            explanation = "Objectif mouvement atteint."
        return self._score_payload(
            slug="movement",
            label="Mouvement",
            value=score,
            confidence="medium" if activity.get("steps_estimated_days") else "high",
            explanation=explanation,
            contributors=[
                {"key": "steps", "label": "Pas", "value": steps},
                {"key": "distance_meters", "label": "Distance", "value": round(distance_meters)},
                {"key": "workout_minutes", "label": "Sport", "value": workout_minutes},
            ],
        )

    async def _window_start(self, user_id: str, window: str) -> datetime:
        validate_window(window)
        days = await self._window_days(user_id, window)
        first_day = date.fromisoformat(days[0])
        return datetime.combine(first_day, time.min, tzinfo=PARIS).astimezone(timezone.utc)

    async def _window_days(self, user_id: str, window: str) -> list[str]:
        validate_window(window)
        anchor = await self._anchor_timestamp(user_id)
        anchor_day = local_date(anchor)
        count = WINDOW_DAYS[window]
        first_day = anchor_day - timedelta(days=count - 1)
        return [(first_day + timedelta(days=offset)).isoformat() for offset in range(count)]

    async def _anchor_timestamp(self, user_id: str) -> datetime:
        candidates: list[datetime | None] = []
        candidates.append(
            await self.db.scalar(
                select(func.max(HealthObservation.timestamp)).where(HealthObservation.user_id == user_id)
            )
        )
        candidates.append(
            await self.db.scalar(
                select(func.max(HealthInterval.end_time)).where(HealthInterval.user_id == user_id)
            )
        )
        candidates.append(
            await self.db.scalar(
                select(func.max(HealthNutritionRecord.timestamp)).where(HealthNutritionRecord.user_id == user_id)
            )
        )
        candidates.append(
            await self.db.scalar(
                select(func.max(HealthHydrationRecord.end_time)).where(HealthHydrationRecord.user_id == user_id)
            )
        )
        candidates.append(
            await self.db.scalar(
                select(func.max(HealthSyncRun.data_end)).where(
                    HealthSyncRun.user_id == user_id,
                    HealthSyncRun.status == "success",
                )
            )
        )
        concrete = [candidate for candidate in candidates if candidate is not None]
        anchor = max(concrete) if concrete else datetime.utcnow().replace(tzinfo=timezone.utc)
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=timezone.utc)
        return min(anchor, now)

from collections import Counter, defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HealthRawBatch, HealthSourcePreference

DOMAINS = ("activity", "sleep", "workouts", "nutrition")

DOMAIN_RECORD_TYPES = {
    "activity": ("Steps", "ActiveCaloriesBurned", "TotalCaloriesBurned", "Distance"),
    "sleep": ("SleepSession",),
    "workouts": ("ExerciseSession",),
    "nutrition": ("Nutrition", "Hydration"),
}

DEFAULT_SOURCE_HINTS = {
    "activity": None,
    "sleep": "ultrahuman",
    "workouts": "garmin",
    "nutrition": None,
}


def data_origin(metadata: dict | None) -> str | None:
    if not isinstance(metadata, dict):
        return None
    origin = metadata.get("dataOrigin")
    return str(origin) if origin else None


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return normalize_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def record_dedupe_id(record: dict, record_type: str, origin: str) -> str:
    metadata = record.get("metadata") or {}
    return str(
        metadata.get("id")
        or metadata.get("clientRecordId")
        or f"{record_type}:{record.get('startTime') or record.get('time')}:{record.get('endTime')}:{origin}"
    )


def display_source(source: str | None) -> str:
    if not source:
        return "Auto"
    value = source.lower()
    if "garmin" in value:
        return "Garmin"
    if "ultrahuman" in value:
        return "Ultrahuman"
    if "google" in value:
        return "Google Fit"
    if value == "android":
        return "Android"
    return source


class SourceConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def config(self, user_id: str) -> dict:
        detected = await self.detected_sources(user_id)
        preferred = await self.preferred_sources(user_id)
        effective = self.effective_sources(detected, preferred)
        return {
            "detected_sources": detected,
            "preferred_sources": preferred,
            "effective_sources": effective,
            "source_badge": self.source_badge(effective),
        }

    async def detected_sources(self, user_id: str) -> dict[str, list[str]]:
        result = await self.db.execute(
            select(HealthRawBatch.payload)
            .where(HealthRawBatch.user_id == user_id)
            .order_by(HealthRawBatch.received_at.desc())
            .limit(100)
        )
        counters: dict[str, Counter[str]] = {domain: Counter() for domain in DOMAINS}
        recency: dict[str, dict[str, int]] = {domain: {} for domain in DOMAINS}

        for index, payload in enumerate(result.scalars().all()):
            if not isinstance(payload, dict):
                continue
            raw_records = payload.get("raw_records") or {}
            for domain, record_types in DOMAIN_RECORD_TYPES.items():
                for record_type in record_types:
                    for record in raw_records.get(record_type) or []:
                        origin = data_origin((record or {}).get("metadata"))
                        if origin:
                            counters[domain][origin] += 1
                            recency[domain].setdefault(origin, index)
            for record in payload.get("sleep") or []:
                origin = data_origin((record or {}).get("metadata"))
                if origin:
                    counters["sleep"][origin] += 1
                    recency["sleep"].setdefault(origin, index)
            for record in payload.get("workouts") or []:
                origin = data_origin((record or {}).get("metadata"))
                if origin:
                    counters["workouts"][origin] += 1
                    recency["workouts"].setdefault(origin, index)
            for record in [*(payload.get("nutrition") or []), *(payload.get("hydration") or [])]:
                origin = data_origin((record or {}).get("metadata"))
                if origin:
                    counters["nutrition"][origin] += 1
                    recency["nutrition"].setdefault(origin, index)

        return {
            domain: sorted(
                counters[domain],
                key=lambda origin: (-counters[domain][origin], recency[domain].get(origin, 10_000), origin),
            )
            for domain in DOMAINS
        }

    async def preferred_sources(self, user_id: str) -> dict[str, str | None]:
        result = await self.db.execute(
            select(HealthSourcePreference).where(HealthSourcePreference.user_id == user_id)
        )
        stored = {row.domain: row.preferred_source for row in result.scalars().all()}
        return {domain: stored.get(domain) for domain in DOMAINS}

    async def set_preferences(self, user_id: str, preferences: dict[str, str | None]) -> dict:
        result = await self.db.execute(
            select(HealthSourcePreference).where(HealthSourcePreference.user_id == user_id)
        )
        by_domain = {row.domain: row for row in result.scalars().all()}
        for domain, source in preferences.items():
            if domain not in DOMAINS:
                continue
            if not source:
                continue
            if domain in by_domain:
                by_domain[domain].preferred_source = source
                by_domain[domain].updated_at = datetime.utcnow()
            else:
                self.db.add(HealthSourcePreference(user_id=user_id, domain=domain, preferred_source=source))
        await self.db.commit()
        return await self.config(user_id)

    def effective_sources(self, detected: dict[str, list[str]], preferred: dict[str, str | None]) -> dict[str, str | None]:
        return {
            domain: self._effective_source(domain, detected.get(domain) or [], preferred.get(domain))
            for domain in DOMAINS
        }

    def _effective_source(self, domain: str, detected: list[str], preferred: str | None) -> str | None:
        if not detected:
            return None
        if preferred:
            matched = self._match_source(detected, preferred)
            if matched:
                return matched
        hint = DEFAULT_SOURCE_HINTS.get(domain)
        if hint:
            matched = self._match_source(detected, hint)
            if matched:
                return matched
        return detected[0]

    def _match_source(self, detected: list[str], requested: str) -> str | None:
        requested_lower = requested.lower()
        for source in detected:
            if source == requested:
                return source
        for source in detected:
            if requested_lower in source.lower():
                return source
        return None

    def source_badge(self, effective: dict[str, str | None]) -> str:
        concrete = {source for source in effective.values() if source}
        if len(concrete) == 1:
            return display_source(next(iter(concrete)))
        if len(concrete) > 1:
            return "Custom"
        return "Auto"


def selected_raw_daily_sums(
    payloads: list[dict],
    *,
    record_type: str,
    value_path: list[str],
    selected_source: str | None,
    start: datetime,
    allowed_days: set[str] | None = None,
    day_tz: ZoneInfo | None = None,
) -> dict[str, dict]:
    by_day_records: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    start = normalize_datetime(start)
    for payload in payloads:
        for record in ((payload.get("raw_records") or {}).get(record_type) or []):
            origin = data_origin((record or {}).get("metadata")) or "unknown"
            record_end = parse_iso(record.get("endTime") or record.get("time"))
            if not record_end or record_end < start:
                continue
            dedupe_id = record_dedupe_id(record, record_type, origin)
            value: object = record
            for key in value_path:
                value = value.get(key) if isinstance(value, dict) else None
                if value is None:
                    break
            if value is None:
                continue
            numeric_value = float(value)
            day = record_end.date().isoformat()
            if day_tz is not None:
                day = record_end.replace(tzinfo=timezone.utc).astimezone(day_tz).date().isoformat()
            if allowed_days is not None and day not in allowed_days:
                continue
            previous = by_day_records[day][origin].get(dedupe_id)
            if previous is None or numeric_value > previous:
                by_day_records[day][origin][dedupe_id] = numeric_value

    selected: dict[str, dict] = {}
    for day, source_records in by_day_records.items():
        sources = {
            source: {"total": sum(records.values()), "records": len(records)}
            for source, records in source_records.items()
        }
        source = selected_source if selected_source in sources else next(iter(sources))
        selected[day] = {
            "source": source,
            "total": sources[source]["total"],
            "records": sources[source]["records"],
        }
    return selected

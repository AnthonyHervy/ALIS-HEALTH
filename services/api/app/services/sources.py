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

DIAGNOSTIC_METRICS = {
    "activity": {
        "steps": {
            "label": "Pas",
            "unit": "count",
            "raw_type": "Steps",
            "payload_key": "steps",
            "value_paths": (("count",),),
            "payload_value_path": ("count",),
            "aggregate": "sum",
        },
        "active_calories": {
            "label": "Calories actives",
            "unit": "kcal",
            "raw_type": "ActiveCaloriesBurned",
            "payload_key": "calories",
            "value_paths": (("energy", "inKilocalories"), ("calories",)),
            "payload_value_path": ("calories",),
            "aggregate": "sum",
        },
        "distance": {
            "label": "Distance",
            "unit": "m",
            "raw_type": "Distance",
            "payload_key": "distance",
            "value_paths": (("distance", "inMeters"), ("meters",)),
            "payload_value_path": ("meters",),
            "aggregate": "sum",
        },
    },
    "sleep": {
        "sleep": {
            "label": "Sommeil",
            "unit": "min",
            "raw_type": "SleepSession",
            "payload_key": "sleep",
            "value_paths": (),
            "payload_value_path": (),
            "aggregate": "duration_minutes",
        },
    },
    "workouts": {
        "workouts": {
            "label": "Sport",
            "unit": "session",
            "raw_type": "ExerciseSession",
            "payload_key": "workouts",
            "value_paths": (),
            "payload_value_path": (),
            "aggregate": "count",
        },
    },
    "nutrition": {
        "nutrition": {
            "label": "Nutrition",
            "unit": "kcal",
            "raw_type": "Nutrition",
            "payload_key": "nutrition",
            "value_paths": (("energy", "inKilocalories"), ("energy_kcal",)),
            "payload_value_path": ("energy_kcal",),
            "aggregate": "sum",
        },
        "hydration": {
            "label": "Hydratation",
            "unit": "L",
            "raw_type": "Hydration",
            "payload_key": "hydration",
            "value_paths": (("volume", "inLiters"), ("volume_liters",)),
            "payload_value_path": ("volume_liters",),
            "aggregate": "sum",
        },
    },
    "biometrics": {
        "heart_rate": {
            "label": "Frequence cardiaque",
            "unit": "bpm",
            "payload_key": "heart_rate",
            "payload_value_path": ("bpm",),
            "aggregate": "average",
        },
        "hrv": {
            "label": "Variabilite cardiaque",
            "unit": "ms",
            "payload_key": "hrv",
            "payload_value_path": ("rmssd_ms",),
            "aggregate": "average",
        },
        "resting_heart_rate": {
            "label": "Frequence au repos",
            "unit": "bpm",
            "payload_key": "resting_heart_rate",
            "payload_value_path": ("bpm",),
            "aggregate": "average",
        },
        "vo2_max": {
            "label": "VO2 max",
            "unit": "ml/kg/min",
            "payload_key": "vo2_max",
            "payload_value_path": ("ml_per_kg_min",),
            "aggregate": "average",
        },
    },
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

    async def diagnostics(self, user_id: str, source_config: dict | None = None) -> dict:
        source_config = source_config or await self.config(user_id)
        result = await self.db.execute(
            select(HealthRawBatch.payload)
            .where(HealthRawBatch.user_id == user_id)
            .order_by(HealthRawBatch.received_at.desc())
            .limit(250)
        )
        payloads = [payload for payload in result.scalars().all() if isinstance(payload, dict)]
        effective_sources = source_config.get("effective_sources") or {}
        return {
            "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
            "domains": {
                domain: {
                    "selected_source": effective_sources.get(domain),
                    "selected_source_label": display_source(effective_sources.get(domain)),
                    "metrics": {
                        metric: self._metric_diagnostic(
                            payloads,
                            domain=domain,
                            metric=metric,
                            definition=definition,
                            selected_source=effective_sources.get(domain),
                        )
                        for metric, definition in metrics.items()
                    },
                }
                for domain, metrics in DIAGNOSTIC_METRICS.items()
            },
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

    def _metric_diagnostic(
        self,
        payloads: list[dict],
        *,
        domain: str,
        metric: str,
        definition: dict,
        selected_source: str | None,
    ) -> dict:
        records_by_source: dict[str, dict[str, dict]] = defaultdict(dict)
        for payload in payloads:
            raw_records = (payload.get("raw_records") or {}).get(definition.get("raw_type")) or []
            if raw_records:
                for record in raw_records:
                    self._add_diagnostic_record(records_by_source, record, definition, metric)
                continue
            for record in payload.get(definition.get("payload_key") or "") or []:
                self._add_diagnostic_record(records_by_source, record, definition, metric, payload_record=True)

        sources = []
        for source, records in records_by_source.items():
            values = [float(item["value"]) for item in records.values()]
            total = self._aggregate_values(values, definition.get("aggregate"))
            latest_at = max((item["latest_at"] for item in records.values() if item.get("latest_at")), default=None)
            sources.append(
                {
                    "source": source,
                    "source_label": display_source(source),
                    "total": total,
                    "records": len(records),
                    "latest_received_at": self._json_timestamp(latest_at),
                    "selected": False,
                }
            )
        sources.sort(key=lambda item: (item["source_label"], item["source"]))

        retained_source = self._retained_source(sources, selected_source)
        retained = next((item for item in sources if item["source"] == retained_source), None)
        for item in sources:
            item["selected"] = item["source"] == retained_source

        status = "received" if retained else "not_received"
        return {
            "metric": metric,
            "label": definition.get("label") or metric,
            "domain": domain,
            "unit": definition.get("unit"),
            "status": status,
            "selected_source": retained_source,
            "selected_source_label": display_source(retained_source),
            "selected_value": retained.get("total") if retained else None,
            "selected_records": retained.get("records") if retained else 0,
            "latest_received_at": retained.get("latest_received_at") if retained else None,
            "sources": sources,
        }

    def _add_diagnostic_record(
        self,
        records_by_source: dict[str, dict[str, dict]],
        record: dict,
        definition: dict,
        metric: str,
        payload_record: bool = False,
    ) -> None:
        if not isinstance(record, dict):
            return
        metadata = record.get("metadata") or {}
        source = data_origin(metadata) or "unknown"
        value = self._diagnostic_value(record, definition, payload_record)
        if value is None:
            return
        latest_at = self._diagnostic_timestamp(record)
        dedupe_id = self._diagnostic_dedupe_id(record, metric, source, payload_record)
        existing = records_by_source[source].get(dedupe_id)
        if existing is None or float(value) > float(existing["value"]):
            records_by_source[source][dedupe_id] = {"value": float(value), "latest_at": latest_at}

    def _diagnostic_value(self, record: dict, definition: dict, payload_record: bool = False) -> float | None:
        aggregate = definition.get("aggregate")
        if aggregate == "count":
            return 1.0
        if aggregate == "duration_minutes":
            start = parse_iso(record.get("startTime") or record.get("start_time"))
            end = parse_iso(record.get("endTime") or record.get("end_time"))
            if start and end:
                return max(0.0, (end - start).total_seconds() / 60)
            return None

        paths = (definition.get("payload_value_path"),) if payload_record else definition.get("value_paths") or ()
        for path in paths:
            value = self._value_at_path(record, path)
            if value is not None:
                return float(value)
        return None

    def _diagnostic_timestamp(self, record: dict) -> datetime | None:
        return parse_iso(
            record.get("endTime")
            or record.get("end_time")
            or record.get("time")
            or record.get("timestamp")
            or record.get("startTime")
            or record.get("start_time")
        )

    def _diagnostic_dedupe_id(self, record: dict, metric: str, source: str, payload_record: bool) -> str:
        metadata = record.get("metadata") or {}
        explicit = metadata.get("id") or metadata.get("clientRecordId")
        if explicit:
            return str(explicit)
        if not payload_record:
            return record_dedupe_id(record, metric, source)
        return str(
            record.get("id")
            or f"{metric}:{record.get('start_time') or record.get('timestamp')}:{record.get('end_time')}:{source}"
        )

    def _retained_source(self, sources: list[dict], selected_source: str | None) -> str | None:
        if not sources:
            return None
        if selected_source and any(item["source"] == selected_source for item in sources):
            return selected_source
        return max(sources, key=lambda item: (float(item["total"] or 0), item["records"], item["source"]))["source"]

    @staticmethod
    def _aggregate_values(values: list[float], aggregate: str | None) -> float:
        if not values:
            return 0.0
        if aggregate == "average":
            return round(sum(values) / len(values), 2)
        if aggregate == "count":
            return float(len(values))
        return round(sum(values), 2)

    @staticmethod
    def _value_at_path(record: dict, path: tuple[str, ...] | list[str] | None) -> float | None:
        value: object = record
        for key in path or ():
            value = value.get(key) if isinstance(value, dict) else None
            if value is None:
                return None
        if value is None:
            return None
        return float(value)

    @staticmethod
    def _json_timestamp(value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc).isoformat()


def selected_raw_daily_sums(
    payloads: list[dict],
    *,
    record_type: str,
    value_path: list[str],
    selected_source: str | None,
    start: datetime,
    allowed_days: set[str] | None = None,
    day_tz: ZoneInfo | None = None,
    fallback_to_best_source_ratio: float | None = None,
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
        if fallback_to_best_source_ratio:
            best_source, best_values = max(sources.items(), key=lambda item: item[1]["total"])
            selected_total = sources[source]["total"]
            if best_source != source and (
                (selected_total <= 0 and best_values["total"] > 0)
                or best_values["total"] >= selected_total * fallback_to_best_source_ratio
            ):
                source = best_source
        selected[day] = {
            "source": source,
            "total": sources[source]["total"],
            "records": sources[source]["records"],
        }
    return selected

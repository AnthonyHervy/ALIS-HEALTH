from collections import Counter, defaultdict
from datetime import datetime, timezone
from math import isfinite
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

STEP_CORRECTION_RATIO = 1.5
CONFLICT_RATIO = 1.5

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
    if "fitbit" in value:
        return "Fitbit"
    if "samsung" in value:
        return "Samsung Health"
    if "withings" in value:
        return "Withings"
    if "whoop" in value or "noop" in value:
        return "Whoop"
    if value == "android" or "android.healthconnect.phone" in value or "healthconnect.phone" in value:
        return "Phone"
    return source


def _safe_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if isfinite(numeric) else None


def build_data_reliability_summary(diagnostics: dict, *, local_day: str | None = None) -> dict:
    day = local_day or _diagnostic_local_day(diagnostics)
    summaries = {}
    for domain, domain_payload in (diagnostics.get("domains") or {}).items():
        for metric_name, metric_payload in ((domain_payload or {}).get("metrics") or {}).items():
            summaries[metric_name] = _metric_reliability_summary(
                metric_name,
                domain,
                metric_payload or {},
                day,
            )
    return {"generated_at": diagnostics.get("generated_at"), "metrics": summaries}


def compact_coach_source_reliability(data_reliability: dict | None) -> dict:
    metrics = (data_reliability or {}).get("metrics") or {}
    return {
        metric: {
            "status": payload.get("status"),
            "confidence": payload.get("confidence"),
            "selected_source": payload.get("selected_source"),
            "selected_source_label": payload.get("selected_source_label"),
            "selected_value": payload.get("selected_value"),
            "latest_received_at": payload.get("latest_received_at"),
            "unit": payload.get("unit"),
            "coach_reason": payload.get("coach_reason"),
        }
        for metric, payload in metrics.items()
        if (payload or {}).get("status") in {"partial", "corrected", "conflict", "missing"}
    }


def enrich_dashboard_reliability_payload(payload: dict | None) -> dict:
    enriched = dict(payload or {})
    data_reliability = enriched.get("data_reliability")
    if not isinstance(data_reliability, dict):
        diagnostics = enriched.get("source_diagnostics") or {}
        if diagnostics:
            data_reliability = build_data_reliability_summary(diagnostics)
            enriched["data_reliability"] = data_reliability
        else:
            data_reliability = None

    coach_summary = dict(enriched.get("coach_summary") or {})
    if coach_summary or data_reliability:
        coach_summary["source_reliability"] = compact_coach_source_reliability(data_reliability)
        enriched["coach_summary"] = coach_summary
    return enriched


def _metric_reliability_summary(
    metric_name: str,
    domain: str,
    metric_payload: dict,
    local_day: str | None,
) -> dict:
    metric = metric_payload.get("metric") or metric_name
    unit = metric_payload.get("unit")
    sources = [
        _reliability_source(source_payload, unit)
        for source_payload in metric_payload.get("sources") or []
        if isinstance(source_payload, dict)
    ]
    selected = _selected_reliability_source(sources, metric_payload.get("selected_source"))
    best = _best_reliability_source(sources)
    fresh_best = _best_reliability_source(sources, local_day)
    if _source_value(selected) is not None:
        retained = selected
    elif fresh_best is not None:
        retained = fresh_best
    else:
        retained = best if selected is None else None
    retained_value = _source_value(retained)

    if retained is None or retained_value is None:
        return _missing_reliability_summary(metric, domain, unit, sources)

    status = "measured"
    confidence = "high"
    badge_label = "Fiable"
    conflict_source = None

    if (
        metric == "steps"
        and selected is not None
        and fresh_best is not None
        and fresh_best.get("source") != selected.get("source")
    ):
        selected_value = _source_value(selected)
        best_value = _source_value(fresh_best)
        if (
            selected_value is not None
            and best_value is not None
            and ((selected_value <= 0 and best_value > 0) or best_value >= selected_value * STEP_CORRECTION_RATIO)
        ):
            retained = fresh_best
            retained_value = best_value
            status = "corrected"
            confidence = "medium"
            badge_label = "Corrige"

    if status == "measured" and selected is not None and retained.get("source") == selected.get("source"):
        conflict_source = _conflicting_source(sources, retained, local_day)
        if conflict_source is not None:
            status = "conflict"
            confidence = "medium"
            badge_label = "A verifier"

    if status == "measured" and not _timestamp_matches_local_day(retained.get("latest_received_at"), local_day):
        status = "partial"
        confidence = "medium" if confidence == "high" else confidence
        badge_label = "A verifier"

    _annotate_reliability_sources(sources, retained, selected, status, conflict_source)
    selected_label = retained.get("source_label") or display_source(retained.get("source"))
    return {
        "metric": metric,
        "domain": metric_payload.get("domain") or domain,
        "status": status,
        "confidence": confidence,
        "selected_source": retained.get("source"),
        "selected_source_label": selected_label,
        "selected_value": retained.get("value"),
        "unit": unit,
        "latest_received_at": retained.get("latest_received_at"),
        "badge_label": badge_label,
        "user_explanation": _reliability_user_explanation(metric, status, selected_label, local_day),
        "coach_reason": _reliability_coach_reason(metric, status, selected_label, conflict_source, local_day),
        "sources": sources,
    }


def _reliability_source(source_payload: dict, unit: str | None) -> dict:
    source = source_payload.get("source")
    return {
        "source": source,
        "source_label": source_payload.get("source_label") or display_source(source),
        "value": source_payload.get("total"),
        "unit": unit,
        "latest_received_at": source_payload.get("latest_received_at"),
        "selected": bool(source_payload.get("selected")),
        "note": "",
    }


def _missing_reliability_summary(metric: str, domain: str, unit: str | None, sources: list[dict]) -> dict:
    for source in sources:
        source["selected"] = False
        source["note"] = "Source disponible sans valeur exploitable"
    return {
        "metric": metric,
        "domain": domain,
        "status": "missing",
        "confidence": "low",
        "selected_source": None,
        "selected_source_label": "Auto",
        "selected_value": None,
        "unit": unit,
        "latest_received_at": None,
        "badge_label": "A verifier",
        "user_explanation": f"Donnee {metric} pas recue par les sources connectees.",
        "coach_reason": (
            "Une donnee manquante ne signifie pas que l'utilisateur n'a pas produit ce comportement; "
            "elle indique seulement que la source ne l'a pas transmis."
        ),
        "sources": sources,
    }


def _selected_reliability_source(sources: list[dict], selected_source: str | None) -> dict | None:
    selected = next((source for source in sources if source.get("selected")), None)
    if selected is not None:
        return selected
    if selected_source:
        return next((source for source in sources if source.get("source") == selected_source), None)
    return None


def _best_reliability_source(sources: list[dict], local_day: str | None = None) -> dict | None:
    candidates = [
        source
        for source in sources
        if _source_value(source) is not None
        and _timestamp_matches_local_day(source.get("latest_received_at"), local_day)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda source: (_source_value(source) or 0.0, str(source.get("source") or "")))


def _conflicting_source(sources: list[dict], retained: dict, local_day: str | None = None) -> dict | None:
    retained_value = _source_value(retained)
    if retained_value is None:
        return None
    for source in sources:
        if source.get("source") == retained.get("source"):
            continue
        if not _timestamp_matches_local_day(source.get("latest_received_at"), local_day):
            continue
        value = _source_value(source)
        if value is None:
            continue
        if _values_conflict(retained_value, value):
            return source
    return None


def _values_conflict(left: float, right: float) -> bool:
    larger = max(left, right)
    smaller = min(left, right)
    if smaller <= 0:
        return larger > 0
    return larger >= smaller * CONFLICT_RATIO


def _source_value(source: dict | None) -> float | None:
    if not source:
        return None
    return _safe_float(source.get("value"))


def _annotate_reliability_sources(
    sources: list[dict],
    retained: dict,
    selected: dict | None,
    status: str,
    conflict_source: dict | None,
) -> None:
    retained_source = retained.get("source")
    selected_source = selected.get("source") if selected else None
    conflict_source_name = conflict_source.get("source") if conflict_source else None
    for source in sources:
        source_name = source.get("source")
        source["selected"] = source_name == retained_source
        if status == "corrected" and source_name == selected_source and source_name != retained_source:
            source["note"] = "Source retenue semblait partielle"
        elif status == "corrected" and source_name == retained_source:
            source["note"] = "Source retenue apres correction"
        elif status == "conflict" and source_name == conflict_source_name:
            source["note"] = "Ecart important avec la source retenue"
        elif status == "partial" and source_name == retained_source:
            source["note"] = "Derniere reception hors de la journee locale"
        elif source_name == retained_source:
            source["note"] = "Source retenue"
        else:
            source["note"] = "Source disponible"


def _reliability_user_explanation(metric: str, status: str, source_label: str, local_day: str | None) -> str:
    if status == "corrected":
        return f"Donnee {metric} ajustee avec {source_label}, la source la plus complete disponible."
    if status == "conflict":
        return f"Donnee {metric} a verifier: {source_label} differe fortement d'une autre source."
    if status == "partial":
        day_text = f" pour {local_day}" if local_day else ""
        return f"Donnee {metric} partielle: derniere reception {source_label} hors de la journee locale{day_text}."
    return f"Donnee {metric} recue depuis {source_label}."


def _reliability_coach_reason(
    metric: str,
    status: str,
    source_label: str,
    conflict_source: dict | None,
    local_day: str | None,
) -> str:
    if status == "corrected":
        return f"La source retenue semblait partielle; {source_label} presente une valeur plus complete pour {metric}."
    if status == "conflict":
        conflict_label = (conflict_source or {}).get("source_label") or "une autre source"
        return (
            f"{source_label} reste la source retenue, mais {conflict_label} presente un ecart "
            "d'au moins 50%; a verifier avant interpretation."
        )
    if status == "partial":
        day_text = f" {local_day}" if local_day else " la journee locale"
        return f"La valeur existe, mais son horodatage n'est pas sur{day_text} en Europe/Paris; lire cette donnee comme partielle."
    return f"{source_label} est la source retenue pour {metric}; aucune incoherence majeure n'est detectee."


def _diagnostic_local_day(diagnostics: dict) -> str | None:
    candidate_timestamps = []
    for domain_payload in (diagnostics.get("domains") or {}).values():
        for metric_payload in ((domain_payload or {}).get("metrics") or {}).values():
            latest_received_at = (metric_payload or {}).get("latest_received_at")
            parsed_metric = parse_iso(latest_received_at)
            if parsed_metric is not None:
                candidate_timestamps.append(parsed_metric)
            for source_payload in (metric_payload or {}).get("sources") or []:
                parsed_source = parse_iso((source_payload or {}).get("latest_received_at"))
                if parsed_source is not None:
                    candidate_timestamps.append(parsed_source)
    if candidate_timestamps:
        anchor = max(candidate_timestamps)
        return anchor.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Europe/Paris")).date().isoformat()

    generated_at = parse_iso(diagnostics.get("generated_at"))
    if generated_at is None:
        return None
    return generated_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Europe/Paris")).date().isoformat()


def _timestamp_matches_local_day(timestamp: str | None, local_day: str | None) -> bool:
    if not local_day:
        return True
    received_at = parse_iso(timestamp)
    if received_at is None:
        return False
    received_day = received_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Europe/Paris")).date().isoformat()
    return received_day == local_day


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
                return value
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
        return _safe_float(value)

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
            numeric_value = _safe_float(value)
            if numeric_value is None:
                continue
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
        source = (
            selected_source
            if selected_source in sources
            else max(
                sources.items(),
                key=lambda item: (item[1]["total"], item[1]["records"], item[0]),
            )[0]
        )
        if fallback_to_best_source_ratio:
            best_source, best_values = max(
                sources.items(),
                key=lambda item: (item[1]["total"], item[1]["records"], item[0]),
            )
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

# Data Reliability Center + Coach IA v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-facing data reliability summaries to ALIS and feed compact reliability context into the AI coach.

**Architecture:** Extend the existing source diagnostics pipeline rather than adding persistence. The API computes `data_reliability` from source diagnostics and selected dashboard values, then exposes it to mobile and a compact version to `coach_summary`. Mobile renders small badges on Today cards and a product-grade detail surface while keeping raw diagnostics in advanced Settings.

**Tech Stack:** FastAPI/Python, SQLAlchemy, pytest, Expo React Native/TypeScript, Jest, existing ALIS i18n helper.

---

## File Structure

- Modify `services/api/app/services/sources.py`
  - Add `DataReliabilitySummary` construction helpers.
  - Reuse `SourceConfigService.diagnostics`, `display_source`, and metric aggregation.
- Modify `services/api/app/services/context.py`
  - Include `data_reliability` in dashboard bundles and compact `source_reliability` in `coach_summary`.
- Modify `services/api/tests/test_sources.py`
  - Add direct unit tests for reliability status decisions.
- Modify `services/api/tests/test_context_api.py`
  - Add dashboard integration tests.
- Modify `services/api/tests/test_coach_api.py`
  - Add coach summary and fallback behavior tests.
- Modify `apps/mobile/src/types.ts`
  - Add `DataReliabilitySummary`, `MetricReliabilitySummary`, and `ReliabilityStatus`.
- Modify `apps/mobile/src/dashboard.ts`
  - Add reliability presentation helpers.
- Modify `apps/mobile/src/dashboard.test.ts`
  - Add FR/EN helper tests and no-debug-copy expectations.
- Modify `apps/mobile/src/i18n.ts`
  - Add FR/EN labels for reliability badges and detail UI.
- Modify `apps/mobile/src/i18n.test.ts`
  - Assert new keys exist in both languages.
- Modify `apps/mobile/App.tsx`
  - Add reliability badges to Today metric tiles.
  - Add a simple reliability detail panel/sheet.
  - Keep advanced diagnostics in Settings.

---

## Task 1: API Reliability Summary Unit Tests

**Files:**
- Modify: `services/api/tests/test_sources.py`
- Later Modify: `services/api/app/services/sources.py`

- [x] **Step 1: Write failing tests for reliability decisions**

Add these tests to `services/api/tests/test_sources.py`:

```python
from app.services.sources import build_data_reliability_summary


def metric(metric_name: str, *, selected_source: str | None, selected_label: str, selected_value: float | None, sources: list[dict], unit: str = "count") -> dict:
    return {
        "metric": metric_name,
        "label": metric_name,
        "domain": "activity",
        "unit": unit,
        "status": "received" if selected_value is not None else "not_received",
        "selected_source": selected_source,
        "selected_source_label": selected_label,
        "selected_value": selected_value,
        "selected_records": 1 if selected_value is not None else 0,
        "latest_received_at": "2026-06-14T12:00:00+00:00" if selected_value is not None else None,
        "sources": sources,
    }


def test_reliability_marks_complete_preferred_source_as_measured():
    diagnostics = {
        "generated_at": "2026-06-14T12:00:00+00:00",
        "domains": {
            "activity": {
                "selected_source": "com.garmin.android.apps.connectmobile",
                "selected_source_label": "Garmin",
                "metrics": {
                    "steps": metric(
                        "steps",
                        selected_source="com.garmin.android.apps.connectmobile",
                        selected_label="Garmin",
                        selected_value=12000,
                        sources=[
                            {
                                "source": "com.garmin.android.apps.connectmobile",
                                "source_label": "Garmin",
                                "total": 12000,
                                "records": 3,
                                "latest_received_at": "2026-06-14T12:00:00+00:00",
                                "selected": True,
                            }
                        ],
                    )
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    steps = summary["metrics"]["steps"]
    assert steps["status"] == "measured"
    assert steps["confidence"] == "high"
    assert steps["badge_label"] == "Fiable"
    assert "Garmin" in steps["user_explanation"]


def test_reliability_marks_step_fallback_as_corrected_when_best_source_is_1_5x_higher():
    diagnostics = {
        "generated_at": "2026-06-14T12:00:00+00:00",
        "domains": {
            "activity": {
                "selected_source": "android",
                "selected_source_label": "Android",
                "metrics": {
                    "steps": metric(
                        "steps",
                        selected_source="android",
                        selected_label="Android",
                        selected_value=6000,
                        sources=[
                            {
                                "source": "android",
                                "source_label": "Android",
                                "total": 6000,
                                "records": 1,
                                "latest_received_at": "2026-06-14T08:00:00+00:00",
                                "selected": True,
                            },
                            {
                                "source": "com.garmin.android.apps.connectmobile",
                                "source_label": "Garmin",
                                "total": 15459,
                                "records": 3,
                                "latest_received_at": "2026-06-14T12:00:00+00:00",
                                "selected": False,
                            },
                        ],
                    )
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    steps = summary["metrics"]["steps"]
    assert steps["status"] == "corrected"
    assert steps["confidence"] == "medium"
    assert steps["selected_source_label"] == "Garmin"
    assert steps["selected_value"] == 15459
    assert steps["badge_label"] == "Corrige"
    assert "source retenue semblait partielle" in steps["coach_reason"]


def test_reliability_marks_missing_metric_without_implying_zero_behavior():
    diagnostics = {
        "generated_at": "2026-06-14T12:00:00+00:00",
        "domains": {
            "biometrics": {
                "selected_source": None,
                "selected_source_label": "Auto",
                "metrics": {
                    "hrv": {
                        "metric": "hrv",
                        "label": "Variabilite cardiaque",
                        "domain": "biometrics",
                        "unit": "ms",
                        "status": "not_received",
                        "selected_source": None,
                        "selected_source_label": "Auto",
                        "selected_value": None,
                        "selected_records": 0,
                        "latest_received_at": None,
                        "sources": [],
                    }
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    hrv = summary["metrics"]["hrv"]
    assert hrv["status"] == "missing"
    assert hrv["confidence"] == "low"
    assert "pas recue" in hrv["user_explanation"].lower()
    assert "ne signifie pas" in hrv["coach_reason"].lower()
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
rtk uv run --extra dev pytest tests/test_sources.py -q
```

From `services/api`.

Expected: failure importing `build_data_reliability_summary`.

- [x] **Step 3: Commit RED tests**

```bash
rtk git add services/api/tests/test_sources.py
rtk git commit -m "test: cover data reliability summary decisions"
```

---

## Task 2: API Reliability Summary Implementation

**Files:**
- Modify: `services/api/app/services/sources.py`
- Test: `services/api/tests/test_sources.py`

- [x] **Step 1: Implement minimal reliability builder**

Add this public function and helpers near the existing diagnostic helpers in `services/api/app/services/sources.py`:

```python
STEP_CORRECTION_RATIO = 1.5
CONFLICT_RATIO = 1.5


def build_data_reliability_summary(diagnostics: dict, *, local_day: str | None = None) -> dict:
    metrics: dict[str, dict] = {}
    for domain, domain_payload in (diagnostics.get("domains") or {}).items():
        for metric_name, metric_payload in (domain_payload.get("metrics") or {}).items():
            metrics[metric_name] = _metric_reliability(metric_payload, local_day=local_day)
    return {
        "generated_at": diagnostics.get("generated_at"),
        "metrics": metrics,
    }


def _metric_reliability(metric: dict, *, local_day: str | None) -> dict:
    sources = [
        _reliability_source(item, metric.get("unit"))
        for item in metric.get("sources") or []
    ]
    selected = next((item for item in sources if item["selected"]), None)
    best = max(sources, key=lambda item: float(item.get("value") or 0), default=None)

    status = "missing"
    confidence = "low"
    retained = selected or best
    reason = "Donnée non recue pour cette métrique."

    if retained is not None:
        status = "measured"
        confidence = "high"
        reason = f"ALIS retient {retained['source_label']} pour {metric.get('label') or metric.get('metric')}."

    if metric.get("metric") == "steps" and selected and best and best["source"] != selected["source"]:
        selected_value = float(selected.get("value") or 0)
        best_value = float(best.get("value") or 0)
        if selected_value <= 0 or best_value >= selected_value * STEP_CORRECTION_RATIO:
            retained = best
            status = "corrected"
            confidence = "medium"
            reason = f"ALIS retient {best['source_label']} car la source retenue semblait partielle."
        elif best_value >= selected_value * CONFLICT_RATIO:
            status = "conflict"
            confidence = "medium"
            reason = f"ALIS retient {selected['source_label']}, mais une autre source diffère fortement."

    if retained is not None and _is_stale(retained.get("latest_received_at"), local_day):
        status = "partial" if status == "measured" else status
        confidence = "medium" if confidence == "high" else confidence
        reason = f"{reason} La dernière donnée ne vient pas du jour affiché."

    if retained is None:
        coach_reason = (
            f"{metric.get('label') or metric.get('metric')} non recue dans ALIS; "
            "cela ne signifie pas que l'utilisateur n'a pas produit cette donnée."
        )
        return {
            "metric": metric.get("metric"),
            "domain": metric.get("domain"),
            "status": "missing",
            "confidence": "low",
            "selected_source": None,
            "selected_source_label": "Auto",
            "selected_value": None,
            "unit": metric.get("unit"),
            "latest_received_at": None,
            "badge_label": "A verifier",
            "user_explanation": f"{metric.get('label') or metric.get('metric')} pas recue par ALIS pour cette période.",
            "coach_reason": coach_reason,
            "sources": sources,
        }

    return {
        "metric": metric.get("metric"),
        "domain": metric.get("domain"),
        "status": status,
        "confidence": confidence,
        "selected_source": retained.get("source"),
        "selected_source_label": retained.get("source_label") or display_source(retained.get("source")),
        "selected_value": retained.get("value"),
        "unit": metric.get("unit"),
        "latest_received_at": retained.get("latest_received_at"),
        "badge_label": _badge_label(status),
        "user_explanation": reason,
        "coach_reason": reason,
        "sources": sources,
    }
```

Add helper functions below it:

```python
def _reliability_source(source: dict, unit: str | None) -> dict:
    return {
        "source": source.get("source"),
        "source_label": source.get("source_label") or display_source(source.get("source")),
        "value": source.get("total"),
        "unit": unit,
        "latest_received_at": source.get("latest_received_at"),
        "selected": bool(source.get("selected")),
        "note": None,
    }


def _badge_label(status: str) -> str:
    return {
        "measured": "Fiable",
        "partial": "Partiel",
        "corrected": "Corrige",
        "missing": "A verifier",
        "conflict": "A verifier",
    }.get(status, "A verifier")


def _is_stale(timestamp: str | None, local_day: str | None) -> bool:
    if not timestamp or not local_day:
        return False
    parsed = parse_iso(timestamp)
    if parsed is None:
        return False
    return parsed.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Europe/Paris")).date().isoformat() != local_day
```

- [x] **Step 2: Run Task 1 tests to verify GREEN**

Run:

```bash
rtk uv run --extra dev pytest tests/test_sources.py -q
```

From `services/api`.

Expected: all `test_sources.py` tests pass.

- [x] **Step 3: Keep API labels product-neutral**

Confirm the API returns stable status values and simple fallback labels only. User-facing accented French labels and English labels belong in mobile i18n, not in API language branching.

- [x] **Step 4: Commit implementation**

```bash
rtk git add services/api/app/services/sources.py
rtk git commit -m "feat: build data reliability summaries"
```

---

## Task 3: Dashboard and Coach Summary Integration

**Files:**
- Modify: `services/api/app/services/context.py`
- Modify: `services/api/tests/test_context_api.py`
- Modify: `services/api/tests/test_coach_api.py`
- Test: `services/api/tests/test_context_api.py`, `services/api/tests/test_coach_api.py`

- [x] **Step 1: Write dashboard integration test**

Add to `services/api/tests/test_context_api.py` near the existing source diagnostics tests:

```python
async def test_dashboard_bundle_exposes_data_reliability_for_steps(test_app):
    async with test_app() as (client, _):
        token = await register_device(client)
        headers = {"Authorization": f"Bearer {token}"}
        await client.post(
            "/api/v1/ingest/health",
            json={
                "source_type": "healthconnect",
                "timezone": "Europe/Paris",
                "raw_records": {
                    "Steps": [
                        {
                            "startTime": "2026-06-14T07:00:00+02:00",
                            "endTime": "2026-06-14T09:00:00+02:00",
                            "count": 6000,
                            "metadata": {"id": "android-partial", "dataOrigin": "android"},
                        },
                        {
                            "startTime": "2026-06-14T07:00:00+02:00",
                            "endTime": "2026-06-14T12:00:00+02:00",
                            "count": 15459,
                            "metadata": {"id": "garmin-complete", "dataOrigin": "com.garmin.android.apps.connectmobile"},
                        },
                    ]
                },
            },
            headers=headers,
        )
        response = await client.get("/api/v1/context/dashboard?refresh=true", headers=headers)

    payload = response.json()
    steps = payload["data_reliability"]["metrics"]["steps"]
    assert steps["status"] == "corrected"
    assert steps["selected_source_label"] == "Garmin"
    assert steps["selected_value"] == 15459
    assert payload["coach_summary"]["source_reliability"]["steps"]["status"] == "corrected"
```

- [x] **Step 2: Write coach fallback test**

Add to `services/api/tests/test_coach_api.py`:

```python
def test_coach_fallback_mentions_corrected_steps_reliability_when_relevant():
    context = {
        "coach_summary": {
            "version": "2026-06-14.1",
            "windows": {
                "last_24h": {
                    "steps": 15459,
                    "sleep_minutes": 420,
                    "workout_minutes": 0,
                },
                "week": {
                    "average_daily_steps": 9000,
                    "workout_minutes": 180,
                },
            },
            "source_reliability": {
                "steps": {
                    "status": "corrected",
                    "confidence": "medium",
                    "selected_source_label": "Garmin",
                    "coach_reason": "ALIS retient Garmin car la source retenue semblait partielle.",
                }
            },
        }
    }

    response = CoachService._fallback_chat(context, "Pourquoi mes pas sont différents ?")

    assert "Garmin" in response
    assert "partielle" in response.lower()
```

- [x] **Step 3: Run tests to verify RED**

Run:

```bash
rtk uv run --extra dev pytest tests/test_context_api.py::test_dashboard_bundle_exposes_data_reliability_for_steps tests/test_coach_api.py::test_coach_fallback_mentions_corrected_steps_reliability_when_relevant -q
```

From `services/api`.

Expected: failures because `data_reliability` is not included and fallback does not mention it.

- [x] **Step 4: Implement dashboard integration**

In `services/api/app/services/context.py`, import:

```python
from app.services.sources import SourceConfigService, build_data_reliability_summary
```

In the function that builds dashboard payloads, after source diagnostics are available, compute:

```python
data_reliability = build_data_reliability_summary(
    source_diagnostics,
    local_day=local_date(await self._anchor_timestamp(user_id)).isoformat(),
)
payload["data_reliability"] = data_reliability
payload["coach_summary"]["source_reliability"] = _compact_reliability_for_coach(data_reliability)
```

Add helper near coach summary helpers:

```python
def _compact_reliability_for_coach(data_reliability: dict | None) -> dict:
    metrics = (data_reliability or {}).get("metrics") or {}
    return {
        key: {
            "status": value.get("status"),
            "confidence": value.get("confidence"),
            "selected_source_label": value.get("selected_source_label"),
            "selected_value": value.get("selected_value"),
            "unit": value.get("unit"),
            "coach_reason": value.get("coach_reason"),
        }
        for key, value in metrics.items()
        if value.get("status") in {"partial", "corrected", "conflict", "missing"}
    }
```

- [x] **Step 5: Implement coach fallback reliability sentence**

In `services/api/app/services/coach.py`, update `_fallback_chat_from_summary` after `reliability = summary.get("source_reliability") or {}`:

```python
steps_reliability = reliability.get("steps") or reliability.get("activity") or {}
reliability_note = ""
if steps_reliability.get("status") in {"partial", "corrected", "conflict"}:
    reason = steps_reliability.get("coach_reason") or ""
    source = steps_reliability.get("selected_source_label") or selected_source
    reliability_note = (
        f" ALIS keeps a reliability note on movement: {reason or f'the selected source is {source} with medium confidence.'}"
        if language == "en"
        else f" ALIS garde une réserve de fiabilité sur le mouvement: {reason or f'la source retenue est {source} avec une confiance moyenne.'}"
    )
```

Then append `reliability_note` to the movement sentence in both language branches.

- [x] **Step 6: Run integration tests to verify GREEN**

Run:

```bash
rtk uv run --extra dev pytest tests/test_context_api.py::test_dashboard_bundle_exposes_data_reliability_for_steps tests/test_coach_api.py::test_coach_fallback_mentions_corrected_steps_reliability_when_relevant -q
```

From `services/api`.

Expected: both tests pass.

- [x] **Step 7: Commit dashboard/coach integration**

```bash
rtk git add services/api/app/services/context.py services/api/app/services/coach.py services/api/tests/test_context_api.py services/api/tests/test_coach_api.py
rtk git commit -m "feat: expose reliability context to dashboard and coach"
```

---

## Task 4: Mobile Types and Reliability Presentation Helpers

**Files:**
- Modify: `apps/mobile/src/types.ts`
- Modify: `apps/mobile/src/dashboard.ts`
- Modify: `apps/mobile/src/dashboard.test.ts`
- Modify: `apps/mobile/src/i18n.ts`
- Modify: `apps/mobile/src/i18n.test.ts`

- [x] **Step 1: Write failing mobile helper tests**

Add to `apps/mobile/src/dashboard.test.ts`:

```typescript
test('formats reliability badge and detail in French without debug terms', () => {
  const summary = {
    generated_at: '2026-06-14T12:00:00+00:00',
    metrics: {
      steps: {
        metric: 'steps',
        domain: 'activity',
        status: 'corrected',
        confidence: 'medium',
        selected_source: 'com.garmin.android.apps.connectmobile',
        selected_source_label: 'Garmin',
        selected_value: 15459,
        unit: 'count',
        latest_received_at: '2026-06-14T12:00:00+00:00',
        badge_label: 'Corrige',
        user_explanation: 'ALIS retient Garmin car la source retenue semblait partielle.',
        coach_reason: 'ALIS retient Garmin car la source retenue semblait partielle.',
        sources: [
          { source: 'android', source_label: 'Android', value: 6000, unit: 'count', latest_received_at: '2026-06-14T08:00:00+00:00', selected: false, note: null },
          { source: 'com.garmin.android.apps.connectmobile', source_label: 'Garmin', value: 15459, unit: 'count', latest_received_at: '2026-06-14T12:00:00+00:00', selected: true, note: null }
        ]
      }
    }
  } as const;

  const formatted = formatReliabilityMetric(summary, 'steps', 'fr');

  expect(formatted?.badge).toBe('Corrigé');
  expect(formatted?.tone).toBe('warning');
  expect(formatted?.title).toBe('Pas');
  expect(formatted?.selected).toContain('Garmin');
  expect(formatted?.sources.join(' ')).not.toMatch(/payload|batch|records|com\.garmin/);
});

test('formats reliability badge and detail in English', () => {
  const summary = {
    generated_at: '2026-06-14T12:00:00+00:00',
    metrics: {
      hrv: {
        metric: 'hrv',
        domain: 'biometrics',
        status: 'missing',
        confidence: 'low',
        selected_source: null,
        selected_source_label: 'Auto',
        selected_value: null,
        unit: 'ms',
        latest_received_at: null,
        badge_label: 'A verifier',
        user_explanation: 'Variabilite cardiaque pas recue par ALIS pour cette période.',
        coach_reason: 'HRV not received in ALIS.',
        sources: []
      }
    }
  } as const;

  const formatted = formatReliabilityMetric(summary, 'hrv', 'en');

  expect(formatted?.badge).toBe('Check');
  expect(formatted?.title).toBe('Heart rate variability');
  expect(formatted?.selected).toBe('Data not received');
});
```

Add to `apps/mobile/src/i18n.test.ts`:

```typescript
test('contains reliability copy in French and English', () => {
  expect(t('fr', 'reliability.title')).toBe('Sources et fiabilité');
  expect(t('en', 'reliability.title')).toBe('Sources & reliability');
  expect(t('fr', 'reliability.corrected')).toBe('Corrigé');
  expect(t('en', 'reliability.corrected')).toBe('Corrected');
});
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
rtk npm test -- --runInBand src/dashboard.test.ts src/i18n.test.ts
```

From `apps/mobile`.

Expected: failure because `formatReliabilityMetric` and i18n keys do not exist.

- [x] **Step 3: Add TypeScript types**

Add to `apps/mobile/src/types.ts`:

```typescript
export type ReliabilityStatus = 'measured' | 'partial' | 'corrected' | 'missing' | 'conflict';
export type ReliabilityConfidence = 'high' | 'medium' | 'low';

export type MetricReliabilitySummary = {
  metric: string;
  domain: 'activity' | 'sleep' | 'workouts' | 'biometrics';
  status: ReliabilityStatus;
  confidence: ReliabilityConfidence;
  selected_source?: string | null;
  selected_source_label: string;
  selected_value?: number | null;
  unit?: string | null;
  latest_received_at?: string | null;
  badge_label: string;
  user_explanation: string;
  coach_reason: string;
  sources: Array<{
    source: string;
    source_label: string;
    value?: number | null;
    unit?: string | null;
    latest_received_at?: string | null;
    selected: boolean;
    note?: string | null;
  }>;
};

export type DataReliabilitySummary = {
  generated_at?: string | null;
  metrics: Record<string, MetricReliabilitySummary>;
};
```

Add to `DashboardData`:

```typescript
data_reliability?: DataReliabilitySummary;
```

- [x] **Step 4: Add i18n keys**

Add FR keys to `apps/mobile/src/i18n.ts`:

```typescript
'reliability.title': 'Sources et fiabilité',
'reliability.reliable': 'Fiable',
'reliability.partial': 'Partiel',
'reliability.corrected': 'Corrigé',
'reliability.check': 'À vérifier',
'reliability.selectedSource': 'Source retenue',
'reliability.notReceived': 'Donnée non reçue',
'reliability.sourcesCompared': 'Sources comparées',
```

Add EN keys:

```typescript
'reliability.title': 'Sources & reliability',
'reliability.reliable': 'Reliable',
'reliability.partial': 'Partial',
'reliability.corrected': 'Corrected',
'reliability.check': 'Check',
'reliability.selectedSource': 'Selected source',
'reliability.notReceived': 'Data not received',
'reliability.sourcesCompared': 'Compared sources',
```

- [x] **Step 5: Implement presentation helper**

In `apps/mobile/src/dashboard.ts`, import types:

```typescript
import type { DataReliabilitySummary, MetricReliabilitySummary } from './types';
```

Add:

```typescript
export type ReliabilityPresentation = {
  metric: string;
  title: string;
  badge: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  selected: string;
  explanation: string;
  sources: string[];
};

export function formatReliabilityMetric(
  summary: DataReliabilitySummary | undefined | null,
  metric: string,
  language: AppLanguage = 'fr'
): ReliabilityPresentation | null {
  const item = summary?.metrics?.[metric];
  if (!item) {
    return null;
  }
  const selected = item.selected_value == null
    ? language === 'en' ? 'Data not received' : 'Donnée non reçue'
    : `${language === 'en' ? 'Selected source' : 'Source retenue'} : ${item.selected_source_label}`;
  return {
    metric,
    title: reliabilityMetricTitle(item, language),
    badge: reliabilityBadge(item.status, language),
    tone: reliabilityTone(item.status),
    selected,
    explanation: item.user_explanation,
    sources: item.sources.map((source) => `${source.source_label} · ${formatReliabilityValue(source.value ?? null, item.unit ?? source.unit, language)}`)
  };
}

function reliabilityBadge(status: MetricReliabilitySummary['status'], language: AppLanguage): string {
  if (status === 'measured') return language === 'en' ? 'Reliable' : 'Fiable';
  if (status === 'partial') return language === 'en' ? 'Partial' : 'Partiel';
  if (status === 'corrected') return language === 'en' ? 'Corrected' : 'Corrigé';
  return language === 'en' ? 'Check' : 'À vérifier';
}

function reliabilityTone(status: MetricReliabilitySummary['status']): ReliabilityPresentation['tone'] {
  if (status === 'measured') return 'success';
  if (status === 'partial' || status === 'corrected') return 'warning';
  if (status === 'missing' || status === 'conflict') return 'danger';
  return 'info';
}
```

Add these helper functions below `reliabilityTone`:

```typescript
function reliabilityMetricTitle(item: MetricReliabilitySummary, language: AppLanguage): string {
  if (item.metric === 'steps') return language === 'en' ? 'Steps' : 'Pas';
  if (item.metric === 'sleep') return language === 'en' ? 'Sleep' : 'Sommeil';
  if (item.metric === 'workouts') return language === 'en' ? 'Sport' : 'Sport';
  if (item.metric === 'active_calories') return language === 'en' ? 'Active calories' : 'Dépense calorique';
  if (item.metric === 'heart_rate') return language === 'en' ? 'Heart rate' : 'Fréquence cardiaque';
  if (item.metric === 'hrv') return language === 'en' ? 'Heart rate variability' : 'Variabilité cardiaque';
  if (item.metric === 'vo2_max') return 'VO2 max';
  return item.metric;
}

function formatReliabilityValue(value: number | null, unit: string | null | undefined, language: AppLanguage): string {
  if (value == null || !Number.isFinite(value)) {
    return language === 'en' ? 'not received' : 'non reçu';
  }
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const formatted = rounded.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (unit === 'count') return language === 'en' ? `${formatted} steps` : `${formatted} pas`;
  if (unit === 'session') return language === 'en' ? `${formatted} session${rounded > 1 ? 's' : ''}` : `${formatted} séance${rounded > 1 ? 's' : ''}`;
  if (unit === 'kcal') return `${formatted} kcal`;
  if (unit === 'ms') return `${formatted} ms`;
  if (unit === 'bpm') return `${formatted} bpm`;
  return unit ? `${formatted} ${unit}` : formatted;
}
```

- [x] **Step 6: Run helper tests to verify GREEN**

Run:

```bash
rtk npm test -- --runInBand src/dashboard.test.ts src/i18n.test.ts
```

From `apps/mobile`.

Expected: helper and i18n tests pass.

- [x] **Step 7: Commit mobile helper layer**

```bash
rtk git add apps/mobile/src/types.ts apps/mobile/src/dashboard.ts apps/mobile/src/dashboard.test.ts apps/mobile/src/i18n.ts apps/mobile/src/i18n.test.ts
rtk git commit -m "feat: format mobile reliability summaries"
```

---

## Task 5: Mobile Today Badges and Reliability Detail Surface

**Files:**
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/dashboard.test.ts`
- Test: `apps/mobile/src/dashboard.test.ts`, `apps/mobile/src/i18n.test.ts`

- [x] **Step 1: Add helper test for badge visibility**

Add to `apps/mobile/src/dashboard.test.ts`:

```typescript
test('omits reliability badge for high-confidence measured metrics by default', () => {
  const summary = {
    generated_at: '2026-06-14T12:00:00+00:00',
    metrics: {
      steps: {
        metric: 'steps',
        domain: 'activity',
        status: 'measured',
        confidence: 'high',
        selected_source: 'com.garmin.android.apps.connectmobile',
        selected_source_label: 'Garmin',
        selected_value: 12000,
        unit: 'count',
        latest_received_at: '2026-06-14T12:00:00+00:00',
        badge_label: 'Fiable',
        user_explanation: 'ALIS retient Garmin pour les pas.',
        coach_reason: 'ALIS retient Garmin pour les pas.',
        sources: []
      }
    }
  } as const;

  expect(shouldShowReliabilityBadge(formatReliabilityMetric(summary, 'steps', 'fr'))).toBe(false);
});

test('shows reliability badge for corrected partial conflict and missing metrics', () => {
  expect(shouldShowReliabilityBadge({ status: 'corrected' } as never)).toBe(true);
  expect(shouldShowReliabilityBadge({ status: 'partial' } as never)).toBe(true);
  expect(shouldShowReliabilityBadge({ status: 'conflict' } as never)).toBe(true);
  expect(shouldShowReliabilityBadge({ status: 'missing' } as never)).toBe(true);
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
rtk npm test -- --runInBand src/dashboard.test.ts
```

From `apps/mobile`.

Expected: failure because `shouldShowReliabilityBadge` does not exist or presentation lacks status.

- [x] **Step 3: Extend presentation helper**

In `apps/mobile/src/dashboard.ts`, add `status` to `ReliabilityPresentation` and implement:

```typescript
export function shouldShowReliabilityBadge(item: Pick<ReliabilityPresentation, 'status'> | null): boolean {
  return !!item && item.status !== 'measured';
}
```

- [x] **Step 4: Add badge props to MetricTile**

In `apps/mobile/App.tsx`, update `MetricTile` props:

```typescript
reliability?: ReliabilityPresentation | null;
onReliabilityPress?: (metric: string) => void;
```

Add this local style selector near `MetricTile`:

```typescript
function reliabilityBadgeStyle(tone: ReliabilityPresentation['tone']) {
  if (tone === 'success') return styles.reliabilityBadgeSuccess;
  if (tone === 'warning') return styles.reliabilityBadgeWarning;
  if (tone === 'danger') return styles.reliabilityBadgeDanger;
  return styles.reliabilityBadgeInfo;
}
```

Inside `MetricTile`, render a compact `Pressable` in the card header when `shouldShowReliabilityBadge(reliability)` is true:

```tsx
{shouldShowReliabilityBadge(reliability) ? (
  <Pressable
    style={[styles.reliabilityBadge, reliabilityBadgeStyle(reliability.tone)]}
    onPress={() => onReliabilityPress?.(reliability.metric)}
  >
    <Text style={styles.reliabilityBadgeText}>{reliability.badge}</Text>
  </Pressable>
) : null}
```

- [x] **Step 5: Pass reliability into Today tiles**

In `TodayStrip`, add props:

```typescript
reliabilitySummary?: DataReliabilitySummary | null;
onReliabilityPress?: (metric: string) => void;
```

Compute:

```typescript
const stepsReliability = formatReliabilityMetric(reliabilitySummary, 'steps', language);
const sportReliability = formatReliabilityMetric(reliabilitySummary, 'workouts', language);
const caloriesReliability = formatReliabilityMetric(reliabilitySummary, 'active_calories', language);
const cardioReliability = formatReliabilityMetric(reliabilitySummary, 'heart_rate', language);
```

Pass the relevant reliability prop to each `MetricTile`.

- [x] **Step 6: Add detail surface state**

In the main `App` component, add:

```typescript
const [selectedReliabilityMetric, setSelectedReliabilityMetric] = useState<string | null>(null);
const selectedReliability = formatReliabilityMetric(dashboard?.data_reliability, selectedReliabilityMetric ?? '', language);
```

Render a modal or in-app panel:

```tsx
<Modal visible={!!selectedReliability} transparent animationType="slide" onRequestClose={() => setSelectedReliabilityMetric(null)}>
  <View style={styles.modalBackdrop}>
    <View style={styles.reliabilityPanel}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>{copy('reliability.title')}</Text>
        <Pressable onPress={() => setSelectedReliabilityMetric(null)}>
          <Text style={styles.closeButtonText}>×</Text>
        </Pressable>
      </View>
      {selectedReliability ? (
        <>
          <Text style={styles.metricLabel}>{selectedReliability.title}</Text>
          <Text style={styles.heroMetric}>{selectedReliability.badge}</Text>
          <Text style={styles.bodyText}>{selectedReliability.selected}</Text>
          <Text style={styles.metricDetail}>{selectedReliability.explanation}</Text>
          <Text style={styles.inputLabel}>{copy('reliability.sourcesCompared')}</Text>
          {selectedReliability.sources.map((source) => (
            <Text key={source} style={styles.bodyText}>{source}</Text>
          ))}
        </>
      ) : null}
    </View>
  </View>
</Modal>
```

- [x] **Step 7: Run mobile tests and type-check**

Run:

```bash
rtk npm test -- --runInBand src/dashboard.test.ts src/i18n.test.ts
rtk npm run type-check
```

From `apps/mobile`.

Expected: tests and type-check pass.

- [x] **Step 8: Commit mobile UI**

```bash
rtk git add apps/mobile/App.tsx apps/mobile/src/dashboard.ts apps/mobile/src/dashboard.test.ts
rtk git commit -m "feat: show reliability badges on today cards"
```

---

## Task 6: Full Verification, Security, and Cleanup

**Files:**
- All modified files

- [x] **Step 1: Run API test suite**

Run:

```bash
rtk uv run --extra dev pytest tests -q
```

From:

```bash
cd services/api
```

Expected: all API tests pass.

- [x] **Step 2: Run mobile test suite and type-check**

Run:

```bash
rtk npm ci
rtk npm test -- --runInBand
rtk npm run type-check
```

From:

```bash
cd apps/mobile
```

Expected: all Jest tests pass and TypeScript succeeds.

- [x] **Step 3: Remove generated local dependencies before security scan**

Run from repo root:

```bash
rtk rm -rf apps/mobile/node_modules services/api/.venv services/api/.pytest_cache services/api/app/__pycache__ services/api/app/core/__pycache__ services/api/app/services/__pycache__ services/api/app/services/nutrition/__pycache__ services/api/tests/__pycache__
```

- [x] **Step 4: Run security check**

Run:

```bash
rtk bash scripts/security-check.sh
```

Expected: `Security check passed.`

- [x] **Step 5: Inspect final diff**

Run:

```bash
rtk git status --short
rtk git diff --check
rtk git log --oneline --decorate -8
```

Expected: no whitespace errors, only intended files changed or committed.

- [x] **Step 6: Verify no uncommitted verification artifacts remain**

```bash
rtk git status --short
```

Expected: no generated dependency directories, caches, APKs, or accidental files. If source files are unexpectedly modified, stop and inspect before continuing.

---

## Task 7: Optional Device Push After Review

**Files:**
- Android build outputs generated outside committed source

- [x] **Step 1: Build release APK from ALIS-HEALTH mobile source**

Run from `apps/mobile/android` if Android project is present:

```bash
rtk ./gradlew assembleRelease
```

Expected: release APK builds successfully.

- [x] **Step 2: Install on connected phone**

Run:

```bash
rtk adb devices
rtk adb install -r app/build/outputs/apk/release/app-release.apk
```

Expected: `Success`.

- [x] **Step 3: Manual acceptance**

On device:

- Open ALIS.
- Sync Health Connect.
- Confirm Today cards stay visually clean.
- Confirm corrected/partial badges appear only when relevant.
- Tap a reliability badge and confirm the detail panel opens.
- Ask Coach why a step value differs from Garmin and confirm it explains source reliability conversationally.

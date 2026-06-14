from datetime import UTC, datetime

from app.services.sources import build_data_reliability_summary, selected_raw_daily_sums


def metric(
    metric_name: str,
    *,
    selected_source: str | None,
    selected_label: str,
    selected_value: float | None,
    sources: list[dict],
    unit: str = "count",
) -> dict:
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
        "latest_received_at": (
            "2026-06-14T12:00:00+00:00" if selected_value is not None else None
        ),
        "sources": sources,
    }


def test_selected_raw_daily_sums_handles_timezone_aware_window_start():
    payloads = [
        {
            "raw_records": {
                "Steps": [
                    {
                        "startTime": "2026-05-19T08:00:00+00:00",
                        "endTime": "2026-05-19T20:00:00+00:00",
                        "count": 17334,
                        "metadata": {
                            "id": "steps-garmin",
                            "dataOrigin": "com.garmin.android.apps.connectmobile",
                        },
                    }
                ]
            }
        }
    ]

    totals = selected_raw_daily_sums(
        payloads,
        record_type="Steps",
        value_path=["count"],
        selected_source="com.garmin.android.apps.connectmobile",
        start=datetime(2026, 5, 19, 0, 0, tzinfo=UTC),
    )

    assert totals["2026-05-19"]["total"] == 17334


def test_selected_raw_daily_sums_can_fallback_when_selected_source_is_incomplete():
    payloads = [
        {
            "raw_records": {
                "Steps": [
                    {
                        "startTime": "2026-06-14T06:00:00+00:00",
                        "endTime": "2026-06-14T18:52:00+00:00",
                        "count": 6371,
                        "metadata": {
                            "id": "garmin-partial",
                            "dataOrigin": "com.garmin.android.apps.connectmobile",
                        },
                    },
                    {
                        "startTime": "2026-06-14T06:00:00+00:00",
                        "endTime": "2026-06-14T18:53:00+00:00",
                        "count": 16843,
                        "metadata": {
                            "id": "health-connect-complete",
                            "dataOrigin": "com.android.healthconnect.phone.example",
                        },
                    },
                ]
            }
        }
    ]

    totals = selected_raw_daily_sums(
        payloads,
        record_type="Steps",
        value_path=["count"],
        selected_source="com.garmin.android.apps.connectmobile",
        start=datetime(2026, 6, 14, 0, 0, tzinfo=UTC),
        fallback_to_best_source_ratio=1.5,
    )

    assert totals["2026-06-14"]["source"] == "com.android.healthconnect.phone.example"
    assert totals["2026-06-14"]["total"] == 16843


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

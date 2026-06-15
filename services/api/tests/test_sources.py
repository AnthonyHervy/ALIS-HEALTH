from datetime import UTC, datetime

from app.services.sources import (
    SourceConfigService,
    build_data_reliability_summary,
    selected_raw_daily_sums,
)


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


def test_metric_diagnostic_skips_malformed_numeric_values():
    service = SourceConfigService(db=None)
    diagnostic = service._metric_diagnostic(
        [
            {
                "raw_records": {
                    "Steps": [
                        {
                            "startTime": "2026-06-14T06:00:00+00:00",
                            "endTime": "2026-06-14T18:52:00+00:00",
                            "count": "bad",
                            "metadata": {
                                "id": "bad-steps",
                                "dataOrigin": "android",
                            },
                        }
                    ]
                }
            }
        ],
        domain="activity",
        metric="steps",
        definition={
            "label": "Pas",
            "unit": "count",
            "raw_type": "Steps",
            "payload_key": "steps",
            "value_paths": (("count",),),
            "payload_value_path": ("count",),
            "aggregate": "sum",
        },
        selected_source="android",
    )

    assert diagnostic["status"] == "not_received"
    assert diagnostic["selected_value"] is None
    assert diagnostic["sources"] == []


def test_selected_raw_daily_sums_skips_malformed_values_and_keeps_valid_records():
    payloads = [
        {
            "raw_records": {
                "Steps": [
                    {
                        "startTime": "2026-06-14T06:00:00+00:00",
                        "endTime": "2026-06-14T12:00:00+00:00",
                        "count": "bad",
                        "metadata": {"id": "bad-steps", "dataOrigin": "android"},
                    },
                    {
                        "startTime": "2026-06-14T06:00:00+00:00",
                        "endTime": "2026-06-14T18:00:00+00:00",
                        "count": 9000,
                        "metadata": {
                            "id": "valid-steps",
                            "dataOrigin": "com.garmin.android.apps.connectmobile",
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
    )

    assert totals["2026-06-14"]["source"] == "com.garmin.android.apps.connectmobile"
    assert totals["2026-06-14"]["total"] == 9000
    assert totals["2026-06-14"]["records"] == 1


def test_selected_raw_daily_sums_uses_best_source_when_selected_source_is_absent():
    garmin_record = {
        "startTime": "2026-06-14T06:00:00+00:00",
        "endTime": "2026-06-14T18:00:00+00:00",
        "count": 5000,
        "metadata": {
            "id": "garmin-steps",
            "dataOrigin": "com.garmin.android.apps.connectmobile",
        },
    }
    android_record = {
        "startTime": "2026-06-14T06:00:00+00:00",
        "endTime": "2026-06-14T18:00:00+00:00",
        "count": 9000,
        "metadata": {
            "id": "android-steps",
            "dataOrigin": "android",
        },
    }

    def totals_for(records: list[dict]) -> dict:
        return selected_raw_daily_sums(
            [{"raw_records": {"Steps": records}}],
            record_type="Steps",
            value_path=["count"],
            selected_source=None,
            start=datetime(2026, 6, 14, 0, 0, tzinfo=UTC),
        )

    first_order = totals_for([garmin_record, android_record])
    second_order = totals_for([android_record, garmin_record])

    assert first_order["2026-06-14"]["source"] == "android"
    assert second_order["2026-06-14"]["source"] == "android"
    assert first_order["2026-06-14"]["total"] == 9000
    assert second_order["2026-06-14"]["total"] == 9000


def test_selected_raw_daily_sums_uses_deterministic_best_source_for_ratio_fallback():
    selected_record = {
        "startTime": "2026-06-14T06:00:00+00:00",
        "endTime": "2026-06-14T18:00:00+00:00",
        "count": 1000,
        "metadata": {
            "id": "selected-steps",
            "dataOrigin": "android",
        },
    }
    source_a_record = {
        "startTime": "2026-06-14T06:00:00+00:00",
        "endTime": "2026-06-14T18:00:00+00:00",
        "count": 2000,
        "metadata": {
            "id": "source-a-steps",
            "dataOrigin": "source-a",
        },
    }
    source_z_record = {
        "startTime": "2026-06-14T06:00:00+00:00",
        "endTime": "2026-06-14T18:00:00+00:00",
        "count": 2000,
        "metadata": {
            "id": "source-z-steps",
            "dataOrigin": "source-z",
        },
    }

    def totals_for(records: list[dict]) -> dict:
        return selected_raw_daily_sums(
            [{"raw_records": {"Steps": records}}],
            record_type="Steps",
            value_path=["count"],
            selected_source="android",
            start=datetime(2026, 6, 14, 0, 0, tzinfo=UTC),
            fallback_to_best_source_ratio=1.5,
        )

    first_order = totals_for([selected_record, source_a_record, source_z_record])
    second_order = totals_for([selected_record, source_z_record, source_a_record])

    assert first_order["2026-06-14"]["source"] == "source-z"
    assert second_order["2026-06-14"]["source"] == "source-z"
    assert first_order["2026-06-14"]["total"] == 2000
    assert second_order["2026-06-14"]["total"] == 2000


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


def test_reliability_ignores_stale_alternate_sources_for_daily_decisions():
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
                                "total": 15000,
                                "records": 3,
                                "latest_received_at": "2026-06-13T12:00:00+00:00",
                                "selected": False,
                            },
                        ],
                    ),
                    "active_calories": metric(
                        "active_calories",
                        selected_source="android",
                        selected_label="Android",
                        selected_value=400,
                        sources=[
                            {
                                "source": "android",
                                "source_label": "Android",
                                "total": 400,
                                "records": 1,
                                "latest_received_at": "2026-06-14T08:00:00+00:00",
                                "selected": True,
                            },
                            {
                                "source": "com.garmin.android.apps.connectmobile",
                                "source_label": "Garmin",
                                "total": 900,
                                "records": 3,
                                "latest_received_at": "2026-06-13T12:00:00+00:00",
                                "selected": False,
                            },
                        ],
                        unit="kcal",
                    ),
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    steps = summary["metrics"]["steps"]
    assert steps["status"] == "measured"
    assert steps["confidence"] == "high"
    assert steps["selected_source_label"] == "Android"
    assert steps["selected_value"] == 6000
    garmin_steps = next(source for source in steps["sources"] if source["source_label"] == "Garmin")
    assert garmin_steps["selected"] is False

    active_calories = summary["metrics"]["active_calories"]
    assert active_calories["status"] == "measured"
    assert active_calories["confidence"] == "high"
    assert active_calories["selected_source_label"] == "Android"


def test_reliability_falls_back_when_selected_source_value_is_invalid():
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
                        selected_value=None,
                        sources=[
                            {
                                "source": "android",
                                "source_label": "Android",
                                "total": None,
                                "records": 1,
                                "latest_received_at": "2026-06-14T08:00:00+00:00",
                                "selected": True,
                            },
                            {
                                "source": "com.garmin.android.apps.connectmobile",
                                "source_label": "Garmin",
                                "total": 9000,
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
    assert steps["status"] != "missing"
    assert steps["selected_source_label"] == "Garmin"
    assert steps["selected_value"] == 9000


def test_reliability_marks_fresh_source_disagreement_as_conflict():
    diagnostics = {
        "generated_at": "2026-06-14T12:00:00+00:00",
        "domains": {
            "activity": {
                "selected_source": "android",
                "selected_source_label": "Android",
                "metrics": {
                    "active_calories": metric(
                        "active_calories",
                        selected_source="android",
                        selected_label="Android",
                        selected_value=400,
                        sources=[
                            {
                                "source": "android",
                                "source_label": "Android",
                                "total": 400,
                                "records": 1,
                                "latest_received_at": "2026-06-14T08:00:00+00:00",
                                "selected": True,
                            },
                            {
                                "source": "com.garmin.android.apps.connectmobile",
                                "source_label": "Garmin",
                                "total": 900,
                                "records": 3,
                                "latest_received_at": "2026-06-14T12:00:00+00:00",
                                "selected": False,
                            },
                        ],
                        unit="kcal",
                    )
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    active_calories = summary["metrics"]["active_calories"]
    assert active_calories["status"] == "conflict"
    assert active_calories["confidence"] == "medium"
    assert active_calories["badge_label"] == "A verifier"
    assert active_calories["selected_source_label"] == "Android"


def test_reliability_marks_stale_selected_source_as_partial():
    diagnostics = {
        "generated_at": "2026-06-14T12:00:00+00:00",
        "domains": {
            "activity": {
                "selected_source": "android",
                "selected_source_label": "Android",
                "metrics": {
                    "active_calories": metric(
                        "active_calories",
                        selected_source="android",
                        selected_label="Android",
                        selected_value=400,
                        sources=[
                            {
                                "source": "android",
                                "source_label": "Android",
                                "total": 400,
                                "records": 1,
                                "latest_received_at": "2026-06-13T12:00:00+00:00",
                                "selected": True,
                            }
                        ],
                        unit="kcal",
                    )
                },
            }
        },
    }

    summary = build_data_reliability_summary(diagnostics, local_day="2026-06-14")

    active_calories = summary["metrics"]["active_calories"]
    assert active_calories["status"] == "partial"
    assert active_calories["confidence"] == "medium"
    assert active_calories["badge_label"] == "A verifier"
    assert active_calories["selected_source_label"] == "Android"


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
    coach_reason = hrv["coach_reason"].lower()
    assert "ne signifie pas" in coach_reason
    assert "utilisateur" in coach_reason
    assert "produit" in coach_reason or "comportement" in coach_reason

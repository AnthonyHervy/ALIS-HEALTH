from datetime import UTC, datetime

from app.services.sources import selected_raw_daily_sums


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

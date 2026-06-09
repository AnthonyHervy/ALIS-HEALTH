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

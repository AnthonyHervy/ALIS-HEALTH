from app.models import Base


def test_all_database_tables_use_health_prefix():
    table_names = sorted(Base.metadata.tables)

    assert table_names
    assert all(name.startswith("health_") for name in table_names)
    assert {
        "health_users",
        "health_device_tokens",
        "health_data_sources",
        "health_raw_batches",
        "health_observations",
        "health_intervals",
        "health_sleep_sessions",
        "health_workouts",
        "health_nutrition_records",
        "health_hydration_records",
        "health_daily_aggregates",
        "health_sync_runs",
        "health_source_preferences",
        "health_agent_settings",
        "health_processing_jobs",
        "health_dashboard_snapshots",
        "health_nutrition_food_references",
        "health_nutrition_meals",
        "health_nutrition_meal_photos",
        "health_nutrition_analysis_jobs",
        "health_nutrition_meal_items",
    }.issubset(set(table_names))

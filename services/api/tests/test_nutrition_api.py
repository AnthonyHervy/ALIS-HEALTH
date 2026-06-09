from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.models import (
    HealthDeviceToken,
    HealthNutritionRecord,
    HealthUser,
    NutritionAnalysisJob,
    NutritionFoodReference,
    NutritionMeal,
    NutritionMealItem,
    NutritionMealPhoto,
)
from app.services.auth import hash_token
from app.services.nutrition.analysis import NutritionAnalysisService


class FakeMealAnalyzer:
    async def analyze(self, photos):
        return {
            "items": [
                {"name": "Riz cuit", "portion_g": 180, "confidence": "high"},
                {"name": "Sauce soja", "portion_g": 15, "barcode": "1234567890123", "confidence": "medium"},
            ],
            "confidence": "medium",
            "barcode_candidates": ["1234567890123"],
        }


class FakeOllamaTagsResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"models": [{"name": "qwen3-vl:30b"}]}


class FakeOllamaTagsClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, *args, **kwargs):
        return FakeOllamaTagsResponse()


def image_bytes(color: tuple[int, int, int] = (32, 120, 96)) -> bytes:
    output = BytesIO()
    Image.new("RGB", (12, 12), color).save(output, format="JPEG")
    return output.getvalue()


async def register(client: AsyncClient) -> dict[str, str]:
    registered = await client.post(
        "/api/v1/auth/register",
        json={"pairing_code": "dev-pairing-code", "device_name": "Nutrition Test"},
    )
    assert registered.status_code == 200
    return {"Authorization": f"Bearer {registered.json()['device_token']}"}


async def register_extra_user(db_session, test_app, token: str = "nutrition-test-extra-token") -> dict[str, str]:
    user = HealthUser()
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        HealthDeviceToken(
            user_id=user.id,
            token_hash=hash_token(test_app.state.settings.secret_key, token),
            device_name="Nutrition Test Extra",
        )
    )
    await db_session.commit()
    return {"Authorization": f"Bearer {token}"}


async def seed_references(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-rice",
                name="Riz cuit",
                energy_kcal_100g=130,
                protein_g_100g=2.7,
                carbohydrates_g_100g=28,
                fat_g_100g=0.3,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="openfoodfacts",
                source_id="off-soy-sauce",
                barcode="1234567890123",
                name="Sauce soja test",
                energy_kcal_100g=53,
                protein_g_100g=8,
                carbohydrates_g_100g=5,
                fat_g_100g=0,
                dataset_version="off-test",
            ),
        ]
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_nutrition_meal_lifecycle_upload_analyze_edit_and_validate(test_app, db_session, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_photo_retention = "thumbnail_only"
    await seed_references(db_session)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            data={"consumed_at": "2026-05-29T12:15:00+00:00", "meal_type": "lunch"},
            files=[
                ("photos", ("plate.jpg", image_bytes(), "image/jpeg")),
                ("photos", ("packaging.jpg", image_bytes((96, 64, 32)), "image/jpeg")),
            ],
        )

        assert created.status_code == 201
        meal_id = created.json()["id"]
        assert created.json()["status"] == "analyzing"
        assert created.json()["photo_count"] == 2
        assert created.json()["analysis_job"]["status"] == "pending"
        assert created.json()["analysis_job"]["attempts"] == 0

        listed = await client.get("/api/v1/nutrition/meals", headers=headers)
        assert listed.status_code == 200
        assert listed.json()["meals"][0]["id"] == meal_id
        assert listed.json()["meals"][0]["analysis_job"]["status"] == "pending"

        analyzed = await NutritionAnalysisService(db_session, analyzer=FakeMealAnalyzer()).run_next()
        assert analyzed is not None
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "ready"
        assert body["confidence"] == "medium"
        assert body["validation_blocked"] is False
        assert body["title"] == "Riz cuit, Sauce soja"
        assert body["kcal_min"] < body["energy_kcal"] < body["kcal_max"]
        assert {item["source"] for item in body["items"]} == {"ciqual", "openfoodfacts"}
        assert body["analysis_job"]["status"] == "completed"
        assert body["analysis_job"]["attempts"] == 1
        assert body["analysis_job"]["error_message"] is None

        rice = next(item for item in body["items"] if item["name"] == "Riz cuit")
        sauce = next(item for item in body["items"] if item["source"] == "openfoodfacts")
        edited = await client.patch(
            f"/api/v1/nutrition/meals/{meal_id}",
            headers=headers,
            json={
                "items": [
                    {"id": rice["id"], "portion_g": 200, "included": True},
                    {"id": sauce["id"], "included": False},
                ]
            },
        )
        assert edited.status_code == 200
        assert edited.json()["energy_kcal"] == pytest.approx(260)
        assert edited.json()["title"] == "Riz cuit"
        assert len([item for item in edited.json()["items"] if item["included"]]) == 1

        validated = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)
        assert validated.status_code == 200
        assert validated.json()["status"] == "validated"

        second_validation = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)
        assert second_validation.status_code == 200
        assert second_validation.json()["status"] == "validated"

    record = (await db_session.execute(select(HealthNutritionRecord))).scalars().one()
    assert record.name == "Nutrition meal"
    assert record.energy_kcal == pytest.approx(260)
    assert record.metadata_json["nutrition_meal_id"] == meal_id

    meal = await db_session.get(NutritionMeal, meal_id)
    assert meal is not None
    assert meal.status == "validated"
    assert meal.validated_nutrition_record_id == record.id

    items = (await db_session.execute(select(NutritionMealItem))).scalars().all()
    assert len(items) == 2

    photos = (await db_session.execute(select(NutritionMealPhoto))).scalars().all()
    assert len(photos) == 2
    assert all(photo.original_path is None for photo in photos)
    assert all(photo.thumbnail_path for photo in photos)


@pytest.mark.asyncio
async def test_nutrition_validation_is_blocked_when_analysis_has_unmatched_food(test_app, db_session, tmp_path):
    class UnknownFoodAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Mystery stew", "portion_g": 300, "confidence": "low"}],
                "confidence": "low",
            }

    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )

        assert created.status_code == 201
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=UnknownFoodAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["status"] == "needs_review"
        assert detail.json()["validation_blocked"] is True
        assert detail.json()["items"][0]["source"] is None

        blocked = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == "Meal has unmatched nutrition items"


@pytest.mark.asyncio
async def test_nutrition_review_can_remove_unmatched_food_and_validate(test_app, db_session, tmp_path):
    class MixedAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [
                    {"name": "Riz cuit", "portion_g": 150, "confidence": "high"},
                    {"name": "Mystery topping", "portion_g": 25, "confidence": "low"},
                ],
                "confidence": "low",
            }

    db_session.add(
        NutritionFoodReference(
            source="ciqual",
            source_id="ciqual-rice",
            name="Riz cuit",
            energy_kcal_100g=130,
            protein_g_100g=2.7,
            carbohydrates_g_100g=28,
            fat_g_100g=0.3,
            dataset_version="ciqual-2025-test",
        )
    )
    await db_session.commit()
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=MixedAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)
        unknown = next(item for item in detail.json()["items"] if item["source"] is None)

        edited = await client.patch(
            f"/api/v1/nutrition/meals/{meal_id}",
            headers=headers,
            json={"items": [{"id": unknown["id"], "included": False}]},
        )
        validated = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)

    assert edited.status_code == 200
    assert edited.json()["status"] == "ready"
    assert edited.json()["validation_blocked"] is False
    assert validated.status_code == 200
    assert validated.json()["status"] == "validated"
    assert validated.json()["energy_kcal"] == pytest.approx(195)


@pytest.mark.asyncio
async def test_nutrition_draft_meal_can_be_deleted_with_photos_and_jobs(test_app, db_session, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]
        deleted = await client.delete(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)
        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    assert deleted.status_code == 204
    assert detail.status_code == 404
    assert not (tmp_path / meal_id).exists()
    assert (await db_session.execute(select(NutritionMeal))).scalars().all() == []
    assert (await db_session.execute(select(NutritionMealPhoto))).scalars().all() == []
    assert (await db_session.execute(select(NutritionAnalysisJob))).scalars().all() == []


@pytest.mark.asyncio
async def test_nutrition_validated_meal_cannot_be_deleted(test_app, db_session, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    await seed_references(db_session)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=FakeMealAnalyzer()).run_next()
        await db_session.commit()
        validated = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)
        deleted = await client.delete(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    assert validated.status_code == 200
    assert deleted.status_code == 409
    assert deleted.json()["detail"] == "Validated meal cannot be deleted"
    assert await db_session.get(NutritionMeal, meal_id) is not None


@pytest.mark.asyncio
async def test_nutrition_review_can_search_reference_match_unknown_food_and_validate(
    test_app,
    db_session,
    tmp_path,
):
    class UnknownProteinAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Mystery protein", "portion_g": 120, "confidence": "low"}],
                "confidence": "low",
            }

    db_session.add(
        NutritionFoodReference(
            source="ciqual",
            source_id="ciqual-roast-chicken",
            name="Poulet roti, viande et peau",
            energy_kcal_100g=215,
            protein_g_100g=27,
            carbohydrates_g_100g=0,
            fat_g_100g=12,
            dataset_version="ciqual-2025-test",
        )
    )
    await db_session.commit()
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=UnknownProteinAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)
        unknown = detail.json()["items"][0]
        search = await client.get("/api/v1/nutrition/foods/search?q=poulet", headers=headers)
        reference_id = search.json()["foods"][0]["id"]

        edited = await client.patch(
            f"/api/v1/nutrition/meals/{meal_id}",
            headers=headers,
            json={"items": [{"id": unknown["id"], "reference_id": reference_id}]},
        )
        validated = await client.post(f"/api/v1/nutrition/meals/{meal_id}/validate", headers=headers)

    item = edited.json()["items"][0]
    assert search.status_code == 200
    assert search.json()["foods"][0]["name"] == "Poulet roti, viande et peau"
    assert edited.status_code == 200
    assert edited.json()["status"] == "ready"
    assert edited.json()["validation_blocked"] is False
    assert item["name"] == "Poulet roti, viande et peau"
    assert item["source"] == "ciqual"
    assert item["energy_kcal"] == pytest.approx(258)
    assert validated.status_code == 200
    assert validated.json()["energy_kcal"] == pytest.approx(258)
    assert validated.json()["dataset_versions"] == {"ciqual": "ciqual-2025-test"}


@pytest.mark.asyncio
async def test_nutrition_upload_rejects_too_many_photos(test_app, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_max_photos_per_meal = 2

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[
                ("photos", ("one.jpg", b"one", "image/jpeg")),
                ("photos", ("two.jpg", b"two", "image/jpeg")),
                ("photos", ("three.jpg", b"three", "image/jpeg")),
            ],
        )

    assert created.status_code == 422
    assert created.json()["detail"] == "At most 2 nutrition photos are allowed"


@pytest.mark.asyncio
async def test_nutrition_upload_rejects_non_image_photo(test_app, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("notes.txt", b"not an image", "text/plain"))],
        )

    assert created.status_code == 422
    assert created.json()["detail"] == "Nutrition photos must be jpeg, png, or webp images"


@pytest.mark.asyncio
async def test_nutrition_upload_rejects_invalid_image_bytes(test_app, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("spoofed.jpg", b"not really a jpeg", "image/jpeg"))],
        )

    assert created.status_code == 422
    assert created.json()["detail"] == "Nutrition photos must contain valid image data"


@pytest.mark.asyncio
async def test_nutrition_upload_rejects_unknown_meal_type(test_app, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            data={"meal_type": "late-night<script>"},
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )

    assert created.status_code == 422
    assert created.json()["detail"] == "Unknown nutrition meal type"


@pytest.mark.asyncio
async def test_nutrition_upload_rejects_oversized_photo(test_app, tmp_path):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_max_photo_bytes = 4

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("large.jpg", b"12345", "image/jpeg"))],
        )

    assert created.status_code == 413
    assert created.json()["detail"] == "Nutrition photo exceeds the 4 byte limit"


@pytest.mark.asyncio
async def test_nutrition_dataset_status_lists_loaded_reference_sources(test_app, db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-rice",
                name="Riz cuit",
                energy_kcal_100g=130,
                protein_g_100g=2.7,
                carbohydrates_g_100g=28,
                fat_g_100g=0.3,
                dataset_version="ciqual-2025-11-03",
            ),
            NutritionFoodReference(
                source="openfoodfacts",
                source_id="3017620422003",
                barcode="3017620422003",
                name="Pâte à tartiner noisettes",
                energy_kcal_100g=199.8,
                protein_g_100g=6.3,
                carbohydrates_g_100g=57.5,
                fat_g_100g=31,
                dataset_version="off-2026-05-fr",
            ),
        ]
    )
    await db_session.commit()

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        response = await client.get("/api/v1/nutrition/datasets/status", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "ciqual_loaded": True,
        "openfoodfacts_loaded": True,
        "total_references": 2,
        "sources": [
            {
                "source": "ciqual",
                "reference_count": 1,
                "dataset_versions": ["ciqual-2025-11-03"],
            },
            {
                "source": "openfoodfacts",
                "reference_count": 1,
                "dataset_versions": ["off-2026-05-fr"],
            },
        ],
    }


@pytest.mark.asyncio
async def test_nutrition_diagnostics_reports_datasets_ollama_and_jobs(test_app, db_session, monkeypatch):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeOllamaTagsClient)
    await seed_references(db_session)
    user = HealthUser()
    db_session.add(user)
    await db_session.flush()
    meal = NutritionMeal(user_id=user.id, status="analyzing")
    db_session.add(meal)
    await db_session.flush()
    db_session.add(
        NutritionAnalysisJob(
            user_id=user.id,
            meal_id=meal.id,
            status="pending",
            attempts=0,
        )
    )
    await db_session.commit()

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        response = await client.get("/api/v1/nutrition/diagnostics", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["api_status"] == "ok"
    assert body["datasets"]["ciqual_loaded"] is True
    assert body["datasets"]["openfoodfacts_loaded"] is True
    assert body["ollama"]["base_url"] == test_app.state.settings.nutrition_llm_base_url
    assert body["ollama"]["model"] == "qwen3-vl:30b"
    assert body["ollama"]["reachable"] is True
    assert body["ollama"]["model_available"] is True
    assert body["jobs"]["pending"] == 1
    assert body["jobs"]["running"] == 0
    assert body["jobs"]["failed"] == 0


@pytest.mark.asyncio
async def test_nutrition_diagnostics_counts_only_unresolved_failed_jobs(test_app, db_session, monkeypatch):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeOllamaTagsClient)
    user = HealthUser()
    db_session.add(user)
    await db_session.flush()
    recovered_meal = NutritionMeal(user_id=user.id, status="ready")
    failed_meal = NutritionMeal(user_id=user.id, status="error")
    db_session.add_all([recovered_meal, failed_meal])
    await db_session.flush()
    db_session.add_all(
        [
            NutritionAnalysisJob(user_id=user.id, meal_id=recovered_meal.id, status="failed", attempts=1),
            NutritionAnalysisJob(user_id=user.id, meal_id=recovered_meal.id, status="completed", attempts=1),
            NutritionAnalysisJob(user_id=user.id, meal_id=failed_meal.id, status="failed", attempts=1),
        ]
    )
    await db_session.commit()

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        response = await client.get("/api/v1/nutrition/diagnostics", headers=headers)

    assert response.status_code == 200
    assert response.json()["jobs"]["failed"] == 1


@pytest.mark.asyncio
async def test_nutrition_analysis_uses_global_barcode_candidate_for_unmatched_product(
    test_app,
    db_session,
    tmp_path,
):
    class PackagingAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Sauce soja", "portion_g": 15, "confidence": "medium"}],
                "confidence": "medium",
                "barcode_candidates": ["1234567890123"],
            }

    db_session.add(
        NutritionFoodReference(
            source="openfoodfacts",
            source_id="off-soy-sauce",
            barcode="1234567890123",
            name="Sauce soja test",
            energy_kcal_100g=53,
            protein_g_100g=8,
            carbohydrates_g_100g=5,
            fat_g_100g=0,
            dataset_version="off-test",
        )
    )
    await db_session.commit()
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[
                ("photos", ("plate.jpg", image_bytes(), "image/jpeg")),
                ("photos", ("barcode.jpg", image_bytes((96, 64, 32)), "image/jpeg")),
            ],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        await NutritionAnalysisService(db_session, analyzer=PackagingAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    body = detail.json()
    assert body["status"] == "ready"
    assert body["validation_blocked"] is False
    assert body["items"][0]["source"] == "openfoodfacts"
    assert body["items"][0]["barcode"] == "1234567890123"


@pytest.mark.asyncio
async def test_nutrition_analysis_uses_user_barcode_and_notes_hints(
    test_app,
    db_session,
    tmp_path,
):
    class HintAnalyzer:
        def __init__(self):
            self.hints = None

        async def analyze(self, photos, hints=None):
            self.hints = hints
            return {
                "items": [{"name": "Pate a tartiner", "portion_g": 30, "confidence": "medium"}],
                "confidence": "medium",
                "barcode_candidates": [],
            }

    analyzer = HintAnalyzer()
    db_session.add(
        NutritionFoodReference(
            source="openfoodfacts",
            source_id="off-nutella",
            barcode="3017620422003",
            name="Pate a tartiner noisette",
            energy_kcal_100g=539,
            protein_g_100g=6,
            carbohydrates_g_100g=57,
            fat_g_100g=31,
            dataset_version="off-test",
        )
    )
    await db_session.commit()
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            data={
                "notes": "Tartine avec pate a tartiner, portion petite.",
                "barcode": "  3017620422003  ",
            },
            files=[("photos", ("plate.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        await NutritionAnalysisService(db_session, analyzer=analyzer).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    body = detail.json()
    assert analyzer.hints == {
        "user_notes": "Tartine avec pate a tartiner, portion petite.",
        "user_barcode": "3017620422003",
    }
    assert body["source_trace"]["user_notes"] == "Tartine avec pate a tartiner, portion petite."
    assert body["source_trace"]["user_barcode"] == "3017620422003"
    assert body["source_trace"]["barcode_candidates"] == ["3017620422003"]
    assert body["items"][0]["source"] == "openfoodfacts"
    assert body["items"][0]["barcode"] == "3017620422003"


@pytest.mark.asyncio
async def test_nutrition_analysis_prefers_global_barcode_candidate_over_generic_ciqual_match(
    test_app,
    db_session,
    tmp_path,
):
    class PackagingAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Yaourt nature", "portion_g": 125, "confidence": "medium"}],
                "confidence": "medium",
                "barcode_candidates": ["3017620422003"],
            }

    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-yogurt",
                name="Yaourt nature",
                energy_kcal_100g=61,
                protein_g_100g=3.5,
                carbohydrates_g_100g=4.7,
                fat_g_100g=3.3,
                dataset_version="ciqual-test",
            ),
            NutritionFoodReference(
                source="openfoodfacts",
                source_id="3017620422003",
                barcode="3017620422003",
                name="Yaourt nature industriel",
                energy_kcal_100g=89,
                protein_g_100g=4.1,
                carbohydrates_g_100g=12,
                fat_g_100g=2.8,
                dataset_version="off-test",
            ),
        ]
    )
    await db_session.commit()
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[
                ("photos", ("plate.jpg", image_bytes(), "image/jpeg")),
                ("photos", ("packaging.jpg", image_bytes((96, 64, 32)), "image/jpeg")),
            ],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        await NutritionAnalysisService(db_session, analyzer=PackagingAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    item = detail.json()["items"][0]
    assert item["source"] == "openfoodfacts"
    assert item["barcode"] == "3017620422003"
    assert item["source_id"] == "3017620422003"


@pytest.mark.asyncio
async def test_nutrition_analysis_does_not_assign_global_barcode_to_unrelated_ciqual_item(
    test_app,
    db_session,
    tmp_path,
):
    class MixedAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [
                    {"name": "Riz cuit", "portion_g": 180, "confidence": "high"},
                    {"name": "Sauce soja", "portion_g": 15, "confidence": "medium"},
                ],
                "confidence": "medium",
                "barcode_candidates": ["1234567890123"],
            }

    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[
                ("photos", ("plate.jpg", image_bytes(), "image/jpeg")),
                ("photos", ("packaging.jpg", image_bytes((96, 64, 32)), "image/jpeg")),
            ],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        await NutritionAnalysisService(db_session, analyzer=MixedAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    items = detail.json()["items"]
    rice = next(item for item in items if item["name"] == "Riz cuit")
    sauce = next(item for item in items if item["name"] == "Sauce soja")
    assert rice["source"] == "ciqual"
    assert rice["barcode"] is None
    assert sauce["source"] == "openfoodfacts"
    assert sauce["barcode"] == "1234567890123"


@pytest.mark.asyncio
async def test_nutrition_analysis_accepts_portion_strings_from_vision_model(test_app, db_session, tmp_path):
    class PortionStringAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Riz cuit", "portion_g": "180 g", "confidence": "medium"}],
                "confidence": "medium",
            }

    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=PortionStringAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    assert detail.status_code == 200
    assert detail.json()["status"] == "ready"
    assert detail.json()["items"][0]["portion_g"] == pytest.approx(180)
    assert detail.json()["energy_kcal"] == pytest.approx(234)


@pytest.mark.asyncio
async def test_nutrition_analysis_normalizes_numeric_confidence_from_vision_model(test_app, db_session, tmp_path):
    class NumericConfidenceAnalyzer:
        async def analyze(self, photos):
            return {
                "items": [{"name": "Riz cuit", "portion_g": 180, "confidence": 0.91}],
                "confidence": 0.92,
            }

    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]
        await NutritionAnalysisService(db_session, analyzer=NumericConfidenceAnalyzer()).run_next()
        await db_session.commit()

        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    assert detail.status_code == 200
    assert detail.json()["confidence"] == "high"
    assert detail.json()["items"][0]["confidence"] == "high"


@pytest.mark.asyncio
async def test_failed_nutrition_analysis_keeps_original_photos_for_retry(test_app, db_session, tmp_path):
    class FailingAnalyzer:
        async def analyze(self, photos):
            raise RuntimeError("vision model unavailable")

    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_photo_retention = "thumbnail_only"

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

    with pytest.raises(RuntimeError, match="vision model unavailable"):
        await NutritionAnalysisService(db_session, analyzer=FailingAnalyzer()).run_next()

    meal = await db_session.get(NutritionMeal, meal_id)
    photos = (await db_session.execute(select(NutritionMealPhoto))).scalars().all()

    assert meal is not None
    assert meal.status == "error"
    assert meal.error_message == "vision model unavailable"
    assert all(photo.original_path for photo in photos)
    assert all(photo.thumbnail_path for photo in photos)


@pytest.mark.asyncio
async def test_nutrition_processing_run_next_only_processes_current_user_job(test_app, db_session, tmp_path, monkeypatch):
    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    from app.services.nutrition.analysis import NutritionVisionAnalyzer

    async def fake_analyze(self, photos):
        return await FakeMealAnalyzer().analyze(photos)

    monkeypatch.setattr(NutritionVisionAnalyzer, "analyze", fake_analyze)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        first_headers = await register(client)
        first_created = await client.post(
            "/api/v1/nutrition/meals",
            headers=first_headers,
            files=[("photos", ("first.jpg", image_bytes(), "image/jpeg"))],
        )
        assert first_created.status_code == 201
        first_meal_id = first_created.json()["id"]

        second_headers = await register_extra_user(db_session, test_app)
        second_created = await client.post(
            "/api/v1/nutrition/meals",
            headers=second_headers,
            files=[("photos", ("second.jpg", image_bytes((96, 64, 32)), "image/jpeg"))],
        )
        assert second_created.status_code == 201
        second_meal_id = second_created.json()["id"]

        processed = await client.post("/api/v1/nutrition/processing/run-next", headers=second_headers)
        assert processed.status_code == 200
        assert processed.json()["meal_id"] == second_meal_id

        first_detail = await client.get(f"/api/v1/nutrition/meals/{first_meal_id}", headers=first_headers)
        second_detail = await client.get(f"/api/v1/nutrition/meals/{second_meal_id}", headers=second_headers)

    assert first_detail.json()["status"] == "analyzing"
    assert second_detail.json()["status"] in {"ready", "needs_review", "error"}


@pytest.mark.asyncio
async def test_nutrition_processing_run_next_returns_error_meal_when_model_fails(
    test_app,
    tmp_path,
    monkeypatch,
):
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    from app.services.nutrition.analysis import NutritionVisionAnalyzer

    async def fail_analyze(self, photos):
        raise RuntimeError("ollama model unavailable")

    monkeypatch.setattr(NutritionVisionAnalyzer, "analyze", fail_analyze)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        processed = await client.post("/api/v1/nutrition/processing/run-next", headers=headers)

    assert processed.status_code == 200
    assert processed.json()["status"] == "error"
    assert processed.json()["meal_id"] == meal_id
    assert processed.json()["analysis_job"]["status"] == "failed"
    assert processed.json()["analysis_job"]["attempts"] == 1
    assert processed.json()["analysis_job"]["error_message"] == "ollama model unavailable"


@pytest.mark.asyncio
async def test_nutrition_worker_recovers_stale_running_job(test_app, db_session, tmp_path):
    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_job_stale_after_seconds = 60

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

    job = (await db_session.execute(select(NutritionAnalysisJob))).scalar_one()
    job.status = "running"
    job.started_at = datetime.utcnow() - timedelta(minutes=10)
    await db_session.commit()

    meal = await NutritionAnalysisService(
        db_session,
        analyzer=FakeMealAnalyzer(),
        settings=test_app.state.settings,
    ).run_next()
    await db_session.commit()

    assert meal is not None
    assert meal.id == meal_id
    assert meal.status == "ready"


@pytest.mark.asyncio
async def test_nutrition_error_meal_can_be_requeued_for_analysis(
    test_app,
    db_session,
    tmp_path,
    monkeypatch,
):
    await seed_references(db_session)
    test_app.state.settings.nutrition_photo_storage_dir = str(tmp_path)
    test_app.state.settings.nutrition_photo_retention = "keep_original"
    from app.services.nutrition.analysis import NutritionVisionAnalyzer

    calls = 0

    async def flaky_analyze(self, photos):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("ollama warming up")
        return await FakeMealAnalyzer().analyze(photos)

    monkeypatch.setattr(NutritionVisionAnalyzer, "analyze", flaky_analyze)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        headers = await register(client)
        created = await client.post(
            "/api/v1/nutrition/meals",
            headers=headers,
            files=[("photos", ("meal.jpg", image_bytes(), "image/jpeg"))],
        )
        assert created.status_code == 201
        meal_id = created.json()["id"]

        failed = await client.post("/api/v1/nutrition/processing/run-next", headers=headers)
        requeued = await client.post(f"/api/v1/nutrition/meals/{meal_id}/reanalyze", headers=headers)
        processed = await client.post("/api/v1/nutrition/processing/run-next", headers=headers)
        detail = await client.get(f"/api/v1/nutrition/meals/{meal_id}", headers=headers)

    assert failed.json()["status"] == "error"
    assert failed.json()["analysis_job"]["status"] == "failed"
    assert failed.json()["analysis_job"]["attempts"] == 1
    assert failed.json()["analysis_job"]["error_message"] == "ollama warming up"
    assert requeued.status_code == 200
    assert requeued.json()["status"] == "analyzing"
    assert requeued.json()["analysis_job"]["status"] == "pending"
    assert requeued.json()["analysis_job"]["attempts"] == 0
    assert requeued.json()["error_message"] is None
    assert processed.json()["status"] == "ready"
    assert processed.json()["meal_id"] == meal_id
    assert processed.json()["analysis_job"]["status"] == "completed"
    assert processed.json()["analysis_job"]["attempts"] == 1
    assert detail.json()["status"] == "ready"
    assert detail.json()["analysis_job"]["status"] == "completed"
    assert detail.json()["analysis_job"]["attempts"] == 1
    assert detail.json()["validation_blocked"] is False

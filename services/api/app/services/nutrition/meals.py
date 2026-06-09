import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    HealthNutritionRecord,
    HealthUser,
    NutritionAnalysisJob,
    NutritionFoodReference,
    NutritionMeal,
    NutritionMealItem,
    NutritionMealPhoto,
)
from app.schemas import (
    NutritionAnalysisJobResponse,
    NutritionMealItemResponse,
    NutritionMealListResponse,
    NutritionMealResponse,
    NutritionMealUpdateRequest,
    NutritionPhotoResponse,
)
from app.services.nutrition.analysis import recalculate_meal
from app.services.nutrition.references import nutrients_for_portion
from app.services.nutrition.storage import persist_uploads, remove_meal_storage
from app.services.processing import ProcessingService

ALLOWED_MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}
MAX_USER_NOTES_CHARS = 800


def normalize_user_notes(value: str | None) -> str | None:
    text = (value or "").strip()
    return text[:MAX_USER_NOTES_CHARS] or None


def normalize_user_barcode(value: str | None) -> str | None:
    cleaned = re.sub(r"\D+", "", value or "")
    return cleaned[:64] or None


class NutritionMealService:
    def __init__(self, db: AsyncSession, settings):
        self.db = db
        self.settings = settings

    async def create_meal(
        self,
        user: HealthUser,
        photos: list[UploadFile],
        consumed_at: datetime | None,
        meal_type: str | None,
        notes: str | None = None,
        barcode: str | None = None,
    ) -> NutritionMealResponse:
        if not photos:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="At least one photo is required")
        if len(photos) > self.settings.nutrition_max_photos_per_meal:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"At most {self.settings.nutrition_max_photos_per_meal} nutrition photos are allowed",
            )
        allowed_types = {content_type.lower() for content_type in self.settings.nutrition_allowed_photo_content_types}
        if any((photo.content_type or "").lower() not in allowed_types for photo in photos):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Nutrition photos must be jpeg, png, or webp images",
            )
        normalized_meal_type = meal_type.strip().lower() if meal_type else None
        if normalized_meal_type and normalized_meal_type not in ALLOWED_MEAL_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Unknown nutrition meal type",
            )
        user_notes = normalize_user_notes(notes)
        user_barcode = normalize_user_barcode(barcode)
        source_trace = {
            key: value
            for key, value in {
                "user_notes": user_notes,
                "user_barcode": user_barcode,
            }.items()
            if value
        }
        meal_id = str(uuid4())
        photo_rows = await persist_uploads(
            self.settings.nutrition_photo_storage_dir,
            meal_id,
            photos,
            self.settings.nutrition_max_photo_bytes,
        )
        meal = NutritionMeal(
            id=meal_id,
            user_id=user.id,
            status="analyzing",
            meal_type=normalized_meal_type,
            consumed_at=consumed_at or datetime.utcnow().replace(tzinfo=timezone.utc),
            validation_blocked=True,
            source_trace_json=source_trace or None,
        )
        self.db.add(meal)
        await self.db.flush()
        for photo in photo_rows:
            self.db.add(photo)
        job = NutritionAnalysisJob(user_id=user.id, meal_id=meal.id, status="pending")
        self.db.add(job)
        await self.db.commit()
        return await self.response(meal.id, user.id)

    async def list_meals(self, user: HealthUser, limit: int = 50) -> NutritionMealListResponse:
        result = await self.db.execute(
            select(NutritionMeal)
            .where(NutritionMeal.user_id == user.id)
            .order_by(desc(NutritionMeal.consumed_at), desc(NutritionMeal.created_at))
            .limit(max(1, min(limit, 100)))
        )
        meals = [await self.response(meal.id, user.id) for meal in result.scalars()]
        return NutritionMealListResponse(meals=meals)

    async def update_meal(self, meal_id: str, user: HealthUser, request: NutritionMealUpdateRequest) -> NutritionMealResponse:
        meal = await self.meal_for_user(meal_id, user.id)
        if meal.status == "validated":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Validated meal cannot be edited")
        items_by_id = await self.items_by_id(meal.id)
        for edit in request.items:
            item = items_by_id.get(edit.id)
            if item is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal item not found")
            reference = None
            if edit.reference_id is not None:
                reference = await self.db.get(NutritionFoodReference, edit.reference_id)
                if reference is None:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutrition reference not found")
                item.reference_id = reference.id
                item.name = reference.name
                item.barcode = reference.barcode
                item.source = reference.source
                item.source_id = reference.source_id
                item.included = True
            if edit.included is not None:
                item.included = edit.included
            if edit.portion_g is not None:
                item.portion_g = edit.portion_g
            if item.reference_id is not None:
                reference = reference or await self.db.get(NutritionFoodReference, item.reference_id)
                if reference is not None:
                    nutrients = nutrients_for_portion(reference, item.portion_g)
                    item.energy_kcal = nutrients.energy_kcal
                    item.protein_g = nutrients.protein_g
                    item.carbohydrates_g = nutrients.carbohydrates_g
                    item.fat_g = nutrients.fat_g
            item.updated_at = datetime.utcnow()
        await recalculate_meal(self.db, meal)
        await self.db.commit()
        return await self.response(meal.id, user.id)

    async def validate_meal(self, meal_id: str, user: HealthUser) -> NutritionMealResponse:
        meal = await self.meal_for_user(meal_id, user.id)
        if meal.status == "validated" and meal.validated_nutrition_record_id is not None:
            return await self.response(meal.id, user.id)
        await recalculate_meal(self.db, meal)
        if meal.validation_blocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Meal has unmatched nutrition items")
        record = HealthNutritionRecord(
            user_id=user.id,
            timestamp=meal.consumed_at,
            meal_type=meal.meal_type,
            name="Nutrition meal",
            energy_kcal=meal.energy_kcal,
            protein_g=meal.protein_g,
            carbohydrates_g=meal.carbohydrates_g,
            fat_g=meal.fat_g,
            metadata_json={
                "nutrition_meal_id": meal.id,
                "confidence": meal.confidence,
                "source_trace": meal.source_trace_json,
                "dataset_versions": meal.dataset_versions_json,
            },
        )
        self.db.add(record)
        await self.db.flush()
        meal.status = "validated"
        meal.validated_at = datetime.utcnow()
        meal.validated_nutrition_record_id = record.id
        meal.updated_at = datetime.utcnow()
        await ProcessingService(self.db).enqueue_dashboard_job(user.id)
        await self.db.commit()
        return await self.response(meal.id, user.id)

    async def reanalyze_meal(self, meal_id: str, user: HealthUser) -> NutritionMealResponse:
        meal = await self.meal_for_user(meal_id, user.id)
        if meal.status == "validated":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Validated meal cannot be reanalyzed")
        existing_job = await self.db.scalar(
            select(NutritionAnalysisJob)
            .where(
                NutritionAnalysisJob.meal_id == meal.id,
                NutritionAnalysisJob.status.in_(("pending", "running")),
            )
            .limit(1)
        )
        if existing_job is None:
            self.db.add(NutritionAnalysisJob(user_id=user.id, meal_id=meal.id, status="pending"))
        meal.status = "analyzing"
        meal.error_message = None
        meal.updated_at = datetime.utcnow()
        await self.db.commit()
        return await self.response(meal.id, user.id)

    async def delete_meal(self, meal_id: str, user: HealthUser) -> None:
        meal = await self.meal_for_user(meal_id, user.id)
        if meal.status == "validated":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Validated meal cannot be deleted")
        await self.db.delete(meal)
        remove_meal_storage(self.settings.nutrition_photo_storage_dir, meal.id)
        await self.db.commit()

    async def response(self, meal_id: str, user_id: str) -> NutritionMealResponse:
        meal = await self.meal_for_user(meal_id, user_id)
        photos = await self.photos(meal.id)
        items = await self.items(meal.id)
        analysis_job = await self.latest_analysis_job(meal.id)
        return NutritionMealResponse(
            id=meal.id,
            status=meal.status,
            meal_type=meal.meal_type,
            consumed_at=meal.consumed_at,
            title=meal.title,
            photo_count=len(photos),
            photos=[
                NutritionPhotoResponse(
                    id=photo.id,
                    thumbnail_url=f"/api/v1/nutrition/meals/{meal.id}/photos/{photo.id}/thumbnail"
                    if photo.thumbnail_path
                    else None,
                    original_filename=photo.original_filename,
                    purged=photo.original_path is None,
                )
                for photo in photos
            ],
            items=[
                NutritionMealItemResponse(
                    id=item.id,
                    name=item.name,
                    detected_name=item.detected_name,
                    barcode=item.barcode,
                    source=item.source,
                    source_id=item.source_id,
                    portion_g=item.portion_g,
                    included=item.included,
                    confidence=item.confidence,
                    energy_kcal=item.energy_kcal,
                    protein_g=item.protein_g,
                    carbohydrates_g=item.carbohydrates_g,
                    fat_g=item.fat_g,
                )
                for item in items
            ],
            confidence=meal.confidence,
            validation_blocked=meal.validation_blocked,
            kcal_min=meal.kcal_min,
            kcal_max=meal.kcal_max,
            energy_kcal=meal.energy_kcal,
            protein_g=meal.protein_g,
            carbohydrates_g=meal.carbohydrates_g,
            fat_g=meal.fat_g,
            model_name=meal.model_name,
            prompt_version=meal.prompt_version,
            dataset_versions=meal.dataset_versions_json,
            source_trace=meal.source_trace_json,
            analysis_job=NutritionAnalysisJobResponse(
                id=analysis_job.id,
                status=analysis_job.status,
                attempts=analysis_job.attempts,
                error_message=analysis_job.error_message,
                created_at=analysis_job.created_at,
                updated_at=analysis_job.updated_at,
                started_at=analysis_job.started_at,
                finished_at=analysis_job.finished_at,
            )
            if analysis_job is not None
            else None,
            error_message=meal.error_message,
            created_at=meal.created_at,
            updated_at=meal.updated_at,
        )

    async def meal_for_user(self, meal_id: str, user_id: str) -> NutritionMeal:
        meal = await self.db.get(NutritionMeal, meal_id)
        if meal is None or meal.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutrition meal not found")
        return meal

    async def photo_for_user(self, meal_id: str, photo_id: str, user_id: str) -> NutritionMealPhoto:
        await self.meal_for_user(meal_id, user_id)
        photo = await self.db.get(NutritionMealPhoto, photo_id)
        if photo is None or photo.meal_id != meal_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutrition photo not found")
        return photo

    async def photos(self, meal_id: str) -> list[NutritionMealPhoto]:
        result = await self.db.execute(
            select(NutritionMealPhoto)
            .where(NutritionMealPhoto.meal_id == meal_id)
            .order_by(NutritionMealPhoto.created_at)
        )
        return list(result.scalars())

    async def latest_analysis_job(self, meal_id: str) -> NutritionAnalysisJob | None:
        return await self.db.scalar(
            select(NutritionAnalysisJob)
            .where(NutritionAnalysisJob.meal_id == meal_id)
            .order_by(desc(NutritionAnalysisJob.created_at), desc(NutritionAnalysisJob.updated_at))
            .limit(1)
        )

    async def items(self, meal_id: str) -> list[NutritionMealItem]:
        result = await self.db.execute(
            select(NutritionMealItem)
            .where(NutritionMealItem.meal_id == meal_id)
            .order_by(NutritionMealItem.created_at)
        )
        return list(result.scalars())

    async def items_by_id(self, meal_id: str) -> dict[str, NutritionMealItem]:
        return {item.id: item for item in await self.items(meal_id)}

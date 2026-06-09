import base64
import json
import re
from io import BytesIO
from datetime import datetime, timedelta
from inspect import signature
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageOps
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as default_settings
from app.models import (
    NutritionAnalysisJob,
    NutritionFoodReference,
    NutritionMeal,
    NutritionMealItem,
    NutritionMealPhoto,
)
from app.services.nutrition.references import NutritionReferenceService, food_name_score, normalize_food_name, nutrients_for_portion
from app.services.nutrition.storage import purge_original

PROMPT_VERSION = "nutrition-vision-v1"
VISION_IMAGE_MAX_SIDE = 1280
VISION_IMAGE_JPEG_QUALITY = 82
VISION_NUM_PREDICT = 4096


def parse_model_json(content: str) -> dict:
    text = content.strip()
    if not text:
        raise RuntimeError("Nutrition vision model returned an empty response")
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Nutrition vision model returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Nutrition vision model returned invalid JSON")
    return parsed


def parse_portion_g(value: Any) -> float:
    if isinstance(value, int | float):
        return max(float(value), 0.0) or 100.0
    if isinstance(value, str):
        match = re.search(r"\d+(?:[\.,]\d+)?", value)
        if match:
            return max(float(match.group(0).replace(",", ".")), 0.0) or 100.0
    return 100.0


def normalize_confidence(value: Any, default: str | None = None) -> str | None:
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, int | float):
        score = float(value)
        if score > 1:
            score = score / 100
        if score >= 0.8:
            return "high"
        if score >= 0.5:
            return "medium"
        return "low"
    text = str(value).strip().lower()
    if text in {"high", "medium", "low"}:
        return text
    try:
        return normalize_confidence(float(text), default)
    except ValueError:
        return default or text or None


def prepare_vision_image_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    try:
        with Image.open(BytesIO(data)) as image:
            prepared = ImageOps.exif_transpose(image)
            prepared.thumbnail((VISION_IMAGE_MAX_SIDE, VISION_IMAGE_MAX_SIDE))
            if prepared.mode not in ("RGB", "L"):
                prepared = prepared.convert("RGB")
            output = BytesIO()
            prepared.save(output, format="JPEG", quality=VISION_IMAGE_JPEG_QUALITY, optimize=True)
            return output.getvalue()
    except Exception:
        return data


class NutritionVisionAnalyzer:
    def __init__(self, settings=default_settings, http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.http_client = http_client

    async def analyze(self, photos: list[dict[str, Any]], hints: dict[str, str] | None = None) -> dict:
        images = []
        for photo in photos:
            path = Path(photo.get("original_path") or photo.get("thumbnail_path") or "")
            if path.exists():
                images.append(base64.b64encode(prepare_vision_image_bytes(path)).decode("ascii"))
        if not images:
            raise RuntimeError("No meal photos available for analysis")

        user_notes = (hints or {}).get("user_notes")
        user_barcode = (hints or {}).get("user_barcode")
        hint_text = ""
        if user_notes or user_barcode:
            hint_parts = []
            if user_notes:
                hint_parts.append(f"commentaire utilisateur: {user_notes}")
            if user_barcode:
                hint_parts.append(f"code-barres utilisateur: {user_barcode}")
            hint_text = (
                " Indices fournis par l'utilisateur: "
                + "; ".join(hint_parts)
                + ". Si le code-barres correspond a un produit visible ou probable, ajoute-le dans barcode_candidates et/ou sur l'item concerne."
            )
        prompt = (
            "/no_think\n"
            "Analyse ces photos de repas. Reponds uniquement en JSON avec: "
            "items[{name, portion_g, barcode?, confidence}], confidence, barcode_candidates[]. "
            "Utilise des noms d'aliments generiques en francais pour name. "
            "N'estime pas les calories."
            f"{hint_text}"
        )
        payload = {
            "model": self.settings.nutrition_vision_model,
            "stream": False,
            "format": "json",
            "think": False,
            "keep_alive": self.settings.health_llm_keep_alive,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": images,
                }
            ],
            "options": {
                "temperature": 0.1,
                "num_predict": VISION_NUM_PREDICT,
                "num_ctx": self.settings.health_llm_context_tokens,
            },
        }
        response_json = await self._post_chat(payload)
        content = response_json.get("message", {}).get("content", "")
        if str(content).strip():
            return parse_model_json(content)

        fallback_payload = dict(payload)
        fallback_payload.pop("format", None)
        fallback_payload["messages"] = [
            {
                "role": "user",
                "content": (
                    f"{prompt} Si tu n'es pas certain, renvoie tout de meme un JSON valide "
                    '{"items":[],"confidence":"low","barcode_candidates":[]}.'
                ),
                "images": images,
            }
        ]
        fallback_response_json = await self._post_chat(fallback_payload)
        fallback_content = fallback_response_json.get("message", {}).get("content", "")
        if str(fallback_content).strip():
            return parse_model_json(fallback_content)

        done_reason = fallback_response_json.get("done_reason") or response_json.get("done_reason")
        reason = f" ({done_reason})" if done_reason else ""
        raise RuntimeError(f"Nutrition vision model returned an empty response{reason}")

    async def _post_chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.http_client is not None:
            response = await self.http_client.post(
                f"{self.settings.nutrition_llm_base_url.rstrip('/')}/api/chat",
                json=payload,
                timeout=self.settings.nutrition_llm_timeout_seconds,
            )
        else:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.settings.nutrition_llm_base_url.rstrip('/')}/api/chat",
                    json=payload,
                    timeout=self.settings.nutrition_llm_timeout_seconds,
                )
        response.raise_for_status()
        parsed = response.json()
        if not isinstance(parsed, dict):
            raise RuntimeError("Nutrition vision model returned invalid JSON")
        return parsed


async def recalculate_meal(db: AsyncSession, meal: NutritionMeal) -> NutritionMeal:
    result = await db.execute(select(NutritionMealItem).where(NutritionMealItem.meal_id == meal.id))
    items = list(result.scalars())
    included = [item for item in items if item.included]
    unmatched = [item for item in included if item.reference_id is None]

    energy = sum(float(item.energy_kcal or 0) for item in included)
    protein = sum(float(item.protein_g or 0) for item in included)
    carbs = sum(float(item.carbohydrates_g or 0) for item in included)
    fat = sum(float(item.fat_g or 0) for item in included)
    item_names = [item.name for item in included if item.name]
    if item_names:
        meal.title = ", ".join(item_names[:3])
        if len(item_names) > 3:
            meal.title += f" +{len(item_names) - 3}"
    else:
        meal.title = None
    reference_ids = [item.reference_id for item in included if item.reference_id is not None]
    if reference_ids:
        references_result = await db.execute(
            select(NutritionFoodReference).where(NutritionFoodReference.id.in_(reference_ids))
        )
        meal.dataset_versions_json = {
            reference.source: reference.dataset_version for reference in references_result.scalars()
        }

    confidence = meal.confidence or ("low" if unmatched else "medium")
    spread = {"high": 0.1, "medium": 0.15, "low": 0.25}.get(confidence, 0.2)
    meal.energy_kcal = energy
    meal.protein_g = protein
    meal.carbohydrates_g = carbs
    meal.fat_g = fat
    meal.kcal_min = max(0.0, energy * (1 - spread))
    meal.kcal_max = energy * (1 + spread)
    meal.validation_blocked = bool(unmatched) or not included
    if meal.status != "validated":
        meal.status = "needs_review" if meal.validation_blocked else "ready"
    meal.updated_at = datetime.utcnow()
    await db.flush()
    return meal


class NutritionAnalysisService:
    def __init__(self, db: AsyncSession, analyzer: Any | None = None, settings=default_settings):
        self.db = db
        self.settings = settings
        self.analyzer = analyzer or NutritionVisionAnalyzer(settings)
        self.references = NutritionReferenceService(db)

    async def run_next(self, user_id: str | None = None, raise_on_error: bool = True) -> NutritionMeal | None:
        stale_cutoff = datetime.utcnow() - timedelta(seconds=self.settings.nutrition_job_stale_after_seconds)
        query = select(NutritionAnalysisJob).where(
            or_(
                NutritionAnalysisJob.status == "pending",
                and_(
                    NutritionAnalysisJob.status == "running",
                    or_(
                        NutritionAnalysisJob.started_at.is_(None),
                        NutritionAnalysisJob.started_at < stale_cutoff,
                    ),
                ),
            )
        )
        if user_id is not None:
            query = query.where(NutritionAnalysisJob.user_id == user_id)
        job = await self.db.scalar(query.order_by(NutritionAnalysisJob.created_at).limit(1))
        if job is None:
            return None
        meal = await self.db.get(NutritionMeal, job.meal_id)
        if meal is None:
            job.status = "failed"
            job.error_message = "Meal not found"
            job.finished_at = datetime.utcnow()
            await self.db.commit()
            return None

        job.status = "running"
        job.attempts = int(job.attempts or 0) + 1
        job.started_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        meal.status = "analyzing"
        meal.updated_at = datetime.utcnow()
        await self.db.flush()

        photos: list[NutritionMealPhoto] = []
        try:
            photos = await self._photos_for_meal(meal.id)
            hints = self._analysis_hints(meal)
            raw = await self._analyze_photos([self._photo_payload(photo) for photo in photos], hints)
            raw = self._merge_analysis_hints(raw, hints)
            await self._replace_items(meal, raw)
            meal.confidence = normalize_confidence(raw.get("confidence"), "medium")
            meal.model_name = self.settings.nutrition_vision_model
            meal.prompt_version = PROMPT_VERSION
            meal.result_json = raw
            meal.source_trace_json = {
                **hints,
                "barcode_candidates": raw.get("barcode_candidates") or [],
                "items": raw.get("items") or [],
            }
            await recalculate_meal(self.db, meal)
            self._purge_originals_if_needed(photos)
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            job.finished_at = datetime.utcnow()
            meal.status = "error"
            meal.error_message = str(exc)
            meal.updated_at = datetime.utcnow()
            await self.db.commit()
            if not raise_on_error:
                return meal
            raise

        job.status = "completed"
        job.error_message = None
        job.finished_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await self.db.commit()
        return meal

    async def _photos_for_meal(self, meal_id: str) -> list[NutritionMealPhoto]:
        result = await self.db.execute(
            select(NutritionMealPhoto)
            .where(NutritionMealPhoto.meal_id == meal_id)
            .order_by(NutritionMealPhoto.created_at)
        )
        return list(result.scalars())

    async def _analyze_photos(self, photos: list[dict[str, Any]], hints: dict[str, str]) -> dict:
        analyzer_signature = signature(self.analyzer.analyze)
        if len(analyzer_signature.parameters) >= 2:
            return await self.analyzer.analyze(photos, hints)
        return await self.analyzer.analyze(photos)

    @staticmethod
    def _analysis_hints(meal: NutritionMeal) -> dict[str, str]:
        trace = meal.source_trace_json if isinstance(meal.source_trace_json, dict) else {}
        return {
            key: str(trace[key]).strip()
            for key in ("user_notes", "user_barcode")
            if trace.get(key) and str(trace[key]).strip()
        }

    @staticmethod
    def _merge_analysis_hints(raw: dict, hints: dict[str, str]) -> dict:
        if not hints.get("user_barcode"):
            return raw
        candidates = [
            str(barcode).strip()
            for barcode in [*(raw.get("barcode_candidates") or []), hints["user_barcode"]]
            if str(barcode).strip()
        ]
        return {
            **raw,
            "barcode_candidates": list(dict.fromkeys(candidates)),
        }

    @staticmethod
    def _photo_payload(photo: NutritionMealPhoto) -> dict[str, Any]:
        return {
            "id": photo.id,
            "original_path": photo.original_path,
            "thumbnail_path": photo.thumbnail_path,
            "content_type": photo.content_type,
        }

    async def _replace_items(self, meal: NutritionMeal, raw: dict) -> None:
        await self.db.execute(delete(NutritionMealItem).where(NutritionMealItem.meal_id == meal.id))
        dataset_versions: dict[str, str] = {}
        barcode_candidates = [str(barcode).strip() for barcode in raw.get("barcode_candidates") or [] if str(barcode).strip()]
        unused_barcodes = list(dict.fromkeys(barcode_candidates))
        for detected in raw.get("items") or []:
            if not isinstance(detected, dict):
                continue
            portion = parse_portion_g(detected.get("portion_g"))
            reference = await self.references.match_item(detected)
            matched_barcode = str(detected.get("barcode") or "").strip()
            if unused_barcodes and not matched_barcode:
                for barcode in list(unused_barcodes):
                    candidate = dict(detected)
                    candidate["barcode"] = barcode
                    barcode_reference = await self.references.match_item(candidate)
                    if barcode_reference is None:
                        continue
                    if reference is not None and reference.source == "openfoodfacts":
                        break
                    detected_name = normalize_food_name(str(detected.get("name") or ""))
                    product_name = normalize_food_name(barcode_reference.name)
                    product_matches_item = not detected_name or food_name_score(detected_name, product_name) >= 0.55
                    if reference is None or product_matches_item:
                        reference = barcode_reference
                        matched_barcode = barcode
                        unused_barcodes.remove(barcode)
                        break
            nutrients = nutrients_for_portion(reference, portion) if reference is not None else None
            if reference is not None:
                dataset_versions[reference.source] = reference.dataset_version
            display_name = str(detected.get("name") or (reference.name if reference is not None else "Aliment inconnu"))
            item = NutritionMealItem(
                meal_id=meal.id,
                reference_id=reference.id if reference is not None else None,
                name=display_name,
                detected_name=str(detected.get("name") or "") or None,
                barcode=matched_barcode or (reference.barcode if reference is not None else None),
                source=reference.source if reference is not None else None,
                source_id=reference.source_id if reference is not None else None,
                portion_g=portion,
                included=True,
                confidence=normalize_confidence(detected.get("confidence")),
                energy_kcal=nutrients.energy_kcal if nutrients is not None else None,
                protein_g=nutrients.protein_g if nutrients is not None else None,
                carbohydrates_g=nutrients.carbohydrates_g if nutrients is not None else None,
                fat_g=nutrients.fat_g if nutrients is not None else None,
                metadata_json={"raw_detection": detected},
            )
            self.db.add(item)
        meal.dataset_versions_json = dataset_versions
        await self.db.flush()

    def _purge_originals_if_needed(self, photos: list[NutritionMealPhoto]) -> None:
        if self.settings.nutrition_photo_retention != "thumbnail_only":
            return
        for photo in photos:
            purge_original(photo)

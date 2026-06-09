import shutil
from io import BytesIO
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps

from app.models import NutritionMealPhoto


def safe_suffix(filename: str | None, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        return suffix
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    return ".jpg"


def make_thumbnail_bytes(data: bytes, suffix: str, max_side: int = 512) -> bytes:
    try:
        with Image.open(BytesIO(data)) as image:
            thumbnail = ImageOps.exif_transpose(image)
            thumbnail.thumbnail((max_side, max_side))
            output = BytesIO()
            if suffix == ".png":
                thumbnail.save(output, format="PNG", optimize=True)
            elif suffix == ".webp":
                thumbnail.save(output, format="WEBP", quality=82, method=6)
            else:
                if thumbnail.mode not in ("RGB", "L"):
                    thumbnail = thumbnail.convert("RGB")
                thumbnail.save(output, format="JPEG", quality=82, optimize=True)
            return output.getvalue()
    except Exception:
        return data


def validate_image_bytes(data: bytes) -> None:
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Nutrition photos must contain valid image data",
        ) from exc


async def persist_uploads(
    base_dir: str,
    meal_id: str,
    uploads: list[UploadFile],
    max_photo_bytes: int,
) -> list[NutritionMealPhoto]:
    prepared = []
    for upload in uploads:
        data = await upload.read()
        if len(data) > max_photo_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"Nutrition photo exceeds the {max_photo_bytes} byte limit",
            )
        validate_image_bytes(data)
        prepared.append((upload, data))

    meal_dir = Path(base_dir) / meal_id
    original_dir = meal_dir / "originals"
    thumbnail_dir = meal_dir / "thumbs"
    original_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_dir.mkdir(parents=True, exist_ok=True)

    photos: list[NutritionMealPhoto] = []
    for upload, data in prepared:
        suffix = safe_suffix(upload.filename, upload.content_type)
        photo_id = str(uuid4())
        original_path = original_dir / f"{photo_id}{suffix}"
        thumbnail_path = thumbnail_dir / f"{photo_id}{suffix}"
        original_path.write_bytes(data)
        thumbnail_path.write_bytes(make_thumbnail_bytes(data, suffix))
        photos.append(
            NutritionMealPhoto(
                id=photo_id,
                meal_id=meal_id,
                original_path=str(original_path),
                thumbnail_path=str(thumbnail_path),
                content_type=upload.content_type,
                original_filename=upload.filename,
                size_bytes=len(data),
            )
        )
    return photos


def purge_original(photo: NutritionMealPhoto) -> None:
    if not photo.original_path:
        return
    path = Path(photo.original_path)
    if path.exists():
        path.unlink()
    photo.original_path = None
    photo.purged_at = datetime.utcnow()


def remove_meal_storage(base_dir: str, meal_id: str) -> None:
    meal_dir = Path(base_dir) / meal_id
    if meal_dir.exists():
        shutil.rmtree(meal_dir)


def copy_import_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

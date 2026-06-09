from io import BytesIO

from PIL import Image

from app.services.nutrition.storage import make_thumbnail_bytes


def test_make_thumbnail_bytes_resizes_large_images():
    source = BytesIO()
    Image.new("RGB", (1600, 1200), color="white").save(source, format="JPEG")

    thumbnail = make_thumbnail_bytes(source.getvalue(), ".jpg", max_side=256)

    image = Image.open(BytesIO(thumbnail))
    assert max(image.size) == 256
    assert len(thumbnail) < len(source.getvalue())


def test_make_thumbnail_bytes_falls_back_for_invalid_images():
    assert make_thumbnail_bytes(b"not-an-image", ".jpg", max_side=256) == b"not-an-image"

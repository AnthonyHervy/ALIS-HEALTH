import base64
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from app.services.nutrition.analysis import NutritionVisionAnalyzer, parse_model_json


class FakeOllamaResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "message": {
                "content": '```json\n{"items":[{"name":"Pomme","portion_g":120}],"confidence":"medium"}\n```'
            }
        }


class FakeOllamaClient:
    async def post(self, *args, **kwargs):
        return FakeOllamaResponse()


class EmptyOllamaResponse:
    def __init__(self, done_reason=None):
        self.done_reason = done_reason

    def raise_for_status(self):
        return None

    def json(self):
        return {"message": {"content": ""}, "done_reason": self.done_reason}


class SequenceOllamaClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.payloads = []

    async def post(self, *args, **kwargs):
        self.payloads.append(kwargs["json"])
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_vision_analyzer_accepts_fenced_json_response(test_app, tmp_path):
    image = tmp_path / "meal.jpg"
    image.write_bytes(b"fake-image")

    result = await NutritionVisionAnalyzer(test_app.state.settings, http_client=FakeOllamaClient()).analyze(
        [{"original_path": str(image)}]
    )

    assert result["items"][0]["name"] == "Pomme"
    assert result["confidence"] == "medium"


@pytest.mark.asyncio
async def test_vision_analyzer_downsizes_large_images_before_ollama(test_app, tmp_path):
    image = tmp_path / "large-meal.jpg"
    Image.new("RGB", (2400, 1600), "tomato").save(image, format="JPEG", quality=95)
    client = SequenceOllamaClient([FakeOllamaResponse()])

    await NutritionVisionAnalyzer(test_app.state.settings, http_client=client).analyze(
        [{"original_path": str(image)}]
    )

    encoded = client.payloads[0]["messages"][0]["images"][0]
    prepared = Image.open(BytesIO(base64.b64decode(encoded)))
    assert max(prepared.size) <= 1280
    assert prepared.format == "JPEG"


@pytest.mark.asyncio
async def test_vision_analyzer_retries_without_json_format_after_empty_response(test_app, tmp_path):
    image = tmp_path / "meal.jpg"
    image.write_bytes(b"fake-image")
    client = SequenceOllamaClient([EmptyOllamaResponse(), FakeOllamaResponse()])

    result = await NutritionVisionAnalyzer(test_app.state.settings, http_client=client).analyze(
        [{"original_path": str(image)}]
    )

    assert result["items"][0]["name"] == "Pomme"
    assert client.payloads[0]["format"] == "json"
    assert "format" not in client.payloads[1]


@pytest.mark.asyncio
async def test_vision_analyzer_disables_thinking_for_structured_json(test_app, tmp_path):
    image = tmp_path / "meal.jpg"
    image.write_bytes(b"fake-image")
    client = SequenceOllamaClient([FakeOllamaResponse()])

    await NutritionVisionAnalyzer(test_app.state.settings, http_client=client).analyze(
        [{"original_path": str(image)}]
    )

    payload = client.payloads[0]
    assert payload["think"] is False
    assert "/no_think" in payload["messages"][0]["content"]
    assert payload["options"]["num_predict"] >= 4096


@pytest.mark.asyncio
async def test_vision_analyzer_reports_empty_response_after_fallback(test_app, tmp_path):
    image = tmp_path / "meal.jpg"
    image.write_bytes(b"fake-image")
    client = SequenceOllamaClient([EmptyOllamaResponse(), EmptyOllamaResponse("load")])

    with pytest.raises(RuntimeError, match=r"empty response \(load\)"):
        await NutritionVisionAnalyzer(test_app.state.settings, http_client=client).analyze(
            [{"original_path": str(image)}]
        )


def test_model_json_parser_extracts_json_from_surrounding_text():
    result = parse_model_json('Voici le JSON:\n{"items":[{"name":"Brocoli","portion_g":100}],"confidence":"medium"}\nFin.')

    assert result["items"][0]["name"] == "Brocoli"


def test_model_json_parser_rejects_empty_response_with_clear_message():
    with pytest.raises(RuntimeError, match="empty response"):
        parse_model_json("")

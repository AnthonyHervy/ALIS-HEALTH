import json
import asyncio
from datetime import datetime, timezone

import pytest

from app.core.config import Settings
from app.core.agent_prompt import DEFAULT_AGENT_PROMPT
from app.schemas import CoachChatRequest, CoachTodayAdviceResponse
from app.services.coach import CoachService
from app.services.ollama import OllamaClient, OllamaError
from httpx import ASGITransport, AsyncClient


def test_local_llm_settings_have_ollama_defaults():
    settings = Settings(secret_key="test-secret", pairing_code="pair")

    assert settings.health_llm_provider == "ollama"
    assert settings.health_llm_base_url == "http://host.docker.internal:11434"
    assert settings.health_llm_model == "gpt-oss:20b"
    assert settings.health_llm_think == "medium"
    assert settings.health_llm_advice_max_tokens == 180
    assert settings.health_llm_chat_max_tokens == 1200
    assert settings.health_llm_context_tokens == 8192
    assert settings.health_llm_advice_timeout_seconds == 12
    assert settings.health_llm_stream_first_token_timeout_seconds == 90
    assert settings.health_llm_timeout_seconds == 180
    assert settings.health_llm_keep_alive == "4h"


def test_coach_chat_request_defaults():
    request = CoachChatRequest(message="Comment optimiser ma récupération ?")

    assert request.message == "Comment optimiser ma récupération ?"
    assert request.mode == "coach"
    assert request.history == []
    assert request.language is None


def test_coach_chat_request_accepts_english_language():
    request = CoachChatRequest(message="How can I recover better?", language="en")

    assert request.language == "en"


@pytest.mark.asyncio
async def test_coach_system_prompt_invites_warm_encouraging_style():
    service = CoachService(context_service=None, llm=None, model="gpt-oss:20b")

    messages = await service._system_messages("user-1")
    prompt = messages[0]["content"]

    assert "très encourageant" in prompt
    assert "emoticônes" in prompt
    assert "prénom" in prompt
    assert "analyse professionnelle" in prompt
    assert "semaine" in prompt
    assert "profil" in prompt
    assert "donnée absente" in prompt
    assert "ne signifie pas" in prompt
    assert "conversation" in prompt
    assert "pas une checklist" in prompt
    assert "puces uniquement" not in prompt


@pytest.mark.asyncio
async def test_coach_system_prompt_can_be_english():
    service = CoachService(context_service=None, llm=None, model="gpt-oss:20b")

    messages = await service._system_messages("user-1", language="en")
    prompt = messages[0]["content"]

    assert "You answer in English" in prompt
    assert "encouraging" in prompt
    assert "does not mean the user did not eat or drink" in prompt
    assert "Tu réponds en français" not in prompt


def test_coach_chat_instruction_prefers_conversation_over_cold_lists():
    service = CoachService(context_service=None, llm=None, model="gpt-oss:20b")
    messages = service._chat_messages(
        system_messages=[],
        context={"windows": {"last_24h": {}, "week": {}, "month": {}}},
        message="Analyse ma séance de running",
        history=[],
        mode="coach",
    )

    instruction = messages[-1]["content"]

    assert "conversation" in instruction
    assert "paragraphes courts" in instruction
    assert "pas une checklist" in instruction
    assert "puces uniquement" not in instruction


def test_coach_chat_instruction_can_be_english():
    service = CoachService(context_service=None, llm=None, model="gpt-oss:20b")
    messages = service._chat_messages(
        system_messages=[],
        context={"windows": {"last_24h": {}, "week": {}, "month": {}}},
        message="Analyze my run",
        history=[],
        mode="coach",
        language="en",
    )

    instruction = messages[-1]["content"]

    assert "Concise conversational mobile answer" in instruction
    assert "not a checklist" in instruction
    assert "Réponse concise" not in instruction


def test_today_advice_response_shape():
    response = CoachTodayAdviceResponse(
        version="healthconnect.coach.today_advice.v1",
        generated_at="2026-05-25T08:00:00Z",
        model="qwen3.6:35b",
        advice={
            "title": "Priorité récupération",
            "summary": "Ta nuit courte suggère une journée plus douce.",
            "action": "Garde une marche légère aujourd'hui.",
        },
        confidence="medium",
        context_window="24h",
        fallback=False,
        actions=[
            {
                "slug": "protect_recovery",
                "label": "Protéger la récupération",
                "priority": 1,
                "reason": "Nuit courte.",
                "action": "Allège la journée.",
                "tone": "orange",
            }
        ],
    )

    assert response.advice.title == "Priorité récupération"
    assert response.context_window == "24h"
    assert response.actions[0].slug == "protect_recovery"


class FakeResponse:
    def __init__(self, status_code=200, payload=None, lines=None):
        self.status_code = status_code
        self._payload = payload or {}
        self._lines = lines or []
        self.text = json.dumps(self._payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("bad status")

    def json(self):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeHttpClient:
    def __init__(self):
        self.requests = []

    async def post(self, url, json, timeout):
        self.requests.append(("post", url, json, timeout))
        return FakeResponse(payload={"message": {"content": "Réponse locale."}})

    def stream(self, method, url, json, timeout):
        self.requests.append(("stream", method, url, json, timeout))
        return FakeResponse(
            lines=[
                '{"message":{"content":"Bon"}}',
                '{"message":{"content":"jour"}}',
                '{"done":true}',
            ]
        )


@pytest.mark.asyncio
async def test_ollama_client_chat_posts_to_chat_api():
    http = FakeHttpClient()
    client = OllamaClient("http://ollama:11434", "qwen3.6:35b", http_client=http)

    response = await client.chat(
        messages=[{"role": "user", "content": "Salut"}],
        max_tokens=180,
        temperature=0.2,
    )

    assert response == "Réponse locale."
    assert http.requests[0][1] == "http://ollama:11434/api/chat"
    assert http.requests[0][2]["model"] == "qwen3.6:35b"
    assert http.requests[0][2]["think"] == "medium"
    assert http.requests[0][2]["stream"] is False
    assert http.requests[0][2]["options"]["num_predict"] == 180
    assert http.requests[0][2]["options"]["num_ctx"] == 8192
    assert http.requests[0][2]["keep_alive"] == "4h"


@pytest.mark.asyncio
async def test_ollama_client_stream_yields_content_chunks():
    http = FakeHttpClient()
    client = OllamaClient("http://ollama:11434", "qwen3.6:35b", http_client=http)

    chunks = []
    async for chunk in client.stream_chat(
        messages=[{"role": "user", "content": "Salut"}],
        max_tokens=700,
        temperature=0.3,
    ):
        chunks.append(chunk)

    assert chunks == ["Bon", "jour"]
    assert http.requests[0][3]["stream"] is True
    assert http.requests[0][3]["think"] == "medium"


@pytest.mark.asyncio
async def test_ollama_client_raises_readable_error_on_bad_payload():
    class BadHttpClient(FakeHttpClient):
        async def post(self, url, json, timeout):
            return FakeResponse(payload={"unexpected": True})

    client = OllamaClient("http://ollama:11434", "qwen3.6:35b", http_client=BadHttpClient())

    with pytest.raises(OllamaError, match="Invalid Ollama response"):
        await client.chat(messages=[{"role": "user", "content": "Salut"}], max_tokens=180)


class FakeCoachContext:
    async def overview(self, user_id, window):
        return {
            "window": window,
            "sleep": {"average_duration_minutes": 268, "latest_sleep_awakenings_count": 4},
            "activity": {"steps": 31508, "average_daily_steps": 12000},
            "workouts": {
                "sessions": 1,
                "duration_minutes": 115,
                "running_distance_meters": 20600,
                "history": [],
            },
            "training_load": {"score": 72, "label": "Charge élevée"},
            "coach_actions": [
                {
                    "slug": "protect_recovery",
                    "label": "Protéger la récupération",
                    "priority": 1,
                    "reason": "Nuit courte.",
                    "action": "Allège la journée.",
                    "tone": "orange",
                }
            ],
            "life_balance_scores": {
                "window": "24h",
                "scores": [
                    {
                        "slug": "sleep",
                        "label": "Sommeil",
                        "value": 58,
                        "tone": "orange",
                        "confidence": "medium",
                        "explanation": "Nuit courte",
                        "contributors": [],
                    },
                    {
                        "slug": "recovery",
                        "label": "Récupération",
                        "value": 50,
                        "tone": "orange",
                        "confidence": "medium",
                        "explanation": "Charge récente",
                        "contributors": [],
                    },
                    {
                        "slug": "movement",
                        "label": "Mouvement",
                        "value": 100,
                        "tone": "green",
                        "confidence": "high",
                        "explanation": "Objectif atteint",
                        "contributors": [],
                    },
                ],
            }
            if window == "24h"
            else None,
            "source_badge": "Custom",
        }


class FakeCoachLlm:
    def __init__(self):
        self.messages = None

    async def chat(self, messages, max_tokens, temperature=0.2, format_json=False):
        self.messages = messages
        return '{"title":"Priorité récupération","summary":"Ta nuit courte et ta charge récente invitent à lever le pied.","action":"Garde une marche légère et évite l’intensité aujourd’hui."}'

    async def stream_chat(self, messages, max_tokens, temperature=0.3):
        self.messages = messages
        for chunk in ["Analyse ", "locale."]:
            yield chunk


class FakeAgentSettings:
    async def prompt_for_user(self, user_id):
        return "Coach personnalisé: priorité endurance, force et récupération."


class FakeCoachSummaryContext(FakeCoachContext):
    async def dashboard_bundle(self, user_id):
        last_24h = await super().overview(user_id, "24h")
        week = await super().overview(user_id, "7d")
        month = await super().overview(user_id, "30d")
        last_24h["series"] = [{"date": "2026-05-24", "steps": 31508, "sleep_minutes": 268}]
        return {
            "windows": {
                "last_24h": last_24h,
                "week": week,
                "month": month,
            },
            "coach_summary": {
                "version": "2026-06-14.1",
                "windows": {
                    "last_24h": {
                        "label": "24h",
                        "sleep_minutes": 268,
                        "steps": 31508,
                        "workout_minutes": 115,
                        "recovery_score": 50,
                        "movement_score": 100,
                    },
                    "week": {
                        "label": "7j",
                        "average_daily_steps": 12000,
                        "workout_minutes": 115,
                    },
                    "month": {
                        "label": "30j",
                        "average_daily_steps": 12000,
                        "workout_minutes": 115,
                    },
                },
                "source_reliability": {
                    "activity": {
                        "status": "received",
                        "selected_source_label": "Garmin",
                        "selected_value": 31508,
                    }
                },
                "data_limitations": ["Scores indicatifs."],
            },
        }


@pytest.mark.asyncio
async def test_coach_service_prefers_precomputed_summary_without_raw_series():
    service = CoachService(FakeCoachSummaryContext(), FakeCoachLlm(), model="qwen3.6:35b")

    context = await service.build_context("user-1")

    assert context["coach_summary"]["version"] == "2026-06-14.1"
    assert context["coach_summary"]["windows"]["last_24h"]["steps"] == 31508
    assert "windows" not in context
    assert "series" not in json.dumps(context, ensure_ascii=False)


def test_coach_fallback_chat_accepts_precomputed_summary_context():
    context = {
        "coach_summary": {
            "windows": {
                "last_24h": {
                    "sleep_minutes": 420,
                    "steps": 7420,
                    "active_calories_kcal": 520,
                    "workout_sessions": 1,
                    "workout_minutes": 45,
                    "sleep_score": 88,
                    "recovery_score": 98,
                    "movement_score": 64,
                    "nutrition_meals": 0,
                    "coach_actions": [
                        {
                            "label": "Récupération active",
                            "priority": 1,
                            "action": "Garde une marche légère et une soirée calme.",
                        }
                    ],
                },
                "week": {"average_daily_steps": 7900, "workout_minutes": 180},
            },
            "source_reliability": {
                "activity": {
                    "status": "received",
                    "selected_source_label": "Garmin",
                    "selected_value": 7420,
                }
            },
        },
        "data_limitations": ["Scores indicatifs."],
    }

    response = CoachService._fallback_chat(context, "Je pousse demain ?")

    assert "résumé ALIS déjà calculé" in response
    assert "Garmin" in response
    assert "Nutrition non validée" in response
    assert "Récupération active" in response
    assert "7,420" in response or "7\u202f420" in response


def test_coach_fallback_advice_accepts_precomputed_summary_context():
    context = {
        "coach_summary": {
            "windows": {
                "last_24h": {
                    "sleep_minutes": 300,
                    "workout_sessions": 0,
                    "coach_actions": [],
                }
            }
        }
    }

    advice = CoachService._fallback_advice(context)

    assert advice["title"] == "Priorité sommeil"


@pytest.mark.asyncio
async def test_coach_service_builds_today_advice_from_context():
    llm = FakeCoachLlm()
    service = CoachService(FakeCoachContext(), llm, model="qwen3.6:35b", agent_settings=FakeAgentSettings())

    payload = await service.today_advice("user-1")

    assert payload["version"] == "healthconnect.coach.today_advice.v1"
    assert payload["model"] == "qwen3.6:35b"
    assert payload["advice"]["title"] == "Priorité récupération"
    assert payload["fallback"] is False
    assert "life_balance_scores" in llm.messages[2]["content"]
    assert "Coach personnalisé" in llm.messages[1]["content"]


@pytest.mark.asyncio
async def test_coach_service_includes_validated_nutrition_in_compact_context():
    class NutritionCoachContext(FakeCoachContext):
        async def overview(self, user_id, window):
            payload = await super().overview(user_id, window)
            payload["nutrition"] = {
                "meals": 2,
                "energy_kcal": 1840,
                "protein_g": 128,
                "carbohydrates_g": 190,
                "fat_g": 62,
                "hydration_liters": 1.7,
            }
            return payload

    service = CoachService(NutritionCoachContext(), FakeCoachLlm(), model="qwen3.6:35b")

    context = await service.build_context("user-1")

    assert context["windows"]["last_24h"]["nutrition"] == {
        "meals": 2,
        "energy_kcal": 1840,
        "protein_g": 128,
        "carbohydrates_g": 190,
        "fat_g": 62,
        "hydration_liters": 1.7,
    }


@pytest.mark.asyncio
async def test_coach_service_includes_action_priorities_in_context_and_advice():
    service = CoachService(FakeCoachContext(), FakeCoachLlm(), model="qwen3.6:35b")

    context = await service.build_context("user-1")
    payload = await service.today_advice("user-1")

    assert context["windows"]["last_24h"]["coach_actions"][0]["slug"] == "protect_recovery"
    assert payload["actions"][0]["slug"] == "protect_recovery"


@pytest.mark.asyncio
async def test_coach_service_uses_deterministic_fallback_on_llm_error():
    class FailingLlm(FakeCoachLlm):
        async def chat(self, messages, max_tokens, temperature=0.2, format_json=False):
            raise RuntimeError("ollama down")

    service = CoachService(FakeCoachContext(), FailingLlm(), model="qwen3.6:35b")

    payload = await service.today_advice("user-1")

    assert payload["fallback"] is True
    assert payload["advice"]["title"]
    assert payload["confidence"] in {"low", "medium"}


@pytest.mark.asyncio
async def test_coach_service_stream_chat_yields_chunks():
    llm = FakeCoachLlm()
    service = CoachService(FakeCoachContext(), llm, model="qwen3.6:35b")

    chunks = [chunk async for chunk in service.stream_chat("user-1", "Comment optimiser ma récupération ?")]

    assert chunks == ["Analyse ", "locale."]
    assert "Comment optimiser ma récupération ?" in llm.messages[-1]["content"]


@pytest.mark.asyncio
async def test_coach_service_stream_chat_falls_back_when_first_token_is_too_slow():
    class SlowFirstTokenLlm(FakeCoachLlm):
        async def stream_chat(self, messages, max_tokens, temperature=0.3):
            await asyncio.sleep(0.2)
            yield "Trop tard."

    service = CoachService(
        FakeCoachContext(),
        SlowFirstTokenLlm(),
        model="qwen3.6:35b",
        stream_first_token_timeout_seconds=0.01,
    )

    chunks = [chunk async for chunk in service.stream_chat("user-1", "Peux-tu approfondir le conseil du jour ?")]

    assert len(chunks) == 1
    assert "modèle local met trop longtemps" in chunks[0]
    assert "Sommeil" in chunks[0]


def test_coach_fallback_chat_mentions_validated_nutrition_when_available():
    context = {
        "windows": {
            "last_24h": {
                "sleep": {"average_duration_minutes": 420},
                "activity": {"steps": 8200},
                "workouts": {"sessions": 1, "duration_minutes": 45},
                "life_balance_scores": {"scores": []},
                "coach_actions": [
                    {
                        "slug": "log_nutrition",
                        "label": "Renseigner la nutrition",
                        "priority": 1,
                        "reason": "Repas incomplet.",
                        "action": "Valide le repas principal.",
                        "tone": "green",
                    }
                ],
                "nutrition": {
                    "meals": 2,
                    "energy_kcal": 1840,
                    "protein_g": 128,
                    "carbohydrates_g": 190,
                    "fat_g": 62,
                    "hydration_liters": 1.7,
                },
            },
            "week": {"activity": {"average_daily_steps": 9000}},
        }
    }

    response = CoachService._fallback_chat(context, "Nutrition ?")

    assert "### Nutrition" in response
    assert "### Actions coach" in response
    assert "Valide le repas principal." in response
    assert "Repas validés: 2" in response
    assert "1\u202f840 kcal" in response or "1,840 kcal" in response
    assert "P 128 g · G 190 g · L 62 g" in response


async def register_token(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/auth/register",
        json={"pairing_code": "dev-pairing-code", "device_name": "Portal"},
    )
    assert response.status_code == 200
    return response.json()["device_token"]


@pytest.mark.asyncio
async def test_today_advice_endpoint_requires_auth(test_app):
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        response = await client.get("/api/v1/coach/today-advice")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_today_advice_endpoint_returns_fallback_when_ollama_unavailable(test_app, monkeypatch):
    async def fail_fast(self, messages, max_tokens, temperature=0.2, format_json=False):
        raise RuntimeError("ollama down")

    monkeypatch.setattr(OllamaClient, "chat", fail_fast)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.get("/api/v1/coach/today-advice", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["version"] == "healthconnect.coach.today_advice.v1"
    assert payload["model"] == "gpt-oss:20b"
    assert payload["advice"]["title"]
    assert payload["fallback"] is True


@pytest.mark.asyncio
async def test_today_advice_endpoint_uses_accept_language(test_app, monkeypatch):
    captured = {}

    async def fake_today_advice(self, user_id, language="fr"):
        captured["language"] = language
        return {
            "version": "healthconnect.coach.today_advice.v1",
            "generated_at": "2026-06-14T10:00:00+00:00",
            "model": "test-model",
            "advice": {"title": "Today plan", "summary": "Keep it easy.", "action": "Recover gently."},
            "actions": [],
            "confidence": "medium",
            "context_window": "24h",
            "fallback": False,
        }

    monkeypatch.setattr(CoachService, "today_advice", fake_today_advice)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.get(
            "/api/v1/coach/today-advice",
            headers={"Authorization": f"Bearer {token}", "Accept-Language": "en"},
        )

    assert response.status_code == 200
    assert captured["language"] == "en"


@pytest.mark.asyncio
async def test_agent_prompt_endpoints_return_default_and_save_custom_prompt(test_app):
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.get("/api/v1/config/agent-prompt", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["is_default"] is True
        assert "Athletic Profile" in payload["prompt"]
        assert payload["prompt"] == DEFAULT_AGENT_PROMPT

        update = await client.put(
            "/api/v1/config/agent-prompt",
            headers={"Authorization": f"Bearer {token}"},
            json={"prompt": "Coach custom endurance et nutrition."},
        )
        assert update.status_code == 200
        assert update.json()["is_default"] is False

        saved = await client.get("/api/v1/config/agent-prompt", headers={"Authorization": f"Bearer {token}"})
        assert saved.json()["prompt"] == "Coach custom endurance et nutrition."


@pytest.mark.asyncio
async def test_coach_goals_endpoints_return_default_and_save_custom_goals(test_app):
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.get("/api/v1/config/coach-goals", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["is_default"] is True
        assert payload["goals"][0]["slug"] == "recovery"
        assert payload["goals"][0]["enabled"] is True

        update = await client.put(
            "/api/v1/config/coach-goals",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "goals": [
                    {"slug": "endurance", "label": "Endurance", "priority": 1, "enabled": True},
                    {"slug": "sleep", "label": "Sommeil", "priority": 2, "enabled": False},
                ]
            },
        )
        assert update.status_code == 200
        assert update.json()["is_default"] is False
        assert update.json()["goals"][0]["slug"] == "endurance"

        saved = await client.get("/api/v1/config/coach-goals", headers={"Authorization": f"Bearer {token}"})
        assert saved.json()["goals"] == [
            {"slug": "endurance", "label": "Endurance", "priority": 1, "enabled": True},
            {"slug": "sleep", "label": "Sommeil", "priority": 2, "enabled": False},
        ]


@pytest.mark.asyncio
async def test_coach_system_messages_include_enabled_goals():
    class FakeAgentSettings:
        async def prompt_for_user(self, user_id):
            return ""

        async def goals_for_user(self, user_id):
            return [
                {"slug": "endurance", "label": "Endurance", "priority": 1, "enabled": True},
                {"slug": "sleep", "label": "Sommeil", "priority": 2, "enabled": False},
                {"slug": "recovery", "label": "Récupération", "priority": 3, "enabled": True},
            ]

    service = CoachService(context_service=None, llm=None, model="gpt-oss:20b", agent_settings=FakeAgentSettings())

    messages = await service._system_messages("user-1")

    goals_message = next(message["content"] for message in messages if "Objectifs actifs" in message["content"])
    assert "1. Endurance" in goals_message
    assert "3. Récupération" in goals_message
    assert "Sommeil" not in goals_message


@pytest.mark.asyncio
async def test_chat_endpoint_returns_response(test_app, monkeypatch):
    async def fake_chat(self, user_id, message, history=None, mode="coach", language="fr"):
        return "Réponse coach locale."

    monkeypatch.setattr(CoachService, "chat", fake_chat)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.post(
            "/api/v1/coach/chat",
            headers={"Authorization": f"Bearer {token}"},
            json={"message": "Comment mieux dormir ?"},
        )

    assert response.status_code == 200
    assert response.json()["response"] == "Réponse coach locale."


@pytest.mark.asyncio
async def test_chat_endpoint_passes_requested_language(test_app, monkeypatch):
    captured = {}

    async def fake_chat(self, user_id, message, history=None, mode="coach", language="fr"):
        captured["language"] = language
        return "Local coach response."

    monkeypatch.setattr(CoachService, "chat", fake_chat)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.post(
            "/api/v1/coach/chat",
            headers={"Authorization": f"Bearer {token}"},
            json={"message": "How can I recover?", "language": "en"},
        )

    assert response.status_code == 200
    assert captured["language"] == "en"


@pytest.mark.asyncio
async def test_chat_stream_endpoint_emits_sse(test_app, monkeypatch):
    async def fake_stream(self, user_id, message, history=None, mode="coach", language="fr"):
        for chunk in ["Réponse ", "streamée"]:
            yield chunk

    monkeypatch.setattr(CoachService, "stream_chat", fake_stream)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.post(
            "/api/v1/coach/chat/stream",
            headers={"Authorization": f"Bearer {token}"},
            json={"message": "Comment optimiser ma récupération ?"},
        )

    assert response.status_code == 200
    body = response.text
    assert "event: meta" in body
    assert "event: delta" in body
    assert "Réponse " in body
    assert "streamée" in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_chat_stream_endpoint_passes_requested_language(test_app, monkeypatch):
    captured = {}

    async def fake_stream(self, user_id, message, history=None, mode="coach", language="fr"):
        captured["language"] = language
        yield "English response"

    monkeypatch.setattr(CoachService, "stream_chat", fake_stream)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.post(
            "/api/v1/coach/chat/stream",
            headers={"Authorization": f"Bearer {token}"},
            json={"message": "How can I recover?", "language": "en"},
        )

    assert response.status_code == 200
    assert captured["language"] == "en"
    assert "English response" in response.text


@pytest.mark.asyncio
async def test_coach_status_endpoint_reports_local_model_state(test_app, monkeypatch):
    async def fake_status(self):
        return {
            "model": "gpt-oss:20b",
            "loaded": True,
            "load_duration_ms": 12,
            "first_token_latency_ms": 34,
        }

    monkeypatch.setattr(OllamaClient, "status", fake_status)

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as client:
        token = await register_token(client)
        response = await client.get("/api/v1/coach/status", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"] == "gpt-oss:20b"
    assert payload["loaded"] is True
    assert payload["first_token_latency_ms"] == 34

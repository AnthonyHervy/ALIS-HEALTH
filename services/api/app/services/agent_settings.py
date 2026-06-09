from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.agent_prompt import DEFAULT_AGENT_PROMPT
from app.models import HealthAgentSetting


DEFAULT_COACH_GOALS = [
    {"slug": "recovery", "label": "Récupération", "priority": 1, "enabled": True},
    {"slug": "endurance", "label": "Endurance", "priority": 2, "enabled": True},
    {"slug": "strength_power", "label": "Force et explosivité", "priority": 3, "enabled": True},
    {"slug": "sleep", "label": "Sommeil", "priority": 4, "enabled": True},
    {"slug": "nutrition_body_composition", "label": "Nutrition et composition corporelle", "priority": 5, "enabled": True},
]


class AgentSettingsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def prompt_response(self, user_id: str) -> dict:
        setting = await self._get_setting(user_id)
        if setting is None:
            return {
                "prompt": DEFAULT_AGENT_PROMPT,
                "is_default": True,
                "updated_at": None,
            }
        return {
            "prompt": setting.prompt,
            "is_default": False,
            "updated_at": setting.updated_at,
        }

    async def prompt_for_user(self, user_id: str) -> str:
        setting = await self._get_setting(user_id)
        return setting.prompt if setting is not None else DEFAULT_AGENT_PROMPT

    async def goals_response(self, user_id: str) -> dict:
        setting = await self._get_setting(user_id)
        if setting is None or setting.coach_goals is None:
            return {"goals": DEFAULT_COACH_GOALS, "is_default": True, "updated_at": None}
        return {"goals": setting.coach_goals, "is_default": False, "updated_at": setting.updated_at}

    async def goals_for_user(self, user_id: str) -> list[dict]:
        setting = await self._get_setting(user_id)
        if setting is None or setting.coach_goals is None:
            return DEFAULT_COACH_GOALS
        return setting.coach_goals

    async def save_prompt(self, user_id: str, prompt: str) -> dict:
        cleaned = prompt.strip()
        now = datetime.utcnow()
        setting = await self._get_setting(user_id)
        if setting is None:
            self.db.add(HealthAgentSetting(user_id=user_id, prompt=cleaned, coach_goals=None, updated_at=now))
        else:
            setting.prompt = cleaned
            setting.updated_at = now
        return {
            "prompt": cleaned,
            "is_default": cleaned == DEFAULT_AGENT_PROMPT.strip(),
            "updated_at": now,
        }

    async def save_goals(self, user_id: str, goals: list[dict]) -> dict:
        cleaned = sorted(
            [
                {
                    "slug": str(goal["slug"]).strip(),
                    "label": str(goal["label"]).strip(),
                    "priority": int(goal["priority"]),
                    "enabled": bool(goal["enabled"]),
                }
                for goal in goals
            ],
            key=lambda goal: goal["priority"],
        )
        now = datetime.utcnow()
        setting = await self._get_setting(user_id)
        if setting is None:
            self.db.add(
                HealthAgentSetting(
                    user_id=user_id,
                    prompt=DEFAULT_AGENT_PROMPT,
                    coach_goals=cleaned,
                    updated_at=now,
                )
            )
        else:
            setting.coach_goals = cleaned
            setting.updated_at = now
        return {
            "goals": cleaned,
            "is_default": cleaned == DEFAULT_COACH_GOALS,
            "updated_at": now,
        }

    async def _get_setting(self, user_id: str) -> HealthAgentSetting | None:
        return await self.db.scalar(
            select(HealthAgentSetting).where(HealthAgentSetting.user_id == user_id).limit(1)
        )

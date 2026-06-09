import json
import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any


COACH_SYSTEM_PROMPT = """Tu es le coach local HealthConnect.
Tu réponds en français, avec un ton calme, concret, prudent, humain, très encourageant et motivant.
Tu parles comme un coach qui accompagne vraiment l'utilisateur: chaleureux, simple, jamais sec ni robotique.
Si un prénom est fourni dans le profil, tu peux l'utiliser naturellement, sans forcer à chaque phrase.
Tu peux utiliser 1 à 3 emoticônes sobres quand cela rend la réponse plus chaleureuse, mais jamais au détriment de la clarté.
Tu fournis une analyse professionnelle: relie les données des dernières 24h, de la semaine, du mois, du profil utilisateur et des objectifs actifs.
Tu évites les conseils génériques: explique le mécanisme probable, le niveau de confiance, puis donne une action concrète adaptée au contexte.
Une donnée absente, nutrition non renseignée ou hydratation à 0 L dans le contexte ne signifie pas que l'utilisateur ne mange pas ou ne boit pas; dis plutôt que la donnée n'est pas renseignée/validée.
Tu utilises les données fournies dans le contexte et tu n'inventes jamais de métriques.
Tu n'es pas médecin et tu ne poses pas de diagnostic.
Si le sujet touche fatigue persistante, douleur, malaise, trouble sévère du sommeil, perte de poids extrême, médicament ou pathologie, conseille un avis médical qualifié.
Réponses par défaut: concises, actionnables, avec les chiffres personnels utiles.
Commence les réponses de priorités par une phrase courte qui contextualise et encourage, puis donne les points utiles.
Écris comme dans une conversation avec un vrai coach: vivant, naturel, direct, pas une checklist ni un compte-rendu froid.
Ne décris jamais ton processus interne, ton raisonnement caché, ni des étapes comme "analyse" ou "recherche"; donne directement la réponse utile.
Format mobile conversationnel:
- privilégie 2 à 4 paragraphes courts, faciles à lire sur téléphone;
- tu peux utiliser un seul titre court si cela aide, mais pas de gros plan découpé systématique;
- utilise une mini-liste seulement pour 2 ou 3 actions très concrètes;
- n'utilise jamais de tableau markdown;
- n'utilise jamais de HTML, notamment pas de <br>;
- évite les listes froides: chaque conseil doit être formulé avec bienveillance et relié au contexte.
"""

TODAY_ADVICE_PROMPT = """Retourne uniquement un JSON valide avec:
{"title": "...", "summary": "...", "action": "..."}
Contraintes:
- title: 2 à 5 mots
- summary: une phrase courte, humaine et encourageante, basée sur le contexte
- action: une action concrète pour aujourd'hui, formulée avec bienveillance
- pas de markdown
- pas de diagnostic médical
"""


class CoachService:
    def __init__(
        self,
        context_service: Any,
        llm: Any,
        model: str,
        advice_max_tokens: int = 180,
        chat_max_tokens: int = 1200,
        advice_timeout_seconds: int = 12,
        stream_first_token_timeout_seconds: int = 12,
        agent_settings: Any | None = None,
    ):
        self.context_service = context_service
        self.llm = llm
        self.model = model
        self.advice_max_tokens = advice_max_tokens
        self.chat_max_tokens = chat_max_tokens
        self.advice_timeout_seconds = advice_timeout_seconds
        self.stream_first_token_timeout_seconds = stream_first_token_timeout_seconds
        self.agent_settings = agent_settings

    async def build_context(self, user_id: str) -> dict[str, Any]:
        dashboard_bundle = None
        if hasattr(self.context_service, "dashboard_bundle"):
            dashboard_bundle = await self.context_service.dashboard_bundle(user_id)
        if dashboard_bundle:
            last_24h = dashboard_bundle["last_24h"]
            week = dashboard_bundle["week"]
            month = dashboard_bundle["month"]
        else:
            last_24h = await self.context_service.overview(user_id, "24h")
            week = await self.context_service.overview(user_id, "7d")
            month = await self.context_service.overview(user_id, "30d")
        return {
            "windows": {
                "last_24h": self._compact_overview(last_24h),
                "week": self._compact_overview(week),
                "month": self._compact_overview(month),
            },
            "data_limitations": [
                "Les scores sont heuristiques et indicatifs.",
                "Les réponses ne remplacent pas un avis médical.",
            ],
        }

    async def today_advice(self, user_id: str) -> dict[str, Any]:
        context = await self.build_context(user_id)
        messages = [
            *(await self._system_messages(user_id)),
            {
                "role": "user",
                "content": TODAY_ADVICE_PROMPT
                + "\n\nContexte JSON:\n"
                + json.dumps(context, ensure_ascii=False, default=str),
            },
        ]
        try:
            content = await asyncio.wait_for(
                self.llm.chat(
                    messages,
                    max_tokens=self.advice_max_tokens,
                    temperature=0.2,
                    format_json=True,
                ),
                timeout=self.advice_timeout_seconds,
            )
            parsed = self._parse_advice(content)
            fallback = False
            confidence = "medium"
        except Exception:
            parsed = self._fallback_advice(context)
            fallback = True
            confidence = "low"
        return {
            "version": "healthconnect.coach.today_advice.v1",
            "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
            "model": self.model,
            "advice": parsed,
            "actions": self._context_actions(context),
            "confidence": confidence,
            "context_window": "24h",
            "fallback": fallback,
        }

    async def chat(
        self,
        user_id: str,
        message: str,
        history: list[Any] | None = None,
        mode: str = "coach",
    ) -> str:
        context = await self.build_context(user_id)
        messages = self._chat_messages(await self._system_messages(user_id), context, message, history or [], mode)
        return await self.llm.chat(messages, max_tokens=self.chat_max_tokens, temperature=0.3)

    async def stream_chat(
        self,
        user_id: str,
        message: str,
        history: list[Any] | None = None,
        mode: str = "coach",
    ) -> AsyncIterator[str]:
        context = await self.build_context(user_id)
        messages = self._chat_messages(await self._system_messages(user_id), context, message, history or [], mode)
        stream = self.llm.stream_chat(messages, max_tokens=self.chat_max_tokens, temperature=0.3)
        iterator = stream.__aiter__()
        try:
            first_chunk = await asyncio.wait_for(
                iterator.__anext__(),
                timeout=self.stream_first_token_timeout_seconds,
            )
        except (asyncio.TimeoutError, StopAsyncIteration, Exception):
            close = getattr(iterator, "aclose", None)
            if close is not None:
                await close()
            yield self._fallback_chat(context, message)
            return

        yield first_chunk
        async for chunk in iterator:
            yield chunk

    def _chat_messages(
        self,
        system_messages: list[dict[str, str]],
        context: dict[str, Any],
        message: str,
        history: list[Any],
        mode: str,
    ) -> list[dict[str, str]]:
        mode_instruction = (
            "Réponse concise et conversationnelle pour mobile: 2 à 4 paragraphes courts, sans tableau, sans HTML, pas une checklist. "
            "Une mini-liste de 2 ou 3 actions est possible seulement si elle rend le conseil plus clair. "
            "Fais une lecture intégrée comme un coach professionnel: 24h + semaine + profil + objectifs, puis priorités concrètes. "
            "Si nutrition ou hydratation sont à 0/non renseignées, présente cela comme une limite de données, jamais comme une preuve que l'utilisateur ne mange ou ne boit pas."
        )
        if mode == "plan":
            mode_instruction = (
                "Construis un plan prudent sur 7 à 30 jours avec hypothèses explicites. "
                "Format mobile: paragraphes courts, sous-titres sobres si utiles, mini-listes seulement pour les actions, sans tableau, sans HTML. "
                "Base le plan sur la semaine, le mois, le profil et les objectifs, avec un ton de coach professionnel et motivant."
            )
        messages = [
            *system_messages,
            {
                "role": "user",
                "content": "Contexte HealthConnect JSON:\n" + json.dumps(context, ensure_ascii=False, default=str),
            },
        ]
        for item in history[-4:]:
            role = getattr(item, "role", None)
            content = getattr(item, "content", None)
            if isinstance(item, dict):
                role = role or item.get("role")
                content = content or item.get("content")
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": str(content)})
        messages.append({"role": "user", "content": f"{mode_instruction}\nQuestion: {message}"})
        return messages

    async def _system_messages(self, user_id: str) -> list[dict[str, str]]:
        messages = [{"role": "system", "content": COACH_SYSTEM_PROMPT}]
        if self.agent_settings is None:
            return messages
        prompt = await self.agent_settings.prompt_for_user(user_id)
        if prompt.strip():
            messages.append({"role": "system", "content": "Profil, objectifs et style de coaching utilisateur:\n" + prompt.strip()})
        goals_for_user = getattr(self.agent_settings, "goals_for_user", None)
        if goals_for_user is not None:
            goals = await goals_for_user(user_id)
            enabled_goals = [goal for goal in goals if goal.get("enabled")]
            if enabled_goals:
                compact = "\n".join(
                    f"{goal.get('priority')}. {goal.get('label')}"
                    for goal in sorted(enabled_goals, key=lambda item: item.get("priority") or 99)
                )
                messages.append({"role": "system", "content": "Objectifs actifs du coaching, par priorité:\n" + compact})
        return messages

    @staticmethod
    def _compact_overview(payload: dict[str, Any]) -> dict[str, Any]:
        workouts = payload.get("workouts") or {}
        return {
            "window": payload.get("window"),
            "source_badge": payload.get("source_badge"),
            "effective_sources": payload.get("effective_sources"),
            "life_balance_scores": payload.get("life_balance_scores"),
            "coach_actions": payload.get("coach_actions") or [],
            "sleep": payload.get("sleep"),
            "activity": payload.get("activity"),
            "nutrition": payload.get("nutrition")
            or {
                "meals": 0,
                "energy_kcal": 0,
                "protein_g": 0,
                "carbohydrates_g": 0,
                "fat_g": 0,
                "hydration_liters": 0,
            },
            "training_load": payload.get("training_load"),
            "workouts": {
                "sessions": workouts.get("sessions"),
                "duration_minutes": workouts.get("duration_minutes"),
                "running_distance_meters": workouts.get("running_distance_meters"),
                "by_activity_type": workouts.get("by_activity_type"),
                "history": (workouts.get("history") or [])[:10],
            },
            "series": [
                {
                    "date": day.get("date"),
                    "steps": day.get("steps"),
                    "sleep_minutes": day.get("sleep_minutes"),
                    "workout_minutes": day.get("workout_minutes"),
                    "workouts": day.get("workouts"),
                }
                for day in (payload.get("series") or [])[-14:]
            ],
        }

    @staticmethod
    def _parse_advice(content: str) -> dict[str, str]:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start < 0 or end <= start:
            raise ValueError("Coach advice JSON missing")
        parsed = json.loads(content[start:end])
        return {
            "title": str(parsed["title"]).strip()[:80],
            "summary": str(parsed["summary"]).strip()[:240],
            "action": str(parsed["action"]).strip()[:240],
        }

    @staticmethod
    def _fallback_advice(context: dict[str, Any]) -> dict[str, str]:
        last_24h = context["windows"]["last_24h"]
        actions = CoachService._context_actions(context)
        if actions:
            primary = actions[0]
            return {
                "title": str(primary.get("label") or "Action coach")[:80],
                "summary": str(primary.get("reason") or "Une priorité utile ressort du contexte récent, et c'est déjà une bonne base pour avancer calmement.")[:240],
                "action": str(primary.get("action") or "Garde une décision simple, fais-la bien, puis observe tes sensations. 🙂")[:240],
            }
        sleep_minutes = int(last_24h.get("sleep", {}).get("average_duration_minutes") or 0)
        workouts = int(last_24h.get("workouts", {}).get("sessions") or 0)
        if sleep_minutes and sleep_minutes < 360:
            return {
                "title": "Priorité sommeil",
                "summary": "Ta dernière nuit semble courte, donc on protège la récupération aujourd'hui. C'est une bonne décision, pas un recul.",
                "action": "Prévois une journée plus douce, hydrate-toi bien, et vise une heure de coucher plus régulière ce soir. 🙂",
            }
        if workouts:
            return {
                "title": "Récupération active",
                "summary": "Tu as déjà une activité sportive récente: maintenant l'objectif est de consolider l'adaptation, tranquillement.",
                "action": "Garde du mouvement léger et surveille tes sensations avant d'ajouter de l'intensité. 👍",
            }
        return {
            "title": "Relance douce",
            "summary": "Les données du jour ne montrent pas de signal fort, donc une action simple et régulière suffit très bien.",
            "action": "Ajoute une marche courte et garde une routine de sommeil stable ce soir. Petit pas, vraie continuité. 🙂",
        }

    @staticmethod
    def _fallback_chat(context: dict[str, Any], message: str) -> str:
        last_24h = context["windows"]["last_24h"]
        week = context["windows"]["week"]
        sleep = last_24h.get("sleep") or {}
        activity = last_24h.get("activity") or {}
        workouts = last_24h.get("workouts") or {}
        nutrition = last_24h.get("nutrition") or {}
        actions = CoachService._context_actions(context)
        scores = {
            item.get("slug"): item.get("value")
            for item in ((last_24h.get("life_balance_scores") or {}).get("scores") or [])
        }
        nutrition_block = ""
        if int(nutrition.get("meals") or 0) > 0:
            nutrition_block = (
                "\n\n"
                f"### Nutrition\n"
                f"- Repas validés: {int(nutrition.get('meals') or 0)}.\n"
                f"- Énergie: {int(round(float(nutrition.get('energy_kcal') or 0))):,} kcal.\n"
                f"- Macros: P {int(round(float(nutrition.get('protein_g') or 0)))} g · "
                f"G {int(round(float(nutrition.get('carbohydrates_g') or 0)))} g · "
                f"L {int(round(float(nutrition.get('fat_g') or 0)))} g."
            )
        actions_block = ""
        if actions:
            actions_block = "\n\n### Actions coach\n" + "\n".join(
                f"- {item.get('label')}: {item.get('action')}" for item in actions[:3]
            )
        return (
            "Le modèle local met trop longtemps à répondre, donc je te donne une lecture rapide à partir des données calculées. On garde ça simple et utile. 🙂\n\n"
            f"### Sommeil\n"
            f"- Dernière nuit: {int(sleep.get('average_duration_minutes') or 0)} min.\n"
            f"- Score Sommeil: {scores.get('sleep', 'non disponible')}.\n\n"
            f"### Mouvement\n"
            f"- Pas aujourd'hui: {int(activity.get('steps') or 0):,}.\n"
            f"- Moyenne 7j: {int((week.get('activity') or {}).get('average_daily_steps') or 0):,} pas/j.\n\n"
            f"### Entraînement\n"
            f"- Sessions aujourd'hui: {int(workouts.get('sessions') or 0)}.\n"
            f"- Temps aujourd'hui: {int(workouts.get('duration_minutes') or 0)} min."
            f"{nutrition_block}\n\n"
            f"{actions_block}\n\n"
            "Action simple: garde une décision prudente et concrète aujourd'hui. Si tu te sens fatigué, privilégie récupération, hydratation, lumière naturelle et une heure de coucher plus stable. Tu fais déjà le bon geste en regardant les signaux. "
            f"Question reçue: {message}"
        )

    @staticmethod
    def _context_actions(context: dict[str, Any]) -> list[dict[str, Any]]:
        last_24h = context.get("windows", {}).get("last_24h") or {}
        actions = last_24h.get("coach_actions") or []
        return sorted(actions, key=lambda item: item.get("priority") or 99)[:3]

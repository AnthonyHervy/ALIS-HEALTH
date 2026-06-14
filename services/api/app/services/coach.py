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

COACH_SYSTEM_PROMPT_EN = """You are the local HealthConnect coach.
You answer in English, with a calm, concrete, careful, human, highly encouraging and motivating tone.
You speak like a coach who is genuinely supporting the user: warm, simple, never dry or robotic.
If a first name is provided in the profile, you may use it naturally, without forcing it into every sentence.
You may use 1 to 3 subtle emoticons when it makes the answer warmer, but never at the expense of clarity.
You provide a professional analysis: connect data from the last 24h, week, month, user profile and active goals.
Avoid generic advice: explain the likely mechanism, confidence level, then give one concrete action adapted to the context.
Missing data, unlogged nutrition or hydration at 0 L in context does not mean the user did not eat or drink; say the data was not logged/validated.
Use only the data provided in context and never invent metrics.
You are not a doctor and you do not diagnose.
If the topic involves persistent fatigue, pain, faintness, severe sleep issues, extreme weight loss, medication or pathology, recommend qualified medical advice.
Default answers: concise, actionable, with useful personal numbers.
Start priority answers with a short contextual and encouraging sentence, then give useful points.
Write like a conversation with a real coach: alive, natural, direct, not a checklist or cold report.
Never describe your internal process, hidden reasoning, or steps like "analysis" or "search"; give the useful answer directly.
Mobile conversational format:
- prefer 2 to 4 short paragraphs, easy to read on a phone;
- you may use one short title if it helps, but do not always split everything into a big plan;
- use a mini-list only for 2 or 3 very concrete actions;
- never use markdown tables;
- never use HTML, especially no <br>;
- avoid cold lists: every piece of advice should feel kind and connected to context.
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

TODAY_ADVICE_PROMPT_EN = """Return only valid JSON with:
{"title": "...", "summary": "...", "action": "..."}
Constraints:
- title: 2 to 5 words
- summary: one short, human and encouraging sentence based on context
- action: one concrete action for today, phrased kindly
- no markdown
- no medical diagnosis
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

    async def build_context(self, user_id: str, language: str = "fr") -> dict[str, Any]:
        dashboard_bundle = None
        if hasattr(self.context_service, "dashboard_bundle"):
            dashboard_bundle = await self.context_service.dashboard_bundle(user_id)
        if dashboard_bundle:
            if dashboard_bundle.get("coach_summary"):
                return {
                    "coach_summary": dashboard_bundle["coach_summary"],
                    "data_limitations": dashboard_bundle["coach_summary"].get("data_limitations")
                    or [
                        *self._data_limitations(language),
                    ],
                }
            windows = dashboard_bundle.get("windows") or dashboard_bundle
            last_24h = windows["last_24h"]
            week = windows["week"]
            month = windows["month"]
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
                *self._data_limitations(language),
            ],
        }

    async def today_advice(self, user_id: str, language: str = "fr") -> dict[str, Any]:
        context = await self.build_context(user_id, language)
        messages = [
            *(await self._system_messages(user_id, language=language)),
            {
                "role": "user",
                "content": (TODAY_ADVICE_PROMPT if language != "en" else TODAY_ADVICE_PROMPT_EN)
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
            parsed = self._fallback_advice(context, language=language)
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
        language: str = "fr",
    ) -> str:
        context = await self.build_context(user_id, language)
        messages = self._chat_messages(await self._system_messages(user_id, language=language), context, message, history or [], mode, language=language)
        return await self.llm.chat(messages, max_tokens=self.chat_max_tokens, temperature=0.3)

    async def stream_chat(
        self,
        user_id: str,
        message: str,
        history: list[Any] | None = None,
        mode: str = "coach",
        language: str = "fr",
    ) -> AsyncIterator[str]:
        context = await self.build_context(user_id, language)
        messages = self._chat_messages(await self._system_messages(user_id, language=language), context, message, history or [], mode, language=language)
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
            yield self._fallback_chat(context, message, language=language)
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
        language: str = "fr",
    ) -> list[dict[str, str]]:
        mode_instruction = self._mode_instruction(mode, language)
        if mode == "plan":
            mode_instruction = self._mode_instruction(mode, language)
        messages = [
            *system_messages,
            {
                "role": "user",
                "content": ("HealthConnect context JSON:\n" if language == "en" else "Contexte HealthConnect JSON:\n") + json.dumps(context, ensure_ascii=False, default=str),
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

    async def _system_messages(self, user_id: str, language: str = "fr") -> list[dict[str, str]]:
        messages = [{"role": "system", "content": COACH_SYSTEM_PROMPT_EN if language == "en" else COACH_SYSTEM_PROMPT}]
        if self.agent_settings is None:
            return messages
        prompt = await self.agent_settings.prompt_for_user(user_id)
        if prompt.strip():
            messages.append({
                "role": "system",
                "content": ("User profile, goals and coaching style:\n" if language == "en" else "Profil, objectifs et style de coaching utilisateur:\n") + prompt.strip()
            })
        goals_for_user = getattr(self.agent_settings, "goals_for_user", None)
        if goals_for_user is not None:
            goals = await goals_for_user(user_id)
            enabled_goals = [goal for goal in goals if goal.get("enabled")]
            if enabled_goals:
                compact = "\n".join(
                    f"{goal.get('priority')}. {goal.get('label')}"
                    for goal in sorted(enabled_goals, key=lambda item: item.get("priority") or 99)
                )
                messages.append({
                    "role": "system",
                    "content": ("Active coaching goals, by priority:\n" if language == "en" else "Objectifs actifs du coaching, par priorité:\n") + compact
                })
        return messages

    @staticmethod
    def _data_limitations(language: str = "fr") -> list[str]:
        if language == "en":
            return [
                "Scores are heuristic and informational.",
                "Answers do not replace medical advice.",
            ]
        return [
            "Les scores sont heuristiques et indicatifs.",
            "Les réponses ne remplacent pas un avis médical.",
        ]

    @staticmethod
    def _mode_instruction(mode: str, language: str = "fr") -> str:
        if language == "en":
            if mode == "plan":
                return (
                    "Build a careful 7 to 30 day plan with explicit assumptions. "
                    "Mobile format: short paragraphs, subtle subheadings only if useful, mini-lists only for actions, no tables, no HTML. "
                    "Base the plan on the week, month, profile and goals, with a professional and motivating coach tone."
                )
            return (
                "Concise conversational mobile answer: 2 to 4 short paragraphs, no table, no HTML, not a checklist. "
                "A mini-list of 2 or 3 actions is possible only if it makes the advice clearer. "
                "Give an integrated read like a professional coach: 24h + week + profile + goals, then concrete priorities. "
                "If nutrition or hydration are 0/not logged, present it as a data limitation, never as proof that the user does not eat or drink."
            )
        if mode == "plan":
            return (
                "Construis un plan prudent sur 7 à 30 jours avec hypothèses explicites. "
                "Format mobile: paragraphes courts, sous-titres sobres si utiles, mini-listes seulement pour les actions, sans tableau, sans HTML. "
                "Base le plan sur la semaine, le mois, le profil et les objectifs, avec un ton de coach professionnel et motivant."
            )
        return (
            "Réponse concise et conversationnelle pour mobile: 2 à 4 paragraphes courts, sans tableau, sans HTML, pas une checklist. "
            "Une mini-liste de 2 ou 3 actions est possible seulement si elle rend le conseil plus clair. "
            "Fais une lecture intégrée comme un coach professionnel: 24h + semaine + profil + objectifs, puis priorités concrètes. "
            "Si nutrition ou hydratation sont à 0/non renseignées, présente cela comme une limite de données, jamais comme une preuve que l'utilisateur ne mange ou ne boit pas."
        )

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
    def _fallback_advice(context: dict[str, Any], language: str = "fr") -> dict[str, str]:
        if "windows" in context:
            last_24h = context["windows"]["last_24h"]
        else:
            last_24h = ((context.get("coach_summary") or {}).get("windows") or {}).get("last_24h") or {}
        actions = CoachService._context_actions(context)
        if actions:
            primary = actions[0]
            return {
                "title": str(primary.get("label") or ("Coach action" if language == "en" else "Action coach"))[:80],
                "summary": str(primary.get("reason") or (
                    "A useful priority stands out from the recent context, and that is already a solid base to move forward calmly."
                    if language == "en"
                    else "Une priorité utile ressort du contexte récent, et c'est déjà une bonne base pour avancer calmement."
                ))[:240],
                "action": str(primary.get("action") or (
                    "Keep one simple decision, do it well, then observe how you feel. 🙂"
                    if language == "en"
                    else "Garde une décision simple, fais-la bien, puis observe tes sensations. 🙂"
                ))[:240],
            }
        sleep = last_24h.get("sleep") if isinstance(last_24h.get("sleep"), dict) else {}
        workouts_payload = last_24h.get("workouts") if isinstance(last_24h.get("workouts"), dict) else {}
        sleep_minutes = int(sleep.get("average_duration_minutes") or last_24h.get("sleep_minutes") or 0)
        workouts = int(workouts_payload.get("sessions") or last_24h.get("workout_sessions") or 0)
        if sleep_minutes and sleep_minutes < 360:
            return {
                "title": "Sleep priority" if language == "en" else "Priorité sommeil",
                "summary": (
                    "Your last night looks short, so today we protect recovery. That is a smart decision, not a step back."
                    if language == "en"
                    else "Ta dernière nuit semble courte, donc on protège la récupération aujourd'hui. C'est une bonne décision, pas un recul."
                ),
                "action": (
                    "Plan a gentler day, hydrate well, and aim for a steadier bedtime tonight. 🙂"
                    if language == "en"
                    else "Prévois une journée plus douce, hydrate-toi bien, et vise une heure de coucher plus régulière ce soir. 🙂"
                ),
            }
        if workouts:
            return {
                "title": "Active recovery" if language == "en" else "Récupération active",
                "summary": (
                    "You already have recent training: now the goal is to consolidate adaptation calmly."
                    if language == "en"
                    else "Tu as déjà une activité sportive récente: maintenant l'objectif est de consolider l'adaptation, tranquillement."
                ),
                "action": (
                    "Keep movement light and watch how you feel before adding intensity. 👍"
                    if language == "en"
                    else "Garde du mouvement léger et surveille tes sensations avant d'ajouter de l'intensité. 👍"
                ),
            }
        return {
            "title": "Gentle restart" if language == "en" else "Relance douce",
            "summary": (
                "Today’s data does not show a strong signal, so one simple and steady action is enough."
                if language == "en"
                else "Les données du jour ne montrent pas de signal fort, donc une action simple et régulière suffit très bien."
            ),
            "action": (
                "Add a short walk and keep a stable sleep routine tonight. Small step, real consistency. 🙂"
                if language == "en"
                else "Ajoute une marche courte et garde une routine de sommeil stable ce soir. Petit pas, vraie continuité. 🙂"
            ),
        }

    @staticmethod
    def _fallback_chat(context: dict[str, Any], message: str, language: str = "fr") -> str:
        if "windows" not in context and context.get("coach_summary"):
            return CoachService._fallback_chat_from_summary(context, message, language=language)
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
            if language == "en":
                nutrition_block = (
                    "\n\n"
                    f"### Nutrition\n"
                    f"- Validated meals: {int(nutrition.get('meals') or 0)}.\n"
                    f"- Energy: {int(round(float(nutrition.get('energy_kcal') or 0))):,} kcal.\n"
                    f"- Macros: P {int(round(float(nutrition.get('protein_g') or 0)))} g · "
                    f"C {int(round(float(nutrition.get('carbohydrates_g') or 0)))} g · "
                    f"F {int(round(float(nutrition.get('fat_g') or 0)))} g."
                )
            else:
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
            title = "Coach actions" if language == "en" else "Actions coach"
            actions_block = f"\n\n### {title}\n" + "\n".join(f"- {item.get('label')}: {item.get('action')}" for item in actions[:3])
        if language == "en":
            return (
                "The local model is taking too long, so here is a quick read from the calculated data. Let’s keep it simple and useful. 🙂\n\n"
                f"### Sleep\n"
                f"- Last night: {int(sleep.get('average_duration_minutes') or 0)} min.\n"
                f"- Sleep score: {scores.get('sleep', 'unavailable')}.\n\n"
                f"### Movement\n"
                f"- Steps today: {int(activity.get('steps') or 0):,}.\n"
                f"- 7-day average: {int((week.get('activity') or {}).get('average_daily_steps') or 0):,} steps/day.\n\n"
                f"### Training\n"
                f"- Sessions today: {int(workouts.get('sessions') or 0)}.\n"
                f"- Time today: {int(workouts.get('duration_minutes') or 0)} min."
                f"{nutrition_block}\n\n"
                f"{actions_block}\n\n"
                "Simple action: keep one careful, concrete decision today. If you feel tired, prioritize recovery, hydration, natural light and a steadier bedtime. You are already doing the right thing by checking the signals. "
                f"Question received: {message}"
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
    def _fallback_chat_from_summary(context: dict[str, Any], message: str, language: str = "fr") -> str:
        summary = context.get("coach_summary") or {}
        windows = summary.get("windows") or {}
        last_24h = windows.get("last_24h") or {}
        week = windows.get("week") or {}
        reliability = summary.get("source_reliability") or {}
        steps_source = reliability.get("steps") or {}
        steps_reliability_status = steps_source.get("status")
        steps_reliability_needs_note = steps_reliability_status in {"partial", "corrected", "conflict"}
        activity_source = steps_source if steps_reliability_needs_note else (reliability.get("activity") or {})
        selected_source = activity_source.get("selected_source_label") or ("selected source" if language == "en" else "source retenue")
        actions = CoachService._context_actions(context)

        scores = []
        if last_24h.get("sleep_score") is not None:
            scores.append(f"{'sleep' if language == 'en' else 'sommeil'} {last_24h.get('sleep_score')} / 100")
        if last_24h.get("recovery_score") is not None:
            scores.append(f"{'recovery' if language == 'en' else 'récupération'} {last_24h.get('recovery_score')} / 100")
        if last_24h.get("movement_score") is not None:
            scores.append(f"{'movement' if language == 'en' else 'mouvement'} {last_24h.get('movement_score')} / 100")
        score_line = ", ".join(scores) if scores else ("scores not calculated yet" if language == "en" else "scores non calculés pour le moment")

        nutrition_line = "Nutrition not validated in ALIS for this window." if language == "en" else "Nutrition non validée dans ALIS sur cette fenêtre."
        if int(last_24h.get("nutrition_meals") or 0) > 0:
            nutrition_line = (
                f"{int(last_24h.get('nutrition_meals') or 0)} validated meal(s), "
                f"{int(round(float(last_24h.get('nutrition_energy_kcal') or 0))):,} kcal."
            ) if language == "en" else (
                f"{int(last_24h.get('nutrition_meals') or 0)} repas validé(s), "
                f"{int(round(float(last_24h.get('nutrition_energy_kcal') or 0))):,} kcal."
            )

        actions_block = ""
        if actions:
            actions_block = ("\n\nWhat I would do now: " if language == "en" else "\n\nCe que je ferais maintenant: ") + " ".join(
                f"{item.get('label')}: {item.get('action')}" for item in actions[:2]
            )

        reliability_line = ""
        if steps_reliability_needs_note:
            reason = steps_source.get("coach_reason")
            if reason:
                reliability_line = (
                    f" Step source note: {reason} "
                    if language == "en"
                    else f" Note sur la source des pas: {reason} "
                )
            elif language == "en":
                reliability_line = f" Step source note: ALIS keeps {selected_source} because another step source looks partial. "
            else:
                reliability_line = f" Note sur la source des pas: ALIS retient {selected_source} car une autre source semble partielle. "

        if language == "en":
            return (
                "The local model is taking too long, so here is a quick read from the ALIS summary already calculated. 🙂\n\n"
                f"Over the last 24 h, I have {score_line}. "
                f"For movement, ALIS keeps {int(last_24h.get('steps') or 0):,} steps via {selected_source}, "
                f"with {int(last_24h.get('workout_minutes') or 0)} min of sport. "
                f"{reliability_line}"
                f"Over 7 days, the average is {int(week.get('average_daily_steps') or 0):,} steps/day and "
                f"{int(week.get('workout_minutes') or 0)} min of sport.\n\n"
                f"Sleep: {int(last_24h.get('sleep_minutes') or 0)} min. "
                f"Active calories: {int(round(float(last_24h.get('active_calories_kcal') or 0))):,} kcal. "
                f"{nutrition_line}"
                f"{actions_block}\n\n"
                f"Question received: {message}"
            )
        return (
            "Le modèle local met trop longtemps à répondre, donc je te donne une lecture rapide avec le résumé ALIS déjà calculé. 🙂\n\n"
            f"Sur les dernières 24 h, j'ai {score_line}. "
            f"Côté mouvement, ALIS retient {int(last_24h.get('steps') or 0):,} pas via {selected_source}, "
            f"avec {int(last_24h.get('workout_minutes') or 0)} min de sport. "
            f"{reliability_line}"
            f"Sur 7 jours, la moyenne est à {int(week.get('average_daily_steps') or 0):,} pas/j et "
            f"{int(week.get('workout_minutes') or 0)} min de sport.\n\n"
            f"Sommeil: {int(last_24h.get('sleep_minutes') or 0)} min. "
            f"Calories actives: {int(round(float(last_24h.get('active_calories_kcal') or 0))):,} kcal. "
            f"{nutrition_line}"
            f"{actions_block}\n\n"
            f"Question reçue: {message}"
        )

    @staticmethod
    def _context_actions(context: dict[str, Any]) -> list[dict[str, Any]]:
        last_24h = context.get("windows", {}).get("last_24h") or {}
        if not last_24h:
            last_24h = ((context.get("coach_summary") or {}).get("windows") or {}).get("last_24h") or {}
        actions = last_24h.get("coach_actions") or []
        return sorted(actions, key=lambda item: item.get("priority") or 99)[:3]

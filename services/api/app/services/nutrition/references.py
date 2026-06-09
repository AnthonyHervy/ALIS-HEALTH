import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import NutritionFoodReference


def normalize_food_name(value: str | None) -> str:
    if not value:
        return ""
    without_accents = "".join(
        char for char in unicodedata.normalize("NFKD", value) if not unicodedata.combining(char)
    )
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", without_accents.lower())).strip()


def food_name_tokens(value: str | None) -> set[str]:
    stopwords = {"au", "aux", "de", "des", "du", "et", "la", "le", "les", "l", "d", "en"}
    tokens: set[str] = set()
    for token in normalize_food_name(value).split():
        if len(token) <= 1 or token in stopwords:
            continue
        if token.endswith("s") and len(token) > 3:
            token = token[:-1]
        tokens.add(canonical_food_token(token))
    return tokens


def canonical_food_token(token: str) -> str:
    return {
        "farfalle": "pate",
        "fusilli": "pate",
        "linguine": "pate",
        "macaroni": "pate",
        "penne": "pate",
        "rigatoni": "pate",
        "spaghetti": "pate",
        "tagliatelle": "pate",
        "tortiglioni": "pate",
        "bouillie": "bouilli",
        "bouillies": "bouilli",
        "bouillis": "bouilli",
        "crue": "cru",
        "crues": "cru",
        "crus": "cru",
        "cuite": "cuit",
        "cuites": "cuit",
        "cuits": "cuit",
        "grillee": "grille",
        "grillees": "grille",
        "grilles": "grille",
        "poelee": "poele",
        "poelees": "poele",
        "poeles": "poele",
        "preemballee": "preemballe",
        "preemballees": "preemballe",
        "preemballes": "preemballe",
        "rotie": "roti",
        "roties": "roti",
        "rotis": "roti",
        "sautee": "saute",
        "sautees": "saute",
        "sautes": "saute",
    }.get(token, token)


RAW_TOKENS = {"cru"}
COOKED_TOKENS = {
    "bouilli",
    "cuit",
    "four",
    "grille",
    "poele",
    "roti",
    "saute",
    "vapeur",
}
PREP_TOKENS = RAW_TOKENS | COOKED_TOKENS
PROCESSED_TOKENS = {
    "assaisonne",
    "burger",
    "crepe",
    "croquette",
    "galette",
    "marine",
    "nugget",
    "panee",
    "preemballe",
    "sauce",
    "surgele",
}
REGIONAL_TOKENS = {"guadeloupe", "martinique", "preleve", "reunion"}
ROAST_COMPATIBLE_TOKENS = {"four", "grille", "poele", "roti", "saute"}
SPECIFIC_CUT_TOKENS = {"aile", "cuisse", "filet", "manchon", "poitrine"}


def food_name_score(wanted: str, candidate: str) -> float:
    if not wanted or not candidate:
        return 0.0
    direct_match = wanted in candidate or candidate in wanted
    wanted_tokens = food_name_tokens(wanted)
    candidate_tokens = food_name_tokens(candidate)
    if not wanted_tokens or not candidate_tokens:
        return 0.0
    overlap = wanted_tokens & candidate_tokens
    if not overlap:
        return 0.0
    coverage = len(overlap) / len(wanted_tokens)
    noise_penalty = max(len(candidate_tokens) - len(wanted_tokens), 0) * 0.015
    score = coverage - noise_penalty
    if direct_match:
        score += 0.1
    wanted_food_tokens = wanted_tokens - PREP_TOKENS
    candidate_is_cooked = bool(candidate_tokens & COOKED_TOKENS)
    candidate_is_raw = bool(candidate_tokens & RAW_TOKENS)
    if wanted_food_tokens and wanted_food_tokens <= candidate_tokens:
        if candidate_is_cooked:
            score += 0.08
        if "aliment" in candidate_tokens and "moyen" in candidate_tokens:
            score += 0.04
        if candidate_is_raw and not wanted_tokens & RAW_TOKENS:
            score -= 0.12
        if wanted_tokens & COOKED_TOKENS and candidate_is_cooked:
            score = max(score, 0.74)
        if wanted_tokens & {"roti"} and candidate_tokens & ROAST_COMPATIBLE_TOKENS:
            score += 0.04
        if any(candidate.startswith(token) for token in wanted_food_tokens):
            score += 0.05
    if "sans" in candidate_tokens and wanted_food_tokens & candidate_tokens:
        score -= 0.35
    score -= len(candidate_tokens & PROCESSED_TOKENS) * 0.08
    score -= len(candidate_tokens & REGIONAL_TOKENS) * 0.04
    score -= len((candidate_tokens - wanted_tokens) & SPECIFIC_CUT_TOKENS) * 0.04
    return max(0.0, score)


@dataclass(frozen=True)
class Nutrients:
    energy_kcal: float
    protein_g: float
    carbohydrates_g: float
    fat_g: float


def nutrients_for_portion(reference: NutritionFoodReference, portion_g: float) -> Nutrients:
    factor = max(portion_g, 0) / 100
    return Nutrients(
        energy_kcal=float(reference.energy_kcal_100g) * factor,
        protein_g=float(reference.protein_g_100g) * factor,
        carbohydrates_g=float(reference.carbohydrates_g_100g) * factor,
        fat_g=float(reference.fat_g_100g) * factor,
    )


class NutritionReferenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def match_item(self, item: dict) -> NutritionFoodReference | None:
        barcode = str(item.get("barcode") or "").strip()
        if barcode:
            barcode_match = await self.db.scalar(
                select(NutritionFoodReference)
                .where(
                    NutritionFoodReference.source == "openfoodfacts",
                    NutritionFoodReference.barcode == barcode,
                )
                .limit(1)
            )
            if barcode_match is not None:
                return barcode_match

        wanted = normalize_food_name(str(item.get("name") or item.get("detected_name") or ""))
        if not wanted:
            return None

        result = await self.db.execute(
            select(NutritionFoodReference).where(NutritionFoodReference.source == "ciqual")
        )
        references = list(result.scalars())
        best_reference: NutritionFoodReference | None = None
        best_score = 0.0
        for reference in references:
            candidate = normalize_food_name(reference.name)
            score = food_name_score(wanted, candidate)
            if score > best_score:
                best_reference = reference
                best_score = score
        return best_reference if best_score >= 0.72 else None

    async def search(self, query: str, limit: int = 20) -> list[NutritionFoodReference]:
        cleaned_query = query.strip()
        normalized_query = normalize_food_name(cleaned_query)
        if len(normalized_query) < 2:
            return []
        limit = max(1, min(limit, 50))
        like = f"%{cleaned_query}%"
        tokens = food_name_tokens(cleaned_query)
        token_filters = [NutritionFoodReference.name.ilike(f"%{token}%") for token in sorted(tokens)[:3]]
        result = await self.db.execute(
            select(NutritionFoodReference)
            .where(
                or_(
                    NutritionFoodReference.source == "ciqual",
                    NutritionFoodReference.name.ilike(like),
                    NutritionFoodReference.barcode == cleaned_query,
                    *token_filters,
                )
            )
            .limit(10000)
        )
        scored: list[tuple[float, NutritionFoodReference]] = []
        for reference in result.scalars():
            score = food_name_score(normalized_query, normalize_food_name(reference.name))
            if normalize_food_name(reference.name).find(normalized_query) >= 0:
                score += 0.2
            if reference.barcode == cleaned_query:
                score = 2.0
            if score >= 0.2:
                scored.append((score, reference))
        scored.sort(key=lambda match: (-match[0], match[1].source, match[1].name))
        return [reference for _score, reference in scored[:limit]]

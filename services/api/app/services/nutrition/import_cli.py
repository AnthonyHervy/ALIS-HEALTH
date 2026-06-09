import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal
from app.services.nutrition.importer import NutritionDatasetImporter


async def import_datasets(
    db: AsyncSession,
    *,
    ciqual_path: Path | None = None,
    ciqual_version: str | None = None,
    off_path: Path | None = None,
    off_version: str | None = None,
    off_country: str | None = None,
    off_limit: int | None = None,
) -> dict[str, int]:
    importer = NutritionDatasetImporter(db)
    counts: dict[str, int] = {}
    if ciqual_path is not None:
        if not ciqual_version:
            raise ValueError("ciqual_version is required when ciqual_path is provided")
        counts["ciqual"] = await importer.import_ciqual_file(ciqual_path, ciqual_version)
    if off_path is not None:
        if not off_version:
            raise ValueError("off_version is required when off_path is provided")
        counts["openfoodfacts"] = await importer.import_open_food_facts_csv(
            off_path,
            off_version,
            country_tag=off_country,
            limit=off_limit,
        )
    return counts


async def run_from_args(args: argparse.Namespace) -> dict[str, int]:
    async with SessionLocal() as db:
        counts = await import_datasets(
            db,
            ciqual_path=args.ciqual,
            ciqual_version=args.ciqual_version,
            off_path=args.open_food_facts,
            off_version=args.open_food_facts_version,
            off_country=args.open_food_facts_country,
            off_limit=args.open_food_facts_limit,
        )
        await db.commit()
        return counts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import local nutrition dataset snapshots into ALIS.")
    parser.add_argument("--ciqual", type=Path, help="Path to a CIQUAL CSV export.")
    parser.add_argument("--ciqual-version", help="Version label for the CIQUAL import, for example ciqual-2025.")
    parser.add_argument("--open-food-facts", type=Path, help="Path to an Open Food Facts CSV or CSV.GZ export.")
    parser.add_argument("--open-food-facts-version", help="Version label for the Open Food Facts import.")
    parser.add_argument("--open-food-facts-country", help="Optional country tag filter, for example en:france.")
    parser.add_argument("--open-food-facts-limit", type=int, help="Optional maximum number of Open Food Facts rows to import.")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.ciqual is None and args.open_food_facts is None:
        parser.error("provide at least one dataset path")
    counts = asyncio.run(run_from_args(args))
    print(json.dumps(counts, sort_keys=True))

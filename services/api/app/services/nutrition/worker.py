import argparse
import asyncio
import contextlib

from app.core.database import SessionLocal
from app.services.nutrition.analysis import NutritionAnalysisService


async def run_once() -> bool:
    async with SessionLocal() as db:
        meal = await NutritionAnalysisService(db).run_next(raise_on_error=False)
        return meal is not None


async def run_loop(interval_seconds: float) -> None:
    while True:
        with contextlib.suppress(Exception):
            processed = await run_once()
            if processed:
                continue
        await asyncio.sleep(interval_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run pending ALIS nutrition analysis jobs.")
    parser.add_argument("--once", action="store_true", help="Process at most one pending job and exit.")
    parser.add_argument("--interval", type=float, default=5.0, help="Polling interval in seconds for loop mode.")
    args = parser.parse_args()
    if args.once:
        asyncio.run(run_once())
    else:
        asyncio.run(run_loop(args.interval))


if __name__ == "__main__":
    main()

import os
import time

import httpx


def worker_endpoint(api_base_url: str) -> str:
    return f"{api_base_url.rstrip('/')}/api/v1/processing/run-next"


def should_continue_polling(*, loop: bool, processed: bool) -> bool:
    return loop or processed


def run_once(api_base_url: str, device_token: str) -> dict:
    response = httpx.post(
        worker_endpoint(api_base_url),
        headers={"Authorization": f"Bearer {device_token}"},
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def register_processor(api_base_url: str, pairing_code: str) -> str:
    response = httpx.post(
        f"{api_base_url.rstrip('/')}/api/v1/auth/register",
        json={"pairing_code": pairing_code, "device_name": "HealthConnect Processor"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["device_token"]


def main() -> None:
    api_base_url = os.environ.get("API_BASE_URL", "http://api:8000").rstrip("/")
    device_token = os.environ.get("DEVICE_TOKEN")
    pairing_code = os.environ.get("PAIRING_CODE")
    poll_seconds = int(os.environ.get("PROCESSOR_POLL_SECONDS", "15"))
    loop = os.environ.get("PROCESSOR_LOOP", "true").lower() not in {"0", "false", "no"}
    if not device_token:
        if not pairing_code:
            raise SystemExit("DEVICE_TOKEN or PAIRING_CODE is required for processor jobs")
        device_token = register_processor(api_base_url, pairing_code)

    while True:
        payload = run_once(api_base_url, device_token)
        print(payload, flush=True)
        processed = payload.get("status") == "processed"
        if not should_continue_polling(loop=loop, processed=processed):
            break
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()

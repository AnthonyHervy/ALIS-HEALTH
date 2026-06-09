#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1" >&2
    exit 1
  fi
}

random_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    python3 - "$bytes" <<'PY'
import secrets
import sys
print(secrets.token_hex(int(sys.argv[1])))
PY
  fi
}

host_ip_hint() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  elif command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

need_command docker
docker compose version >/dev/null

if [ ! -f .env ]; then
  postgres_password="$(random_hex 24)"
  secret_key="$(random_hex 32)"
  pairing_code="$(random_hex 6)"
  api_port="${API_PORT:-8010}"
  portal_port="${PORTAL_PORT:-5174}"
  postgres_port="${POSTGRES_PORT:-5433}"
  cat > .env <<EOF
POSTGRES_USER=alis
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=alis

SECRET_KEY=${secret_key}
PAIRING_CODE=${pairing_code}

API_PORT=${api_port}
PORTAL_PORT=${portal_port}
POSTGRES_PORT=${postgres_port}

DEBUG=false
CORS_ALLOWED_ORIGINS='["http://localhost:5174","http://127.0.0.1:5174"]'

HEALTH_LLM_PROVIDER=ollama
HEALTH_LLM_BASE_URL=http://host.docker.internal:11434
HEALTH_LLM_MODEL=gpt-oss:20b
HEALTH_LLM_THINK=medium
HEALTH_LLM_ADVICE_MAX_TOKENS=180
HEALTH_LLM_CHAT_MAX_TOKENS=1200
HEALTH_LLM_CONTEXT_TOKENS=8192
HEALTH_LLM_ADVICE_TIMEOUT_SECONDS=12
HEALTH_LLM_STREAM_FIRST_TOKEN_TIMEOUT_SECONDS=90
HEALTH_LLM_TIMEOUT_SECONDS=180
HEALTH_LLM_KEEP_ALIVE=4h

NUTRITION_LLM_BASE_URL=http://host.docker.internal:11434
NUTRITION_VISION_MODEL=qwen3-vl:30b
NUTRITION_LLM_TIMEOUT_SECONDS=240
NUTRITION_PHOTO_STORAGE_DIR=/app/storage/nutrition/photos
NUTRITION_PHOTO_RETENTION=thumbnail_only
NUTRITION_MAX_PHOTOS_PER_MEAL=8
NUTRITION_MAX_PHOTO_BYTES=10485760
NUTRITION_ALLOWED_PHOTO_CONTENT_TYPES='["image/jpeg","image/png","image/webp"]'
NUTRITION_JOB_STALE_AFTER_SECONDS=1800
NUTRITION_WORKER_INTERVAL_SECONDS=5

PROCESSOR_LOOP=true
PROCESSOR_POLL_SECONDS=15
PROCESSOR_DEVICE_TOKEN=
EOF
  chmod 600 .env
  echo "Created .env with fresh local secrets."
else
  echo "Using existing .env."
fi

set -a
. ./.env
set +a

docker compose build
docker compose up -d db
docker compose run --rm api alembic upgrade head
docker compose up -d

api_url="http://localhost:${API_PORT:-8010}"
portal_url="http://localhost:${PORTAL_PORT:-5174}"
phone_host="$(host_ip_hint)"

echo
echo "ALIS is running."
echo "API:    ${api_url}"
echo "Portal: ${portal_url}"
echo "Pairing code: ${PAIRING_CODE}"
if [ -n "$phone_host" ]; then
  echo "Android device API URL example: http://${phone_host}:${API_PORT:-8010}"
else
  echo "Android device API URL: use the LAN or Tailscale address of this machine on port ${API_PORT:-8010}."
fi
echo
echo "Ollama is expected outside Docker at ${HEALTH_LLM_BASE_URL:-http://host.docker.internal:11434}."

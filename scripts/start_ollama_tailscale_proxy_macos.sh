#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

path_prefixes=()
for candidate in \
  "$HOME/.local/bin" \
  "$HOME/.hermes/node/bin" \
  /usr/local/bin \
  /opt/homebrew/bin \
  /usr/bin \
  /bin \
  /usr/sbin \
  /sbin; do
  if [[ -d "$candidate" ]]; then
    path_prefixes+=("$candidate")
  fi
done

PATH="$(IFS=:; echo "${path_prefixes[*]}")${PATH:+:$PATH}"
export PATH

TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale)}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
DOMAIN="${ALIS_TAILSCALE_DOMAIN:-alis-api.tailbcea46.ts.net}"
TARGET_ORIGIN="${ALIS_PROXY_TARGET_ORIGIN:-http://127.0.0.1:11434}"
PROXY_PORT="${ALIS_PROXY_PORT:-9443}"
RUNTIME_DIR="${ALIS_PROXY_RUNTIME_DIR:-$HOME/Library/Application Support/ALIS/ollama-tailscale-proxy}"

if [[ -z "$TAILSCALE_BIN" || -z "$NODE_BIN" ]]; then
  echo "[alis-ollama-proxy] tailscale or node not found in PATH" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"

BIND_HOST="${ALIS_PROXY_BIND_HOST:-$("$TAILSCALE_BIN" ip -4 | head -n 1)}"
if [[ ! "$BIND_HOST" =~ ^100\. ]]; then
  echo "[alis-ollama-proxy] refusing to bind outside the Tailscale CGNAT range: $BIND_HOST" >&2
  exit 1
fi

TLS_CERT="$RUNTIME_DIR/${DOMAIN}.crt"
TLS_KEY="$RUNTIME_DIR/${DOMAIN}.key"

"$TAILSCALE_BIN" cert \
  --cert-file "$TLS_CERT" \
  --key-file "$TLS_KEY" \
  --min-validity 24h \
  "$DOMAIN"

export ALIS_PROXY_BIND_HOST="$BIND_HOST"
export ALIS_PROXY_PORT="$PROXY_PORT"
export ALIS_PROXY_TLS_CERT="$TLS_CERT"
export ALIS_PROXY_TLS_KEY="$TLS_KEY"
export ALIS_PROXY_TARGET_ORIGIN="$TARGET_ORIGIN"

exec "$NODE_BIN" "$PROJECT_ROOT/scripts/ollama_tailscale_proxy.mjs"

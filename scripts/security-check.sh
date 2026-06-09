#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0

report_failure() {
  failures=$((failures + 1))
  echo "SECURITY CHECK FAILED: $1" >&2
}

forbidden_paths="$(
  find . \
    -path './.git' -prune -o \
    -path './node_modules' -prune -o \
    -path './apps/*/node_modules' -prune -o \
    -path './services/*/.venv' -prune -o \
    \( \
      -name '.env' -o \
      -name '.env.local' -o \
      -name '*.pem' -o \
      -name '*.key' -o \
      -name '*.keystore' -o \
      -name '*.jks' -o \
      -name '*.p12' -o \
      -name '*.apk' -o \
      -name '*.aab' -o \
      -name '*.ipa' -o \
      -name '*.pyc' -o \
      -name '*.mobileprovision' -o \
      -name 'google-services.json' -o \
      -name 'GoogleService-Info.plist' \
    \) -print
)"

if [ -n "$forbidden_paths" ]; then
  echo "$forbidden_paths" >&2
  report_failure "forbidden secret/build artifacts are present"
fi

forbidden_dirs="$(
  find . \
    -path './.git' -prune -o \
    \( \
      -type d -name node_modules -o \
      -type d -name __pycache__ -o \
      -type d -name .venv -o \
      -type d -name .gradle -o \
      -type d -name .cxx -o \
      -type d -name .expo -o \
      -type d -name .superpowers -o \
      -type d -name build -o \
      -type d -name dist -o \
      -type d -name tmp \
    \) -print
)"

if [ -n "$forbidden_dirs" ]; then
  echo "$forbidden_dirs" >&2
  report_failure "forbidden generated/cache directories are present"
fi

secret_hits="$(
  grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=.venv \
    --exclude-dir=.gradle \
    --exclude-dir=.expo \
    --exclude='package-lock.json' \
    --exclude='uv.lock' \
    --exclude='security-check.sh' \
    '100\.71\.231\.104|/Users/anthony|/Users/anthonyhervy|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|ghp_[A-Za-z0-9]{20,}' \
    . || true
)"

if [ -n "$secret_hits" ]; then
  echo "$secret_hits" >&2
  report_failure "sensitive strings were found"
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi

echo "Security check passed."

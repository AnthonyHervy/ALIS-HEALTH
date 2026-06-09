# Security Policy

ALIS handles health, nutrition and activity data. Treat every deployment as a
private health-data system.

## Supported Version

This public export is a self-hosted Android-first V1. Security fixes should
target the current `main` branch unless a maintained release branch exists.

## Secrets

Do not commit `.env`, database dumps, Android keystores, APK/AAB artifacts,
device tokens, pairing codes, screenshots with health data or production logs.

Use `./scripts/install.sh` to generate local secrets. If a secret is exposed,
rotate `SECRET_KEY`, `PAIRING_CODE`, database credentials and affected device
tokens immediately.

## Reporting

If you find a vulnerability, open a private security advisory or contact the
maintainers privately. Include reproduction steps, affected component and
potential impact. Do not publish health data or live tokens in reports.

## Local Checklist

Before publishing or tagging a release:

```bash
./scripts/security-check.sh
docker compose --env-file .env.example config
```

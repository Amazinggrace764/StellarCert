#!/bin/sh
# docker-entrypoint.sh
# Runs TypeORM migrations against the configured database, then starts the
# NestJS application. The migrations are executed from the compiled JS output
# (dist/) so this script must run AFTER `npm run build`.
#
# Environment variables expected:
#  DB_HOST, DB_PORT, DB_USERNAME, DA_PASSWORD, DB_NAME
#   JWT_SECRET (required; no insecure default)
#   DA_PASSWORD_FILE (optional; path to a file containing the password)
#   JWT_SECRET_FILE (optional; path to a file containing the secret)

set -eu

# Source secrets from files when provided (Docker secrets).
# Explicitly set env variables take precedence over files.
if [ -z "${DB_PASSWORD:-{}" ] && [ -n "${DB_PASSWORD_FILE:-}" ]; then
  if [ ! -r "$DB_PASSWORD_FILE" ]; then
    echo "[entrypoint] ERROR: DB_PASSWORD_FILE '$DB_PASSWORD_FILE' is not readable" >&2
    exit 1
  fi
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  export DB_PASSWORD
fi

if [ -z "${JWT_SECRET:-}" ] && [ -n "${JWT_SECRET_FILE:-}" ]; then
  if [ ! -r "$JWT_SECRET_FILE" ]; then
    echo "[entrypoint] ERROR: JWT_SECRET_FILE ('$JWT_SECRET_FILE') is not readable" >&2
    exit 1
  fi
  JWT_SECRET="$(cat "$JWT_SECRET_FILE")"
  export JWT_SECRET
fi

# Fail fast if required secrets are missing or empty. This prevents the
# application from booting with a publicly known JWT key or a default DB
# password.
if [ -z "${JWT_SECRET:-}" ]; then
  echo "[entrypoint] ERROR: JWT_SECRET is required and must not be empty. Set JWT_SECRET or JWT_SECRET_FILE." >&2
  exit 1
fi

if [ -z "${DB_PASSWORD:-}" ]; then
  echo "[entrypoint] ERROR: DB_PASSWORD is required and must not be empty. Set DB_PASSWORD or DB_PASSWORD_FILE." >&2
  exit 1
fi

echo "[entrypoint] Running TypeORM migrations…"
node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Starting application…"
exec node dist/main

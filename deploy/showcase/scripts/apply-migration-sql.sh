#!/usr/bin/env bash
# Applies ../migrations/idempotent.sql to the showcase PostgreSQL container (compose service
# "postgres"). Idempotent: running it twice changes nothing the second time. Reads the database
# name and role from .env; the password never appears on a command line.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
set -a; . ./.env; set +a
docker compose --env-file .env exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$SHOWCASE_DB_USER" -d "$SHOWCASE_DB" -q < migrations/idempotent.sql
echo "migrations applied to $SHOWCASE_DB"

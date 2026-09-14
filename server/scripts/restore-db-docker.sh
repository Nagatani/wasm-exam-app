#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into the docker-compose-managed
# dev/self-hosted PostgreSQL (docker-compose.yml's `db` service, repo root)
# via `docker compose exec`, so pg_restore always matches the server's exact
# version (see backup-db-docker.sh for why that matters).
#
# DESTRUCTIVE: --clean drops every existing object in the target schema
# before recreating it from the backup. Never point this at a database
# holding data you want to keep alongside the restored snapshot.
#
# Usage (from the repo root, with `docker compose up -d db` already running):
#   server/scripts/restore-db-docker.sh <backup-file.dump>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POSTGRES_USER="${POSTGRES_USER:-wasm_exam}"
POSTGRES_DB="${POSTGRES_DB:-wasm_exam}"

cd "$REPO_ROOT"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.dump>" >&2
  exit 1
fi

if ! docker compose ps db >/dev/null 2>&1; then
  echo "docker compose couldn't find a running 'db' service." >&2
  echo "Run this from the repo root with the dev DB up: docker compose up -d db" >&2
  exit 1
fi

echo "This will DROP and recreate every object in the '$POSTGRES_DB' database"
echo "inside the docker-compose 'db' service, from: $BACKUP_FILE"
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

docker compose exec -T db pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" <"$BACKUP_FILE"
echo "Restore complete."
echo "Run 'npm --prefix server run prisma:deploy' next to confirm the schema matches the current migrations."

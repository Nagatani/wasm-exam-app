#!/usr/bin/env bash
# Restore a pg_dump custom-format backup (from backup-db.sh) into the
# database at DATABASE_URL.
#
# DESTRUCTIVE: --clean drops every existing object in the target schema
# before recreating it from the backup. Never point this at a database
# holding data you want to keep alongside the restored snapshot — restore
# into a fresh/empty database (or one you're deliberately rolling back).
#
# Usage: server/scripts/restore-db.sh <backup-file.dump>
#
# Requires DATABASE_URL in the environment, or in server/.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (checked the environment and server/.env)." >&2
  exit 1
fi

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.dump>" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore was not found on PATH. Install the PostgreSQL client tools" >&2
  echo "(matching the server's major version) and try again." >&2
  exit 1
fi

echo "This will DROP and recreate every object in the database at:"
echo "  $DATABASE_URL"
echo "from: $BACKUP_FILE"
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$BACKUP_FILE"
echo "Restore complete."
echo "Run 'npm --prefix server run prisma:deploy' next to confirm the schema matches the current migrations."

#!/usr/bin/env bash
# Snapshot the PostgreSQL database at DATABASE_URL to a timestamped
# pg_dump custom-format file, then prune backups older than
# BACKUP_RETENTION_DAYS (default 30; set 0 to disable pruning).
#
# For a self-managed PostgreSQL instance (local dev, or a self-hosted
# production DB) — NOT needed when the deployment uses a managed PostgreSQL
# provider with its own backup/PITR feature (see docs/operations.md
# "バックアップ・リストア", which also covers scheduling this via cron/launchd).
#
# Usage: server/scripts/backup-db.sh [backup-dir]
#   backup-dir defaults to server/backups/ (gitignored — dumps contain
#   personal data: student IDs, names, scores, initial passwords).
#
# Requires DATABASE_URL in the environment, or in server/.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${1:-$SCRIPT_DIR/../backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

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

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump was not found on PATH. Install the PostgreSQL client tools" >&2
  echo "(matching the server's major version) and try again." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/wasm-exam-${TIMESTAMP}.dump"

echo "Backing up to $OUT_FILE ..."
if ! pg_dump --format=custom --file="$OUT_FILE" "$DATABASE_URL"; then
  # pg_dump creates the output file before it can fail (e.g. a client/server
  # version mismatch aborts after opening it) — don't leave a 0-byte file
  # that looks like a successful backup sitting in the backup dir.
  rm -f "$OUT_FILE"
  exit 1
fi
echo "Done ($(du -h "$OUT_FILE" | cut -f1))."

if [ "$RETENTION_DAYS" -gt 0 ]; then
  DELETED="$(find "$BACKUP_DIR" -name 'wasm-exam-*.dump' -mtime "+$RETENTION_DAYS" -print)"
  if [ -n "$DELETED" ]; then
    echo "Pruning backups older than ${RETENTION_DAYS}d:"
    echo "$DELETED"
    find "$BACKUP_DIR" -name 'wasm-exam-*.dump' -mtime "+$RETENTION_DAYS" -delete
  fi
fi

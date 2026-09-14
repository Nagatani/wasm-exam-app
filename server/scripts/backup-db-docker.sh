#!/usr/bin/env bash
# Snapshot the docker-compose-managed dev/self-hosted PostgreSQL
# (docker-compose.yml's `db` service, repo root) via `docker compose exec`,
# so pg_dump always matches the server's exact version.
#
# This sidesteps a host-vs-container PostgreSQL client version mismatch —
# hit firsthand while adding this script: docker-compose.yml pins
# `postgres:16`, but a Homebrew-installed pg_dump 14 on the host could
# neither write a dump compatible with a 16 server nor read one back
# ("server version mismatch" / "unsupported version in file header"). Running
# pg_dump *inside* the same container as the server avoids the whole
# question. For an external/managed production PostgreSQL instead, use
# backup-db.sh with matching client tools (see docs/operations.md
# "バックアップ・リストア").
#
# Usage (from the repo root, where docker-compose.yml lives, with
# `docker compose up -d db` already running):
#   server/scripts/backup-db-docker.sh [backup-dir]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${1:-$REPO_ROOT/server/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
POSTGRES_USER="${POSTGRES_USER:-wasm_exam}"
POSTGRES_DB="${POSTGRES_DB:-wasm_exam}"

cd "$REPO_ROOT"

if ! docker compose ps db >/dev/null 2>&1; then
  echo "docker compose couldn't find a running 'db' service." >&2
  echo "Run this from the repo root with the dev DB up: docker compose up -d db" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/wasm-exam-${TIMESTAMP}.dump"

echo "Backing up (via docker compose exec) to $OUT_FILE ..."
if ! docker compose exec -T db pg_dump -U "$POSTGRES_USER" -F c -d "$POSTGRES_DB" >"$OUT_FILE"; then
  # The shell redirect creates $OUT_FILE before the command can fail — don't
  # leave a 0-byte file that looks like a successful backup.
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

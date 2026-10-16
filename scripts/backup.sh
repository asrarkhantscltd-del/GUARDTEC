#!/usr/bin/env bash
# GuardTec nightly backup — run on the VPS (cron, see scripts/BACKUP-README.md).
#
# Backs up the two things that cannot be rebuilt from git:
#   1. the Postgres database (pg_dump, gzip)
#   2. the document files in HOST_DATA_PATH (staff/site/vehicle docs, recycle bin…)
# plus the .env (secrets) so a full restore on a new server is possible.
#
# Output: $BACKUP_DIR/guardtec-YYYY-MM-DD_HHMM-{db.sql.gz,files.tar.gz,env}
# Backups older than $KEEP_DAYS are deleted. Files are mode 600 (they hold
# personal data: BS7858 vetting records, DBS, right-to-work documents).

set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/guardtec}"
BACKUP_DIR="${BACKUP_DIR:-/opt/guardtec-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

cd "$APP_DIR"

# HOST_DATA_PATH lives in .env (same var docker-compose.yml uses)
DATA_PATH="$(grep -E '^HOST_DATA_PATH=' .env | head -1 | cut -d= -f2- | tr -d '"'"'")"
if [ -z "$DATA_PATH" ] || [ ! -d "$DATA_PATH" ]; then
  echo "[backup] ERROR: HOST_DATA_PATH missing or not a directory ($DATA_PATH)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
PREFIX="$BACKUP_DIR/guardtec-$STAMP"

echo "[backup] $(date -Is) starting -> $PREFIX"

# 1. Database. Write to a .part file first so a half-written dump is never
#    mistaken for a good one; rename only after gzip -t verifies it.
docker compose exec -T db pg_dump -U guardtec guardtec | gzip > "$PREFIX-db.sql.gz.part"
gzip -t "$PREFIX-db.sql.gz.part"
mv "$PREFIX-db.sql.gz.part" "$PREFIX-db.sql.gz"

# 2. Document files
tar -czf "$PREFIX-files.tar.gz.part" -C "$(dirname "$DATA_PATH")" "$(basename "$DATA_PATH")"
gzip -t "$PREFIX-files.tar.gz.part"
mv "$PREFIX-files.tar.gz.part" "$PREFIX-files.tar.gz"

# 3. Secrets
cp .env "$PREFIX-env"

# 4. Retention
find "$BACKUP_DIR" -maxdepth 1 -name 'guardtec-*' -type f -mtime +"$KEEP_DAYS" -print -delete

echo "[backup] done: $(du -sh "$PREFIX"-* | tr '\n' ' ')"

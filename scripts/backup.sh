#!/bin/sh
# EduVerse 3D — nightly backup of the local JSON store.
#
# Copies the live store to backups/eduverse-store-YYYY-MM-DD-HHMMSS.json,
# verifies the copy parses as JSON, and keeps the newest 30 backups.
# Safe while the server runs: the server writes the store atomically
# (temp file + rename), so cp always reads a complete file.
#
# Cron example (every night at 02:00, using the absolute path):
#   0 2 * * * /abs/path/to/eduverse-3d/scripts/backup.sh
#
# Restore: stop the server, copy a backup over backend/data/store.json,
# start the server again — or use the admin backup-restore endpoint
# (POST /api/admin/backup/restore). Test restores on a staging copy first.
#
# Env: EDUVERSE_STORE_PATH overrides the store location (same as the server).
# Exit status: 0 on success, non-zero if the backup is missing or invalid.
set -eu
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STORE_PATH="${EDUVERSE_STORE_PATH:-$PROJECT_ROOT/backend/data/store.json}"
BACKUP_DIR="$PROJECT_ROOT/backups"
KEEP=30

if [ ! -f "$STORE_PATH" ]; then
  echo "Backup FAILED: store file not found: $STORE_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d-%H%M%S)"
DEST="$BACKUP_DIR/eduverse-store-$STAMP.json"
if [ -e "$DEST" ]; then
  DEST="$BACKUP_DIR/eduverse-store-$STAMP-$$.json"
fi

cp "$STORE_PATH" "$DEST"

# Verify the copy parses as JSON before keeping it.
if node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$DEST" >/dev/null 2>&1; then
  echo "Backup OK: $DEST"
else
  echo "Backup FAILED: $DEST is not valid JSON — removing it." >&2
  rm -f "$DEST"
  exit 1
fi

# Keep the newest $KEEP backups, delete older ones.
# (ls -t lists newest first; tail -n +31 skips the 30 newest.)
ls -1t "$BACKUP_DIR"/eduverse-store-*.json 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
  rm -f "$old"
  echo "Pruned old backup: $old"
done

COUNT="$(ls -1 "$BACKUP_DIR"/eduverse-store-*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "Backups kept: $COUNT (newest $KEEP)"

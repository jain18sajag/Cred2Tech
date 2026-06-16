#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore the cred2tech-backend PostgreSQL database from a backup.
#
# Pulls an encrypted backup (from S3 by default, or a local file), decrypts it,
# and restores into DATABASE_URL.
#
# Usage:
#   List available S3 backups:
#     ./scripts/db-restore.sh --list
#   Restore the most recent daily backup from S3:
#     ./scripts/db-restore.sh --latest --yes
#   Restore a specific S3 object:
#     ./scripts/db-restore.sh --s3 postgres-cred2tech-backend/daily/cred2tech-backend_20260616_020000.sql.gz.enc --yes
#   Restore from a local .enc file:
#     ./scripts/db-restore.sh --file /var/backups/cred2tech/cred2tech-backend/cred2tech-backend_xxx.sql.gz.enc --yes
#
# Restores into DATABASE_URL from the env file UNLESS you pass --target <url>.
# Refuses to run without --yes to avoid clobbering a live DB by accident.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/cred2tech/cred2tech-backend.env}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

export $(grep -E '^DATABASE_URL=|^BACKUP_ENCRYPTION_KEY=|^S3_BACKUP_BUCKET=|^AWS_REGION=|^AWS_DEFAULT_REGION=|^AWS_ACCESS_KEY_ID=|^AWS_SECRET_ACCESS_KEY=|^AWS_SESSION_TOKEN=' "$ENV_FILE" | xargs)
if [ -n "${AWS_REGION:-}" ] && [ -z "${AWS_DEFAULT_REGION:-}" ]; then
  export AWS_DEFAULT_REGION="$AWS_REGION"
fi

MODE=""; ARG=""; TARGET_URL="${DATABASE_URL:-}"; CONFIRM="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --list)   MODE="list" ;;
    --latest) MODE="latest" ;;
    --s3)     MODE="s3";   ARG="$2"; shift ;;
    --file)   MODE="file"; ARG="$2"; shift ;;
    --target) TARGET_URL="$2"; shift ;;
    --yes)    CONFIRM="yes" ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

S3_BASE="s3://${S3_BACKUP_BUCKET:-}/postgres-cred2tech-backend"

if [ "$MODE" = "list" ]; then
  echo "Available cred2tech-backend backups in ${S3_BASE}:"
  aws s3 ls "${S3_BASE}/daily/"   --recursive --human-readable | sort
  aws s3 ls "${S3_BASE}/monthly/" --recursive --human-readable | sort
  exit 0
fi

# ── Resolve the source object → local encrypted file ──────────────────────────
ENC_FILE="$WORK_DIR/restore.sql.gz.enc"
case "$MODE" in
  latest)
    KEY=$(aws s3 ls "${S3_BASE}/daily/" | sort | tail -1 | awk '{print $4}')
    [ -n "$KEY" ] || { echo "ERROR: no daily backups found in ${S3_BASE}/daily/"; exit 1; }
    echo "Latest backup: postgres-cred2tech-backend/daily/$KEY"
    aws s3 cp "${S3_BASE}/daily/${KEY}" "$ENC_FILE" --only-show-errors ;;
  s3)
    aws s3 cp "s3://${S3_BACKUP_BUCKET}/${ARG}" "$ENC_FILE" --only-show-errors ;;
  file)
    cp "$ARG" "$ENC_FILE" ;;
  *)
    echo "ERROR: specify one of --list | --latest | --s3 <key> | --file <path>"; exit 1 ;;
esac

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY not set in $ENV_FILE — cannot decrypt"; exit 1
fi
if [ -z "$TARGET_URL" ]; then
  echo "ERROR: no target DATABASE_URL (set it in env or pass --target)"; exit 1
fi

# ── Safety gate ───────────────────────────────────────────────────────────────
TARGET_HOST=$(echo "$TARGET_URL" | sed -E 's#.*@([^/?]+).*#\1#')
echo ""
echo "About to RESTORE into: $TARGET_HOST"
echo "This will overwrite existing data in that database."
if [ "$CONFIRM" != "yes" ]; then
  echo "Refusing without --yes. Re-run with --yes to proceed."
  exit 1
fi

# ── Decrypt → gunzip → psql ───────────────────────────────────────────────────
echo "Restoring..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass pass:"$BACKUP_ENCRYPTION_KEY" -in "$ENC_FILE" \
  | gunzip \
  | psql "$TARGET_URL"

echo "Restore complete → $TARGET_HOST"

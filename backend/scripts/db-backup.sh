#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Database backup script for cred2tech-backend (PostgreSQL / Prisma).
#
# Backup strategy (mirrors the scheme-backend + eligibility-engine backups):
#   • Full pg_dump → gzip → AES-256-CBC encrypted
#   • Local: daily retained 30 days, monthly (1st) retained 12 months
#   • Offsite: every backup uploaded to S3
#       (s3://$S3_BACKUP_BUCKET/postgres-cred2tech-backend/...)
#   • S3-side retention via the bucket lifecycle rules
#
# Used by the CI/CD pipeline as the mandatory pre-deploy backup, and can also be
# run from cron:
#   crontab -e
#   0 2 * * * /opt/cred2tech/scripts/cred2tech-backend-db-backup.sh \
#       >> /var/backups/cred2tech/cred2tech-backend/backup.log 2>&1
#
# Requires: pg_dump (postgresql-client), gzip, openssl, aws CLI v2.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/cred2tech/cred2tech-backend.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cred2tech/cred2tech-backend}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_MONTH=$(date +%d)
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# An optional label (e.g. "predeploy") is added to the filename so pipeline
# backups are easy to spot among the cron dailies.
LABEL="${1:-}"
SUFFIX=""
[ -n "$LABEL" ] && SUFFIX="_${LABEL}"

# ── Load env ─────────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "$LOG_PREFIX ERROR: env file not found at $ENV_FILE"
  exit 1
fi

export $(grep -E '^DATABASE_URL=|^BACKUP_ENCRYPTION_KEY=|^S3_BACKUP_BUCKET=|^AWS_REGION=|^AWS_DEFAULT_REGION=|^AWS_ACCESS_KEY_ID=|^AWS_SECRET_ACCESS_KEY=|^AWS_SESSION_TOKEN=' "$ENV_FILE" | xargs)

# aws CLI reads AWS_DEFAULT_REGION; mirror AWS_REGION into it when only the
# latter is set so S3 calls don't fail on region resolution.
if [ -n "${AWS_REGION:-}" ] && [ -z "${AWS_DEFAULT_REGION:-}" ]; then
  export AWS_DEFAULT_REGION="$AWS_REGION"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "$LOG_PREFIX ERROR: DATABASE_URL not set in $ENV_FILE"
  exit 1
fi

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "$LOG_PREFIX ERROR: BACKUP_ENCRYPTION_KEY not set in $ENV_FILE"
  echo "$LOG_PREFIX Add: BACKUP_ENCRYPTION_KEY=<random-32-char-string> to $ENV_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Take backup ───────────────────────────────────────────────────────────────
BACKUP_FILE="${BACKUP_DIR}/cred2tech-backend_${TIMESTAMP}${SUFFIX}.sql.gz.enc"

echo "$LOG_PREFIX Starting backup → $BACKUP_FILE"

pg_dump "$DATABASE_URL" \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -pass pass:"$BACKUP_ENCRYPTION_KEY" \
  > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "$LOG_PREFIX Backup complete. Size: $SIZE"
# Emit the local path on its own line so callers (the pipeline) can capture it.
echo "BACKUP_FILE=$BACKUP_FILE"

# ── Upload to S3 (offsite copy) ───────────────────────────────────────────────
S3_PREFIX="postgres-cred2tech-backend"
s3_upload() {
  local src="$1" key="$2" tier="$3"
  if [ -z "${S3_BACKUP_BUCKET:-}" ]; then
    echo "$LOG_PREFIX ERROR: S3_BACKUP_BUCKET not set — offsite backup is required. Add it to $ENV_FILE."
    return 1
  fi
  # Catch the most common cause of "Unable to locate credentials" up front.
  if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    echo "$LOG_PREFIX ERROR: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing in $ENV_FILE — cannot upload $key to S3."
    echo "$LOG_PREFIX        Add AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to $ENV_FILE. (Local copy retained at $src)"
    return 1
  fi
  if ! aws s3 cp "$src" "s3://${S3_BACKUP_BUCKET}/${key}" --only-show-errors; then
    echo "$LOG_PREFIX ERROR: S3 upload FAILED for $key (local copy retained at $src)"
    return 1
  fi
  if ! aws s3api put-object-tagging --bucket "$S3_BACKUP_BUCKET" --key "$key" \
       --tagging 'TagSet=[{Key=tier,Value='"$tier"'}]' 2>/dev/null; then
    echo "$LOG_PREFIX WARN: Tagging FAILED for $key (file uploaded but not tagged)"
  fi
  echo "$LOG_PREFIX Uploaded to s3://${S3_BACKUP_BUCKET}/${key} (tagged: tier=$tier)"
  # Emit the S3 key so the pipeline can record exactly what to restore from.
  echo "BACKUP_S3_KEY=${key}"
  return 0
}

DAILY_KEY="${S3_PREFIX}/daily/$(basename "$BACKUP_FILE")"
s3_upload "$BACKUP_FILE" "$DAILY_KEY" "daily"

# ── Monthly snapshot (keep 12 months) ────────────────────────────────────────
if [ "$DAY_OF_MONTH" = "01" ] && [ -z "$LABEL" ]; then
  MONTHLY_FILE="${BACKUP_DIR}/monthly_$(date +%Y%m).sql.gz.enc"
  cp "$BACKUP_FILE" "$MONTHLY_FILE"
  echo "$LOG_PREFIX Monthly snapshot saved → $MONTHLY_FILE"
  s3_upload "$MONTHLY_FILE" "${S3_PREFIX}/monthly/$(basename "$MONTHLY_FILE")" "monthly"
fi

# ── Purge old local backups ───────────────────────────────────────────────────
echo "$LOG_PREFIX Purging daily backups older than 30 days..."
find "$BACKUP_DIR" -maxdepth 1 -name "cred2tech-backend_*.sql.gz.enc" -mtime +30 -delete
echo "$LOG_PREFIX Purging monthly backups older than 365 days..."
find "$BACKUP_DIR" -maxdepth 1 -name "monthly_*.sql.gz.enc" -mtime +365 -delete

echo "$LOG_PREFIX ── Done ──"

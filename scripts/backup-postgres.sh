#!/usr/bin/env bash
# =============================================================================
# backup-postgres.sh
# =============================================================================
# Automated PostgreSQL backup script for the 3D Development Platform.
#
# This script:
#   1. Creates a pg_dump in custom format (-Fc) for efficient parallel restore
#   2. Compresses the dump with gzip
#   3. Uploads the compressed dump to an S3 backup bucket
#   4. Deletes the local dump file after successful upload
#   5. Prunes backups older than the retention period (default: 30 days)
#   6. Logs all operations with timestamps
#   7. Sends a notification on failure
#
# Environment Variables (required):
#   PGHOST          - PostgreSQL host (default: postgres)
#   PGPORT          - PostgreSQL port (default: 5432)
#   PGDATABASE      - Database name (default: dev_platform)
#   PGUSER          - Database user (default: devuser)
#   PGPASSWORD      - Database password (from secrets)
#   S3_BACKUP_BUCKET - S3 bucket for backups (default: devplatform-backups)
#
# Environment Variables (optional):
#   BACKUP_RETENTION_DAYS - Days to retain backups (default: 30)
#   BACKUP_LOCAL_DIR      - Local temp directory for dumps (default: /tmp/pg-backups)
#   S3_ENDPOINT_URL       - Custom S3 endpoint for MinIO (default: none / AWS)
#   NOTIFICATION_WEBHOOK  - Slack/webhook URL for failure notifications
#   PUSHGATEWAY_URL       - Prometheus Pushgateway URL for metrics
#
# Usage:
#   ./backup-postgres.sh
#
# Cron example (daily at 02:00 UTC):
#   0 2 * * * /opt/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration with defaults
# ---------------------------------------------------------------------------
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-dev_platform}"
PGUSER="${PGUSER:-devuser}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-devplatform-backups}"
S3_BACKUP_PREFIX="postgres/daily"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/tmp/pg-backups}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-}"

# Timestamp for this run
TIMESTAMP="$(date -u +%Y-%m-%d_%H%M%S)"
DUMP_FILENAME="${PGDATABASE}_${TIMESTAMP}.dump"
COMPRESSED_FILENAME="${DUMP_FILENAME}.gz"
DUMP_FILEPATH="${BACKUP_LOCAL_DIR}/${DUMP_FILENAME}"
COMPRESSED_FILEPATH="${BACKUP_LOCAL_DIR}/${COMPRESSED_FILENAME}"
S3_DEST="s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/${COMPRESSED_FILENAME}"

# Build S3 CLI flags for custom endpoint (MinIO)
S3_FLAGS=""
if [[ -n "${S3_ENDPOINT_URL}" ]]; then
    S3_FLAGS="--endpoint-url ${S3_ENDPOINT_URL}"
fi

# Track start time for metrics
START_EPOCH="$(date +%s)"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [BACKUP] $*"
}

log_error() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [BACKUP] [ERROR] $*" >&2
}

# ---------------------------------------------------------------------------
# Notification on failure
# ---------------------------------------------------------------------------
send_failure_notification() {
    local message="$1"

    if [[ -n "${NOTIFICATION_WEBHOOK}" ]]; then
        log "Sending failure notification..."
        curl -sf -X POST "${NOTIFICATION_WEBHOOK}" \
            -H "Content-Type: application/json" \
            -d "{
                \"text\": \":rotating_light: *PostgreSQL Backup Failed*\",
                \"attachments\": [{
                    \"color\": \"danger\",
                    \"fields\": [
                        {\"title\": \"Database\", \"value\": \"${PGDATABASE}@${PGHOST}:${PGPORT}\", \"short\": true},
                        {\"title\": \"Timestamp\", \"value\": \"${TIMESTAMP}\", \"short\": true},
                        {\"title\": \"Error\", \"value\": \"${message}\"}
                    ]
                }]
            }" || log_error "Failed to send notification to webhook"
    else
        log "No NOTIFICATION_WEBHOOK configured; skipping notification."
    fi
}

# ---------------------------------------------------------------------------
# Push metrics to Prometheus Pushgateway
# ---------------------------------------------------------------------------
push_metrics() {
    local status="$1"       # "success" or "failure"
    local size_bytes="${2:-0}"

    if [[ -z "${PUSHGATEWAY_URL}" ]]; then
        return 0
    fi

    local end_epoch
    end_epoch="$(date +%s)"
    local duration=$(( end_epoch - START_EPOCH ))

    cat <<METRICS | curl -sf --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/backup_postgres/instance/${PGHOST}" || true
# HELP backup_postgres_last_run_timestamp Unix timestamp of the last backup run.
# TYPE backup_postgres_last_run_timestamp gauge
backup_postgres_last_run_timestamp ${end_epoch}
# HELP backup_postgres_last_success_timestamp Unix timestamp of the last successful backup.
# TYPE backup_postgres_last_success_timestamp gauge
backup_postgres_last_success_timestamp $([ "${status}" = "success" ] && echo "${end_epoch}" || echo "0")
# HELP backup_postgres_last_size_bytes Size of the last backup in bytes.
# TYPE backup_postgres_last_size_bytes gauge
backup_postgres_last_size_bytes ${size_bytes}
# HELP backup_postgres_duration_seconds Duration of the backup process in seconds.
# TYPE backup_postgres_duration_seconds gauge
backup_postgres_duration_seconds ${duration}
# HELP backup_postgres_success Whether the last backup succeeded (1) or failed (0).
# TYPE backup_postgres_success gauge
backup_postgres_success $([ "${status}" = "success" ] && echo "1" || echo "0")
METRICS

    log "Metrics pushed to Pushgateway (status=${status}, size=${size_bytes}, duration=${duration}s)."
}

# ---------------------------------------------------------------------------
# Cleanup trap -- ensure partial files are removed and notifications sent
# ---------------------------------------------------------------------------
cleanup() {
    local exit_code=$?
    if [[ ${exit_code} -ne 0 ]]; then
        log_error "Backup script exited with code ${exit_code}."
        send_failure_notification "Script exited with code ${exit_code}"
        push_metrics "failure"
    fi
    # Remove local files regardless of success/failure
    rm -f "${DUMP_FILEPATH}" "${COMPRESSED_FILEPATH}" 2>/dev/null || true
    log "Local temp files cleaned up."
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "=========================================="
log "PostgreSQL Backup Starting"
log "=========================================="
log "Host:      ${PGHOST}:${PGPORT}"
log "Database:  ${PGDATABASE}"
log "User:      ${PGUSER}"
log "S3 Dest:   ${S3_DEST}"
log "Retention: ${BACKUP_RETENTION_DAYS} days"

# Verify required tools are available
for cmd in pg_dump gzip aws; do
    if ! command -v "${cmd}" &>/dev/null; then
        log_error "Required command '${cmd}' not found in PATH."
        exit 1
    fi
done

# Verify PGPASSWORD is set
if [[ -z "${PGPASSWORD:-}" ]]; then
    log_error "PGPASSWORD is not set. Cannot authenticate to PostgreSQL."
    exit 1
fi

# Verify database connectivity
log "Verifying database connectivity..."
if ! pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -t 10 &>/dev/null; then
    log_error "Cannot connect to PostgreSQL at ${PGHOST}:${PGPORT}."
    exit 1
fi
log "Database connection verified."

# Create local backup directory
mkdir -p "${BACKUP_LOCAL_DIR}"

# ---------------------------------------------------------------------------
# Step 1: Run pg_dump
# ---------------------------------------------------------------------------
log "Step 1/5: Running pg_dump (custom format)..."
DUMP_START="$(date +%s)"

pg_dump \
    -h "${PGHOST}" \
    -p "${PGPORT}" \
    -U "${PGUSER}" \
    -d "${PGDATABASE}" \
    -Fc \
    --no-owner \
    --no-privileges \
    --verbose \
    -f "${DUMP_FILEPATH}" \
    2>&1 | while IFS= read -r line; do log "  pg_dump: ${line}"; done

DUMP_END="$(date +%s)"
DUMP_SIZE=$(stat -c%s "${DUMP_FILEPATH}" 2>/dev/null || stat -f%z "${DUMP_FILEPATH}" 2>/dev/null || echo "0")
log "pg_dump completed in $(( DUMP_END - DUMP_START ))s. Dump size: $(numfmt --to=iec-i --suffix=B "${DUMP_SIZE}" 2>/dev/null || echo "${DUMP_SIZE} bytes")."

# ---------------------------------------------------------------------------
# Step 2: Compress with gzip
# ---------------------------------------------------------------------------
log "Step 2/5: Compressing dump with gzip..."
GZIP_START="$(date +%s)"

gzip -9 "${DUMP_FILEPATH}"

GZIP_END="$(date +%s)"
COMPRESSED_SIZE=$(stat -c%s "${COMPRESSED_FILEPATH}" 2>/dev/null || stat -f%z "${COMPRESSED_FILEPATH}" 2>/dev/null || echo "0")
COMPRESSION_RATIO="N/A"
if [[ "${DUMP_SIZE}" -gt 0 ]]; then
    COMPRESSION_RATIO=$(awk "BEGIN {printf \"%.1f\", (1 - ${COMPRESSED_SIZE}/${DUMP_SIZE}) * 100}")
fi
log "Compression completed in $(( GZIP_END - GZIP_START ))s. Compressed size: $(numfmt --to=iec-i --suffix=B "${COMPRESSED_SIZE}" 2>/dev/null || echo "${COMPRESSED_SIZE} bytes") (${COMPRESSION_RATIO}% reduction)."

# ---------------------------------------------------------------------------
# Step 3: Upload to S3
# ---------------------------------------------------------------------------
log "Step 3/5: Uploading to S3..."
UPLOAD_START="$(date +%s)"

# shellcheck disable=SC2086
aws s3 cp "${COMPRESSED_FILEPATH}" "${S3_DEST}" \
    --sse AES256 \
    ${S3_FLAGS} \
    2>&1 | while IFS= read -r line; do log "  aws s3: ${line}"; done

UPLOAD_END="$(date +%s)"
log "Upload completed in $(( UPLOAD_END - UPLOAD_START ))s."

# Verify the upload
log "Verifying upload..."
# shellcheck disable=SC2086
REMOTE_SIZE=$(aws s3api head-object \
    --bucket "${S3_BACKUP_BUCKET}" \
    --key "${S3_BACKUP_PREFIX}/${COMPRESSED_FILENAME}" \
    ${S3_FLAGS} \
    --query "ContentLength" \
    --output text 2>/dev/null || echo "0")

if [[ "${REMOTE_SIZE}" -eq "${COMPRESSED_SIZE}" ]]; then
    log "Upload verified: remote size (${REMOTE_SIZE}) matches local size (${COMPRESSED_SIZE})."
else
    log_error "Upload verification FAILED: remote size (${REMOTE_SIZE}) does not match local size (${COMPRESSED_SIZE})."
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Delete local dump
# ---------------------------------------------------------------------------
log "Step 4/5: Removing local dump file..."
rm -f "${COMPRESSED_FILEPATH}"
log "Local file removed."

# ---------------------------------------------------------------------------
# Step 5: Prune old backups beyond retention period
# ---------------------------------------------------------------------------
log "Step 5/5: Pruning backups older than ${BACKUP_RETENTION_DAYS} days..."

CUTOFF_DATE=$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null \
    || date -u -v-"${BACKUP_RETENTION_DAYS}"d +%Y-%m-%d 2>/dev/null \
    || echo "")

if [[ -z "${CUTOFF_DATE}" ]]; then
    log "Warning: Could not calculate cutoff date. Skipping pruning."
else
    PRUNED_COUNT=0

    # List all backup files in the prefix and filter by date
    # shellcheck disable=SC2086
    aws s3 ls "s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/" ${S3_FLAGS} 2>/dev/null \
    | while IFS= read -r line; do
        # Extract filename from the listing
        FILENAME=$(echo "${line}" | awk '{print $NF}')

        # Extract date from filename (format: dev_platform_YYYY-MM-DD_HHMMSS.dump.gz)
        FILE_DATE=$(echo "${FILENAME}" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1 || echo "")

        if [[ -n "${FILE_DATE}" && "${FILE_DATE}" < "${CUTOFF_DATE}" ]]; then
            log "  Deleting expired backup: ${FILENAME} (date: ${FILE_DATE}, cutoff: ${CUTOFF_DATE})"
            # shellcheck disable=SC2086
            aws s3 rm "s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/${FILENAME}" ${S3_FLAGS} 2>/dev/null || true
            PRUNED_COUNT=$(( PRUNED_COUNT + 1 ))
        fi
    done

    log "Pruning complete. Removed ${PRUNED_COUNT:-0} expired backup(s)."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
END_EPOCH="$(date +%s)"
TOTAL_DURATION=$(( END_EPOCH - START_EPOCH ))

log "=========================================="
log "PostgreSQL Backup Complete"
log "=========================================="
log "Database:          ${PGDATABASE}@${PGHOST}:${PGPORT}"
log "Dump file:         ${COMPRESSED_FILENAME}"
log "S3 location:       ${S3_DEST}"
log "Compressed size:   $(numfmt --to=iec-i --suffix=B "${COMPRESSED_SIZE}" 2>/dev/null || echo "${COMPRESSED_SIZE} bytes")"
log "Total duration:    ${TOTAL_DURATION}s"
log "Retention:         ${BACKUP_RETENTION_DAYS} days"
log "Status:            SUCCESS"
log "=========================================="

# Push success metrics
push_metrics "success" "${COMPRESSED_SIZE}"

exit 0

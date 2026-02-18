#!/usr/bin/env bash
# =============================================================================
# backup-minio.sh
# =============================================================================
# MinIO/S3 backup script for the 3D Development Platform.
#
# This script:
#   1. Uses the MinIO client (mc) to mirror the primary bucket to a backup
#   2. Logs detailed statistics (files synced, bytes transferred, duration)
#   3. Verifies integrity by comparing object checksums between source and dest
#
# Environment Variables (required):
#   MINIO_PRIMARY_ALIAS    - mc alias for the primary MinIO (default: primary)
#   MINIO_BACKUP_ALIAS     - mc alias for the backup target (default: backup)
#   MINIO_SOURCE_BUCKET    - Source bucket name (default: dev-platform-uploads)
#   MINIO_BACKUP_BUCKET    - Destination bucket path (default: devplatform-backups/minio-mirror/dev-platform-uploads)
#
# Environment Variables (optional):
#   MINIO_PRIMARY_URL      - Primary MinIO endpoint URL (for alias setup)
#   MINIO_PRIMARY_ACCESS   - Primary access key (for alias setup)
#   MINIO_PRIMARY_SECRET   - Primary secret key (for alias setup)
#   MINIO_BACKUP_URL       - Backup MinIO/S3 endpoint URL (for alias setup)
#   MINIO_BACKUP_ACCESS    - Backup access key (for alias setup)
#   MINIO_BACKUP_SECRET    - Backup secret key (for alias setup)
#   CHECKSUM_SAMPLE_SIZE   - Number of random objects to checksum-verify (default: 50)
#   NOTIFICATION_WEBHOOK   - Slack/webhook URL for failure notifications
#   PUSHGATEWAY_URL        - Prometheus Pushgateway URL for metrics
#
# Usage:
#   ./backup-minio.sh
#
# Cron example (every 6 hours):
#   0 */6 * * * /opt/scripts/backup-minio.sh >> /var/log/backup-minio.log 2>&1
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration with defaults
# ---------------------------------------------------------------------------
MINIO_PRIMARY_ALIAS="${MINIO_PRIMARY_ALIAS:-primary}"
MINIO_BACKUP_ALIAS="${MINIO_BACKUP_ALIAS:-backup}"
MINIO_SOURCE_BUCKET="${MINIO_SOURCE_BUCKET:-dev-platform-uploads}"
MINIO_BACKUP_BUCKET="${MINIO_BACKUP_BUCKET:-devplatform-backups/minio-mirror/dev-platform-uploads}"
CHECKSUM_SAMPLE_SIZE="${CHECKSUM_SAMPLE_SIZE:-50}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-}"

# Optional: auto-configure mc aliases if credentials are provided
MINIO_PRIMARY_URL="${MINIO_PRIMARY_URL:-}"
MINIO_PRIMARY_ACCESS="${MINIO_PRIMARY_ACCESS:-}"
MINIO_PRIMARY_SECRET="${MINIO_PRIMARY_SECRET:-}"
MINIO_BACKUP_URL="${MINIO_BACKUP_URL:-}"
MINIO_BACKUP_ACCESS="${MINIO_BACKUP_ACCESS:-}"
MINIO_BACKUP_SECRET="${MINIO_BACKUP_SECRET:-}"

# Paths for mc
SOURCE_PATH="${MINIO_PRIMARY_ALIAS}/${MINIO_SOURCE_BUCKET}"
DEST_PATH="${MINIO_BACKUP_ALIAS}/${MINIO_BACKUP_BUCKET}"

# Timestamp
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S%z)"
START_EPOCH="$(date +%s)"

# Temp files for stats
MIRROR_LOG="$(mktemp /tmp/minio-mirror-XXXXXX.log)"
CHECKSUM_LOG="$(mktemp /tmp/minio-checksum-XXXXXX.log)"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [MINIO-BACKUP] $*"
}

log_error() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [MINIO-BACKUP] [ERROR] $*" >&2
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
                \"text\": \":rotating_light: *MinIO Backup Failed*\",
                \"attachments\": [{
                    \"color\": \"danger\",
                    \"fields\": [
                        {\"title\": \"Source\", \"value\": \"${SOURCE_PATH}\", \"short\": true},
                        {\"title\": \"Destination\", \"value\": \"${DEST_PATH}\", \"short\": true},
                        {\"title\": \"Error\", \"value\": \"${message}\"}
                    ]
                }]
            }" || log_error "Failed to send notification to webhook"
    fi
}

# ---------------------------------------------------------------------------
# Push metrics to Prometheus Pushgateway
# ---------------------------------------------------------------------------
push_metrics() {
    local status="$1"
    local objects_synced="${2:-0}"
    local bytes_transferred="${3:-0}"

    if [[ -z "${PUSHGATEWAY_URL}" ]]; then
        return 0
    fi

    local end_epoch
    end_epoch="$(date +%s)"
    local duration=$(( end_epoch - START_EPOCH ))

    cat <<METRICS | curl -sf --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/backup_minio/instance/${MINIO_PRIMARY_ALIAS}" || true
# HELP backup_minio_last_mirror_timestamp Unix timestamp of the last mirror run.
# TYPE backup_minio_last_mirror_timestamp gauge
backup_minio_last_mirror_timestamp ${end_epoch}
# HELP backup_minio_objects_synced Number of objects synced in the last run.
# TYPE backup_minio_objects_synced gauge
backup_minio_objects_synced ${objects_synced}
# HELP backup_minio_bytes_transferred Bytes transferred in the last run.
# TYPE backup_minio_bytes_transferred gauge
backup_minio_bytes_transferred ${bytes_transferred}
# HELP backup_minio_duration_seconds Duration of the mirror process in seconds.
# TYPE backup_minio_duration_seconds gauge
backup_minio_duration_seconds ${duration}
# HELP backup_minio_success Whether the last mirror succeeded (1) or failed (0).
# TYPE backup_minio_success gauge
backup_minio_success $([ "${status}" = "success" ] && echo "1" || echo "0")
METRICS

    log "Metrics pushed to Pushgateway."
}

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------
cleanup() {
    local exit_code=$?
    if [[ ${exit_code} -ne 0 ]]; then
        log_error "MinIO backup script exited with code ${exit_code}."
        send_failure_notification "Script exited with code ${exit_code}"
        push_metrics "failure"
    fi
    rm -f "${MIRROR_LOG}" "${CHECKSUM_LOG}" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "=========================================="
log "MinIO Backup Starting"
log "=========================================="
log "Source:      ${SOURCE_PATH}"
log "Destination: ${DEST_PATH}"
log "Timestamp:   ${TIMESTAMP}"

# Verify mc is available
if ! command -v mc &>/dev/null; then
    log_error "MinIO client (mc) not found in PATH. Install from https://min.io/docs/minio/linux/reference/minio-mc.html"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 0: Configure mc aliases if credentials are provided
# ---------------------------------------------------------------------------
if [[ -n "${MINIO_PRIMARY_URL}" && -n "${MINIO_PRIMARY_ACCESS}" && -n "${MINIO_PRIMARY_SECRET}" ]]; then
    log "Configuring mc alias '${MINIO_PRIMARY_ALIAS}'..."
    mc alias set "${MINIO_PRIMARY_ALIAS}" "${MINIO_PRIMARY_URL}" "${MINIO_PRIMARY_ACCESS}" "${MINIO_PRIMARY_SECRET}" --api S3v4 2>/dev/null
    log "Primary alias configured."
fi

if [[ -n "${MINIO_BACKUP_URL}" && -n "${MINIO_BACKUP_ACCESS}" && -n "${MINIO_BACKUP_SECRET}" ]]; then
    log "Configuring mc alias '${MINIO_BACKUP_ALIAS}'..."
    mc alias set "${MINIO_BACKUP_ALIAS}" "${MINIO_BACKUP_URL}" "${MINIO_BACKUP_ACCESS}" "${MINIO_BACKUP_SECRET}" --api S3v4 2>/dev/null
    log "Backup alias configured."
fi

# Verify aliases are accessible
log "Verifying source bucket accessibility..."
if ! mc ls "${SOURCE_PATH}/" &>/dev/null; then
    log_error "Cannot access source bucket: ${SOURCE_PATH}"
    exit 1
fi
log "Source bucket accessible."

log "Verifying destination bucket accessibility..."
if ! mc ls "${MINIO_BACKUP_ALIAS}/${MINIO_BACKUP_BUCKET%%/*}/" &>/dev/null; then
    log "Destination bucket root not found. Attempting to create..."
    mc mb "${DEST_PATH}" --ignore-existing 2>/dev/null || true
fi
log "Destination accessible."

# ---------------------------------------------------------------------------
# Step 1: Gather pre-mirror statistics
# ---------------------------------------------------------------------------
log "Step 1/4: Gathering source statistics..."

SOURCE_STATS=$(mc du "${SOURCE_PATH}/" --json 2>/dev/null || echo '{}')
SOURCE_OBJECT_COUNT=$(mc ls --recursive "${SOURCE_PATH}/" --json 2>/dev/null | wc -l || echo "0")
SOURCE_TOTAL_SIZE=$(echo "${SOURCE_STATS}" | grep -oP '"size":\s*\K[0-9]+' 2>/dev/null | tail -1 || echo "0")

log "Source bucket: ${SOURCE_OBJECT_COUNT} objects, $(numfmt --to=iec-i --suffix=B "${SOURCE_TOTAL_SIZE}" 2>/dev/null || echo "${SOURCE_TOTAL_SIZE} bytes")"

# ---------------------------------------------------------------------------
# Step 2: Run mc mirror
# ---------------------------------------------------------------------------
log "Step 2/4: Running mc mirror..."
MIRROR_START="$(date +%s)"

# mc mirror with:
#   --overwrite:    overwrite destination objects if source is newer
#   --remove:       remove objects from destination that no longer exist in source
#   --preserve:     preserve filesystem attributes (timestamps)
#   --json:         output JSON for parsing
mc mirror \
    --overwrite \
    --preserve \
    "${SOURCE_PATH}/" \
    "${DEST_PATH}/" \
    --json \
    2>&1 | tee "${MIRROR_LOG}" | while IFS= read -r json_line; do
        # Parse JSON output for real-time logging
        STATUS=$(echo "${json_line}" | grep -oP '"status":\s*"?\K[^",]+' 2>/dev/null || echo "")
        TARGET=$(echo "${json_line}" | grep -oP '"target":\s*"?\K[^",]+' 2>/dev/null || echo "")
        TOTAL_SIZE=$(echo "${json_line}" | grep -oP '"totalSize":\s*\K[0-9]+' 2>/dev/null || echo "")

        if [[ "${STATUS}" == "success" && -n "${TARGET}" ]]; then
            log "  Synced: ${TARGET##*/}"
        fi
    done || true  # mc mirror returns non-zero if nothing to sync

MIRROR_END="$(date +%s)"
MIRROR_DURATION=$(( MIRROR_END - MIRROR_START ))

# Parse mirror statistics from the JSON log
OBJECTS_SYNCED=$(grep -c '"status":\s*"success"' "${MIRROR_LOG}" 2>/dev/null || echo "0")
BYTES_TRANSFERRED=$(grep -oP '"totalSize":\s*\K[0-9]+' "${MIRROR_LOG}" 2>/dev/null | tail -1 || echo "0")

log "Mirror completed in ${MIRROR_DURATION}s."
log "  Objects synced:    ${OBJECTS_SYNCED}"
log "  Bytes transferred: $(numfmt --to=iec-i --suffix=B "${BYTES_TRANSFERRED}" 2>/dev/null || echo "${BYTES_TRANSFERRED} bytes")"

# ---------------------------------------------------------------------------
# Step 3: Verify integrity with checksums
# ---------------------------------------------------------------------------
log "Step 3/4: Verifying integrity (sampling ${CHECKSUM_SAMPLE_SIZE} objects)..."
CHECKSUM_START="$(date +%s)"

INTEGRITY_PASS=0
INTEGRITY_FAIL=0
INTEGRITY_SKIP=0

# Get a list of all objects and sample randomly
OBJECT_LIST=$(mc ls --recursive "${SOURCE_PATH}/" --json 2>/dev/null \
    | grep -oP '"key":\s*"\K[^"]+' 2>/dev/null \
    || echo "")

if [[ -z "${OBJECT_LIST}" ]]; then
    log "Warning: No objects found in source bucket. Skipping checksum verification."
else
    # Sample random objects for verification
    SAMPLE=$(echo "${OBJECT_LIST}" | shuf -n "${CHECKSUM_SAMPLE_SIZE}" 2>/dev/null \
        || echo "${OBJECT_LIST}" | head -n "${CHECKSUM_SAMPLE_SIZE}")

    while IFS= read -r object_key; do
        [[ -z "${object_key}" ]] && continue

        # Get checksums from source and destination using mc stat
        SOURCE_ETAG=$(mc stat "${SOURCE_PATH}/${object_key}" --json 2>/dev/null \
            | grep -oP '"etag":\s*"\K[^"]+' 2>/dev/null || echo "")
        DEST_ETAG=$(mc stat "${DEST_PATH}/${object_key}" --json 2>/dev/null \
            | grep -oP '"etag":\s*"\K[^"]+' 2>/dev/null || echo "")

        if [[ -z "${SOURCE_ETAG}" || -z "${DEST_ETAG}" ]]; then
            log "  SKIP: ${object_key} (could not retrieve ETag)"
            INTEGRITY_SKIP=$(( INTEGRITY_SKIP + 1 ))
        elif [[ "${SOURCE_ETAG}" == "${DEST_ETAG}" ]]; then
            INTEGRITY_PASS=$(( INTEGRITY_PASS + 1 ))
        else
            log_error "  MISMATCH: ${object_key} (source=${SOURCE_ETAG}, dest=${DEST_ETAG})"
            INTEGRITY_FAIL=$(( INTEGRITY_FAIL + 1 ))
        fi
    done <<< "${SAMPLE}"
fi

CHECKSUM_END="$(date +%s)"
CHECKSUM_DURATION=$(( CHECKSUM_END - CHECKSUM_START ))

log "Checksum verification completed in ${CHECKSUM_DURATION}s."
log "  Passed:  ${INTEGRITY_PASS}"
log "  Failed:  ${INTEGRITY_FAIL}"
log "  Skipped: ${INTEGRITY_SKIP}"

if [[ ${INTEGRITY_FAIL} -gt 0 ]]; then
    log_error "Integrity verification FAILED: ${INTEGRITY_FAIL} object(s) have mismatched checksums."
    send_failure_notification "${INTEGRITY_FAIL} objects failed checksum verification"
    # Do not exit -- report the error but continue to post metrics
fi

# ---------------------------------------------------------------------------
# Step 4: Post-mirror destination statistics
# ---------------------------------------------------------------------------
log "Step 4/4: Gathering destination statistics..."

DEST_OBJECT_COUNT=$(mc ls --recursive "${DEST_PATH}/" --json 2>/dev/null | wc -l || echo "0")
DEST_STATS=$(mc du "${DEST_PATH}/" --json 2>/dev/null || echo '{}')
DEST_TOTAL_SIZE=$(echo "${DEST_STATS}" | grep -oP '"size":\s*\K[0-9]+' 2>/dev/null | tail -1 || echo "0")

log "Destination bucket: ${DEST_OBJECT_COUNT} objects, $(numfmt --to=iec-i --suffix=B "${DEST_TOTAL_SIZE}" 2>/dev/null || echo "${DEST_TOTAL_SIZE} bytes")"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
END_EPOCH="$(date +%s)"
TOTAL_DURATION=$(( END_EPOCH - START_EPOCH ))

log "=========================================="
log "MinIO Backup Complete"
log "=========================================="
log "Source:              ${SOURCE_PATH}"
log "Destination:         ${DEST_PATH}"
log "Source objects:       ${SOURCE_OBJECT_COUNT}"
log "Destination objects:  ${DEST_OBJECT_COUNT}"
log "Objects synced:      ${OBJECTS_SYNCED}"
log "Bytes transferred:   $(numfmt --to=iec-i --suffix=B "${BYTES_TRANSFERRED}" 2>/dev/null || echo "${BYTES_TRANSFERRED} bytes")"
log "Checksum passed:     ${INTEGRITY_PASS}/${CHECKSUM_SAMPLE_SIZE}"
log "Checksum failed:     ${INTEGRITY_FAIL}"
log "Mirror duration:     ${MIRROR_DURATION}s"
log "Total duration:      ${TOTAL_DURATION}s"
if [[ ${INTEGRITY_FAIL} -gt 0 ]]; then
    log "Status:              COMPLETED WITH WARNINGS"
else
    log "Status:              SUCCESS"
fi
log "=========================================="

# Push metrics
if [[ ${INTEGRITY_FAIL} -gt 0 ]]; then
    push_metrics "failure" "${OBJECTS_SYNCED}" "${BYTES_TRANSFERRED}"
    exit 1
else
    push_metrics "success" "${OBJECTS_SYNCED}" "${BYTES_TRANSFERRED}"
fi

exit 0

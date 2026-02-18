#!/usr/bin/env bash
# =============================================================================
# restore-postgres.sh
# =============================================================================
# PostgreSQL restore script for the 3D Development Platform.
#
# This script:
#   1. Accepts a backup file path (local) or S3 URI
#   2. Downloads from S3 if a URI is provided
#   3. Confirms with the user before proceeding (unless --force is used)
#   4. Stops application services (backend, celery) via kubectl
#   5. Drops and recreates the target database
#   6. Restores from the pg_dump custom-format dump
#   7. Runs Alembic migrations (upgrade head)
#   8. Verifies restoration (table count, row counts, PostGIS extension)
#   9. Restarts application services
#
# Environment Variables (required):
#   PGHOST          - PostgreSQL host (default: postgres)
#   PGPORT          - PostgreSQL port (default: 5432)
#   PGDATABASE      - Database name (default: dev_platform)
#   PGUSER          - Database user (default: devuser)
#   PGPASSWORD      - Database password (from secrets)
#
# Environment Variables (optional):
#   S3_ENDPOINT_URL       - Custom S3 endpoint for MinIO
#   S3_BACKUP_BUCKET      - S3 bucket name (default: devplatform-backups)
#   K8S_NAMESPACE         - Kubernetes namespace (default: devplatform)
#   K8S_BACKEND_DEPLOY    - Backend deployment name (default: backend)
#   K8S_CELERY_DEPLOY     - Celery deployment name (default: celery)
#   K8S_BACKEND_REPLICAS  - Backend replicas to restore to (default: 2)
#   K8S_CELERY_REPLICAS   - Celery replicas to restore to (default: 1)
#   ALEMBIC_CONFIG        - Path to alembic.ini (default: /app/alembic.ini)
#   RESTORE_LOCAL_DIR     - Temp directory for downloads (default: /tmp/pg-restore)
#   NOTIFICATION_WEBHOOK  - Slack/webhook URL for notifications
#
# Usage:
#   ./restore-postgres.sh <backup-file-or-s3-uri> [--force]
#
# Examples:
#   ./restore-postgres.sh /backups/dev_platform_2026-02-15_020000.dump.gz
#   ./restore-postgres.sh s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz
#   ./restore-postgres.sh s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz --force
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration with defaults
# ---------------------------------------------------------------------------
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-dev_platform}"
PGUSER="${PGUSER:-devuser}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-devplatform-backups}"
K8S_NAMESPACE="${K8S_NAMESPACE:-devplatform}"
K8S_BACKEND_DEPLOY="${K8S_BACKEND_DEPLOY:-backend}"
K8S_CELERY_DEPLOY="${K8S_CELERY_DEPLOY:-celery}"
K8S_BACKEND_REPLICAS="${K8S_BACKEND_REPLICAS:-2}"
K8S_CELERY_REPLICAS="${K8S_CELERY_REPLICAS:-1}"
ALEMBIC_CONFIG="${ALEMBIC_CONFIG:-/app/alembic.ini}"
RESTORE_LOCAL_DIR="${RESTORE_LOCAL_DIR:-/tmp/pg-restore}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"

# Build S3 CLI flags for custom endpoint (MinIO)
S3_FLAGS=""
if [[ -n "${S3_ENDPOINT_URL}" ]]; then
    S3_FLAGS="--endpoint-url ${S3_ENDPOINT_URL}"
fi

# Parse arguments
FORCE_MODE=false
BACKUP_SOURCE=""

for arg in "$@"; do
    case "${arg}" in
        --force|-f)
            FORCE_MODE=true
            ;;
        -*)
            echo "Unknown option: ${arg}" >&2
            echo "Usage: $0 <backup-file-or-s3-uri> [--force]" >&2
            exit 1
            ;;
        *)
            if [[ -z "${BACKUP_SOURCE}" ]]; then
                BACKUP_SOURCE="${arg}"
            else
                echo "Unexpected argument: ${arg}" >&2
                echo "Usage: $0 <backup-file-or-s3-uri> [--force]" >&2
                exit 1
            fi
            ;;
    esac
done

if [[ -z "${BACKUP_SOURCE}" ]]; then
    echo "Error: No backup file or S3 URI specified." >&2
    echo "" >&2
    echo "Usage: $0 <backup-file-or-s3-uri> [--force]" >&2
    echo "" >&2
    echo "Examples:" >&2
    echo "  $0 /backups/dev_platform_2026-02-15_020000.dump.gz" >&2
    echo "  $0 s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz" >&2
    echo "  $0 s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz --force" >&2
    echo "" >&2
    echo "Available backups:" >&2
    # shellcheck disable=SC2086
    aws s3 ls "s3://${S3_BACKUP_BUCKET}/postgres/daily/" ${S3_FLAGS} 2>/dev/null \
        | tail -10 \
        | while IFS= read -r line; do echo "  ${line}"; done >&2
    exit 1
fi

# Track timing
START_EPOCH="$(date +%s)"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [RESTORE] $*"
}

log_error() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [RESTORE] [ERROR] $*" >&2
}

log_warn() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S%z)] [RESTORE] [WARN] $*"
}

# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------
send_notification() {
    local color="$1"
    local title="$2"
    local message="$3"

    if [[ -n "${NOTIFICATION_WEBHOOK}" ]]; then
        curl -sf -X POST "${NOTIFICATION_WEBHOOK}" \
            -H "Content-Type: application/json" \
            -d "{
                \"text\": \"*${title}*\",
                \"attachments\": [{
                    \"color\": \"${color}\",
                    \"fields\": [
                        {\"title\": \"Database\", \"value\": \"${PGDATABASE}@${PGHOST}:${PGPORT}\", \"short\": true},
                        {\"title\": \"Source\", \"value\": \"${BACKUP_SOURCE}\", \"short\": true},
                        {\"title\": \"Details\", \"value\": \"${message}\"}
                    ]
                }]
            }" 2>/dev/null || log_warn "Failed to send notification"
    fi
}

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------
DOWNLOADED_FILE=""
SERVICES_STOPPED=false

cleanup() {
    local exit_code=$?

    # Clean up downloaded file
    if [[ -n "${DOWNLOADED_FILE}" && -f "${DOWNLOADED_FILE}" ]]; then
        log "Cleaning up downloaded file: ${DOWNLOADED_FILE}"
        rm -f "${DOWNLOADED_FILE}"
    fi

    # If we failed after stopping services, warn loudly
    if [[ ${exit_code} -ne 0 && "${SERVICES_STOPPED}" == "true" ]]; then
        log_error "============================================================"
        log_error "RESTORE FAILED WITH SERVICES STOPPED!"
        log_error "Application services may still be scaled to 0."
        log_error "Manually restart with:"
        log_error "  kubectl -n ${K8S_NAMESPACE} scale deployment ${K8S_BACKEND_DEPLOY} --replicas=${K8S_BACKEND_REPLICAS}"
        log_error "  kubectl -n ${K8S_NAMESPACE} scale deployment ${K8S_CELERY_DEPLOY} --replicas=${K8S_CELERY_REPLICAS}"
        log_error "============================================================"
        send_notification "danger" "PostgreSQL Restore FAILED" "Restore failed with exit code ${exit_code}. Services may be down. Manual intervention required."
    elif [[ ${exit_code} -ne 0 ]]; then
        log_error "Restore failed with exit code ${exit_code}."
        send_notification "danger" "PostgreSQL Restore FAILED" "Restore failed with exit code ${exit_code}."
    fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
log "=========================================="
log "PostgreSQL Restore Starting"
log "=========================================="
log "Host:       ${PGHOST}:${PGPORT}"
log "Database:   ${PGDATABASE}"
log "User:       ${PGUSER}"
log "Source:     ${BACKUP_SOURCE}"
log "Force mode: ${FORCE_MODE}"
log "Namespace:  ${K8S_NAMESPACE}"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "Running pre-flight checks..."

# Verify required tools
for cmd in pg_restore psql gunzip; do
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
if ! pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -t 10 &>/dev/null; then
    log_error "Cannot connect to PostgreSQL at ${PGHOST}:${PGPORT}."
    exit 1
fi
log "Database connection verified."

# ---------------------------------------------------------------------------
# Step 1: Obtain the backup file
# ---------------------------------------------------------------------------
log "Step 1/7: Obtaining backup file..."

RESTORE_FILE=""

if [[ "${BACKUP_SOURCE}" == s3://* ]]; then
    # Download from S3
    log "Downloading from S3: ${BACKUP_SOURCE}"

    mkdir -p "${RESTORE_LOCAL_DIR}"
    FILENAME=$(basename "${BACKUP_SOURCE}")
    DOWNLOADED_FILE="${RESTORE_LOCAL_DIR}/${FILENAME}"

    # Check if S3 tools are available
    if ! command -v aws &>/dev/null; then
        log_error "AWS CLI not found. Required for S3 downloads."
        exit 1
    fi

    DOWNLOAD_START="$(date +%s)"

    # shellcheck disable=SC2086
    aws s3 cp "${BACKUP_SOURCE}" "${DOWNLOADED_FILE}" ${S3_FLAGS} \
        2>&1 | while IFS= read -r line; do log "  aws s3: ${line}"; done

    DOWNLOAD_END="$(date +%s)"
    DOWNLOAD_SIZE=$(stat -c%s "${DOWNLOADED_FILE}" 2>/dev/null || stat -f%z "${DOWNLOADED_FILE}" 2>/dev/null || echo "0")
    log "Download completed in $(( DOWNLOAD_END - DOWNLOAD_START ))s. Size: $(numfmt --to=iec-i --suffix=B "${DOWNLOAD_SIZE}" 2>/dev/null || echo "${DOWNLOAD_SIZE} bytes")"

    RESTORE_FILE="${DOWNLOADED_FILE}"
else
    # Local file
    if [[ ! -f "${BACKUP_SOURCE}" ]]; then
        log_error "Backup file not found: ${BACKUP_SOURCE}"
        exit 1
    fi
    RESTORE_FILE="${BACKUP_SOURCE}"
    log "Using local file: ${RESTORE_FILE}"
fi

# Decompress if gzipped
if [[ "${RESTORE_FILE}" == *.gz ]]; then
    log "Decompressing gzipped backup..."
    DECOMPRESSED_FILE="${RESTORE_FILE%.gz}"
    gunzip -k "${RESTORE_FILE}"
    # If we downloaded the file, clean up the compressed version
    if [[ -n "${DOWNLOADED_FILE}" ]]; then
        rm -f "${DOWNLOADED_FILE}"
        DOWNLOADED_FILE="${DECOMPRESSED_FILE}"
    fi
    RESTORE_FILE="${DECOMPRESSED_FILE}"
    log "Decompressed to: ${RESTORE_FILE}"
fi

# Verify the file looks like a pg_dump custom format
FILE_HEADER=$(head -c 5 "${RESTORE_FILE}" 2>/dev/null | xxd -p 2>/dev/null || echo "")
if [[ "${FILE_HEADER}" != "5047444d50"* ]] && [[ "${FILE_HEADER}" != "" ]]; then
    # PGDMP is the magic header for custom format pg_dump files (hex: 50 47 44 4d 50)
    log_warn "File header does not match pg_dump custom format. Proceeding anyway."
fi

RESTORE_SIZE=$(stat -c%s "${RESTORE_FILE}" 2>/dev/null || stat -f%z "${RESTORE_FILE}" 2>/dev/null || echo "0")
log "Backup file ready: ${RESTORE_FILE} ($(numfmt --to=iec-i --suffix=B "${RESTORE_SIZE}" 2>/dev/null || echo "${RESTORE_SIZE} bytes"))"

# ---------------------------------------------------------------------------
# Step 2: User confirmation
# ---------------------------------------------------------------------------
log "Step 2/7: Confirming restore operation..."

if [[ "${FORCE_MODE}" == "true" ]]; then
    log "Force mode enabled. Skipping confirmation."
else
    echo ""
    echo "==============================================================================="
    echo "  WARNING: DESTRUCTIVE OPERATION"
    echo "==============================================================================="
    echo ""
    echo "  This will:"
    echo "    1. STOP backend and celery services (causes downtime)"
    echo "    2. DROP the '${PGDATABASE}' database (all current data will be lost)"
    echo "    3. RECREATE the database from the backup file"
    echo "    4. RUN Alembic migrations"
    echo "    5. RESTART application services"
    echo ""
    echo "  Target:  ${PGDATABASE}@${PGHOST}:${PGPORT}"
    echo "  Source:  ${BACKUP_SOURCE}"
    echo "  File:    ${RESTORE_FILE}"
    echo ""
    echo "==============================================================================="
    echo ""
    read -r -p "  Are you sure you want to proceed? Type 'yes' to confirm: " CONFIRM

    if [[ "${CONFIRM}" != "yes" ]]; then
        log "Restore cancelled by user."
        exit 0
    fi
    echo ""
    log "User confirmed. Proceeding with restore."
fi

send_notification "warning" "PostgreSQL Restore Started" "Restoring ${PGDATABASE} from ${BACKUP_SOURCE}. Downtime expected."

# ---------------------------------------------------------------------------
# Step 3: Stop application services
# ---------------------------------------------------------------------------
log "Step 3/7: Stopping application services..."

if command -v kubectl &>/dev/null; then
    # Record current replica counts for safety
    CURRENT_BACKEND_REPLICAS=$(kubectl -n "${K8S_NAMESPACE}" get deployment "${K8S_BACKEND_DEPLOY}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "${K8S_BACKEND_REPLICAS}")
    CURRENT_CELERY_REPLICAS=$(kubectl -n "${K8S_NAMESPACE}" get deployment "${K8S_CELERY_DEPLOY}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "${K8S_CELERY_REPLICAS}")

    log "Current backend replicas: ${CURRENT_BACKEND_REPLICAS}"
    log "Current celery replicas:  ${CURRENT_CELERY_REPLICAS}"

    # Scale down
    kubectl -n "${K8S_NAMESPACE}" scale deployment "${K8S_BACKEND_DEPLOY}" --replicas=0 2>&1 | while IFS= read -r line; do log "  kubectl: ${line}"; done
    kubectl -n "${K8S_NAMESPACE}" scale deployment "${K8S_CELERY_DEPLOY}" --replicas=0 2>&1 | while IFS= read -r line; do log "  kubectl: ${line}"; done
    SERVICES_STOPPED=true

    # Wait for pods to terminate
    log "Waiting for pods to terminate..."
    kubectl -n "${K8S_NAMESPACE}" wait --for=delete pod -l "app.kubernetes.io/name=${K8S_BACKEND_DEPLOY}" --timeout=60s 2>/dev/null || true
    kubectl -n "${K8S_NAMESPACE}" wait --for=delete pod -l "app.kubernetes.io/name=celery" --timeout=60s 2>/dev/null || true

    log "Application services stopped."
else
    log_warn "kubectl not available. Assuming services are managed externally."
    log_warn "IMPORTANT: Ensure no application is writing to the database before proceeding."

    if [[ "${FORCE_MODE}" != "true" ]]; then
        read -r -p "  Press Enter to continue (or Ctrl+C to abort)..."
    fi
fi

# ---------------------------------------------------------------------------
# Step 4: Drop and recreate database
# ---------------------------------------------------------------------------
log "Step 4/7: Dropping and recreating database..."

# Terminate existing connections to the target database
log "Terminating active connections to '${PGDATABASE}'..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PGDATABASE}' AND pid <> pg_backend_pid();" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done || true

# Drop the database
log "Dropping database '${PGDATABASE}'..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c \
    "DROP DATABASE IF EXISTS ${PGDATABASE};" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done

# Recreate the database
log "Creating database '${PGDATABASE}' owned by '${PGUSER}'..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres -c \
    "CREATE DATABASE ${PGDATABASE} OWNER ${PGUSER};" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done

# Enable PostGIS extension (required for this platform)
log "Enabling PostGIS extension..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -c \
    "CREATE EXTENSION IF NOT EXISTS postgis;" \
    2>&1 | while IFS= read -r line; do log "  psql: ${line}"; done

log "Database recreated successfully."

# ---------------------------------------------------------------------------
# Step 5: Restore from dump
# ---------------------------------------------------------------------------
log "Step 5/7: Restoring from dump..."
RESTORE_START="$(date +%s)"

pg_restore \
    -h "${PGHOST}" \
    -p "${PGPORT}" \
    -U "${PGUSER}" \
    -d "${PGDATABASE}" \
    --no-owner \
    --no-privileges \
    --verbose \
    --exit-on-error \
    "${RESTORE_FILE}" \
    2>&1 | while IFS= read -r line; do log "  pg_restore: ${line}"; done

RESTORE_END="$(date +%s)"
RESTORE_DURATION=$(( RESTORE_END - RESTORE_START ))
log "pg_restore completed in ${RESTORE_DURATION}s."

# ---------------------------------------------------------------------------
# Step 6: Run Alembic migrations
# ---------------------------------------------------------------------------
log "Step 6/7: Running Alembic migrations..."

if command -v alembic &>/dev/null; then
    ALEMBIC_ARGS=""
    if [[ -f "${ALEMBIC_CONFIG}" ]]; then
        ALEMBIC_ARGS="-c ${ALEMBIC_CONFIG}"
    fi

    # Set the sync database URL for Alembic
    export DATABASE_URL_SYNC="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

    # shellcheck disable=SC2086
    alembic ${ALEMBIC_ARGS} upgrade head \
        2>&1 | while IFS= read -r line; do log "  alembic: ${line}"; done

    # Verify current revision
    # shellcheck disable=SC2086
    CURRENT_REV=$(alembic ${ALEMBIC_ARGS} current 2>/dev/null | head -1 || echo "unknown")
    log "Alembic current revision: ${CURRENT_REV}"
else
    log_warn "Alembic not found. Skipping migration step."
    log_warn "You may need to run migrations manually: alembic upgrade head"
fi

# ---------------------------------------------------------------------------
# Step 7: Verify restoration
# ---------------------------------------------------------------------------
log "Step 7/7: Verifying restoration..."

VERIFICATION_PASSED=true

# 7a. Check table count
log "Checking table count..."
TABLE_COUNT=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -t -A -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
    2>/dev/null || echo "0")
TABLE_COUNT=$(echo "${TABLE_COUNT}" | tr -d '[:space:]')
log "  Tables found: ${TABLE_COUNT}"

if [[ "${TABLE_COUNT}" -eq 0 ]]; then
    log_error "  VERIFICATION FAILED: No tables found in restored database."
    VERIFICATION_PASSED=false
else
    log "  Table count OK."
fi

# 7b. List tables with row counts
log "Table row counts:"
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -c \
    "SELECT
        schemaname,
        relname AS table_name,
        n_live_tup AS row_count
     FROM pg_stat_user_tables
     ORDER BY n_live_tup DESC;" \
    2>&1 | while IFS= read -r line; do log "  ${line}"; done

# 7c. Check PostGIS extension
log "Checking PostGIS extension..."
POSTGIS_VERSION=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -t -A -c \
    "SELECT PostGIS_Version();" 2>/dev/null || echo "NOT INSTALLED")
POSTGIS_VERSION=$(echo "${POSTGIS_VERSION}" | tr -d '[:space:]')

if [[ "${POSTGIS_VERSION}" == "NOTINSTALLED" || -z "${POSTGIS_VERSION}" ]]; then
    log_error "  PostGIS extension is not installed."
    VERIFICATION_PASSED=false
else
    log "  PostGIS version: ${POSTGIS_VERSION}"
fi

# 7d. Check that key tables exist (platform-specific)
log "Checking for expected platform tables..."
EXPECTED_TABLES=("alembic_version" "spatial_ref_sys")
for tbl in "${EXPECTED_TABLES[@]}"; do
    EXISTS=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -t -A -c \
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}');" \
        2>/dev/null || echo "f")
    EXISTS=$(echo "${EXISTS}" | tr -d '[:space:]')
    if [[ "${EXISTS}" == "t" ]]; then
        log "  Table '${tbl}': present"
    else
        log_warn "  Table '${tbl}': NOT FOUND (may be expected for fresh backups)"
    fi
done

# 7e. Quick connectivity test via application database URL
log "Testing database connectivity with application URL pattern..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -c "SELECT 1 AS connection_test;" >/dev/null 2>&1
if [[ $? -eq 0 ]]; then
    log "  Application database connectivity: OK"
else
    log_error "  Application database connectivity: FAILED"
    VERIFICATION_PASSED=false
fi

# ---------------------------------------------------------------------------
# Restart application services
# ---------------------------------------------------------------------------
log "Restarting application services..."

if command -v kubectl &>/dev/null && [[ "${SERVICES_STOPPED}" == "true" ]]; then
    kubectl -n "${K8S_NAMESPACE}" scale deployment "${K8S_BACKEND_DEPLOY}" --replicas="${K8S_BACKEND_REPLICAS}" \
        2>&1 | while IFS= read -r line; do log "  kubectl: ${line}"; done
    kubectl -n "${K8S_NAMESPACE}" scale deployment "${K8S_CELERY_DEPLOY}" --replicas="${K8S_CELERY_REPLICAS}" \
        2>&1 | while IFS= read -r line; do log "  kubectl: ${line}"; done

    SERVICES_STOPPED=false

    # Wait for pods to be ready
    log "Waiting for backend pods to be ready..."
    kubectl -n "${K8S_NAMESPACE}" wait --for=condition=ready pod \
        -l "app.kubernetes.io/name=${K8S_BACKEND_DEPLOY}" \
        --timeout=120s 2>/dev/null || log_warn "Timeout waiting for backend pods."

    log "Application services restarted."

    # Health check
    log "Running application health check..."
    sleep 5  # Brief pause for startup
    HEALTH_STATUS=$(kubectl -n "${K8S_NAMESPACE}" exec \
        "$(kubectl -n "${K8S_NAMESPACE}" get pod -l "app.kubernetes.io/name=${K8S_BACKEND_DEPLOY}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)" \
        -- curl -sf http://localhost:8000/api/v1/health 2>/dev/null || echo '{"status":"unknown"}')
    log "  Health check response: ${HEALTH_STATUS}"
else
    log_warn "kubectl not available or services were not stopped by this script."
    log_warn "Manually restart application services."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
END_EPOCH="$(date +%s)"
TOTAL_DURATION=$(( END_EPOCH - START_EPOCH ))

log "=========================================="
log "PostgreSQL Restore Complete"
log "=========================================="
log "Database:          ${PGDATABASE}@${PGHOST}:${PGPORT}"
log "Backup source:     ${BACKUP_SOURCE}"
log "Tables restored:   ${TABLE_COUNT}"
log "PostGIS:           ${POSTGIS_VERSION}"
log "Restore duration:  ${RESTORE_DURATION:-N/A}s"
log "Total duration:    ${TOTAL_DURATION}s"
if [[ "${VERIFICATION_PASSED}" == "true" ]]; then
    log "Verification:      PASSED"
    log "Status:            SUCCESS"
    send_notification "good" "PostgreSQL Restore Succeeded" "Database ${PGDATABASE} restored from ${BACKUP_SOURCE}. ${TABLE_COUNT} tables, verification passed. Total time: ${TOTAL_DURATION}s."
else
    log "Verification:      FAILED (see warnings above)"
    log "Status:            COMPLETED WITH WARNINGS"
    send_notification "warning" "PostgreSQL Restore Completed with Warnings" "Database ${PGDATABASE} restored but verification had warnings. Manual review recommended."
fi
log "=========================================="

if [[ "${VERIFICATION_PASSED}" != "true" ]]; then
    exit 1
fi

exit 0

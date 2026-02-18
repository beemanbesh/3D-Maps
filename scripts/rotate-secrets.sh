#!/usr/bin/env bash
# =============================================================================
# rotate-secrets.sh -- Rotate application secrets for 3D Development Platform
# =============================================================================
# Usage:  ./scripts/rotate-secrets.sh [path-to-env-file]
#
# This script:
#   1. Generates new values for JWT_SECRET_KEY, database password, and MinIO/S3
#      credentials.
#   2. Creates a timestamped backup of the current .env file.
#   3. Updates the .env file with the new secret values.
#   4. Logs the rotation event.
#   5. Prompts you to restart services.
#
# Requirements: openssl, sed, date
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Color codes
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${1:-$PROJECT_ROOT/.env}"
LOG_FILE="$PROJECT_ROOT/.secret-rotation.log"
BACKUP_DIR="$PROJECT_ROOT/.env-backups"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info() {
    printf "${CYAN}[INFO]${NC}  %s\n" "$1"
}

success() {
    printf "${GREEN}[OK]${NC}    %s\n" "$1"
}

warning() {
    printf "${YELLOW}[WARN]${NC}  %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

log_rotation() {
    local timestamp
    timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "[$timestamp] $1" >> "$LOG_FILE"
}

generate_hex() {
    local length="${1:-32}"
    openssl rand -hex "$length"
}

generate_base64() {
    local bytes="${1:-24}"
    openssl rand -base64 "$bytes" | tr -d '\n'
}

generate_alphanum() {
    local length="${1:-24}"
    openssl rand -base64 "$((length * 2))" | tr -dc 'A-Za-z0-9' | head -c "$length"
}

# Update a key=value line in the .env file.
# If the key exists, replace the line. If not, append it.
update_env_var() {
    local key="$1"
    local value="$2"
    local file="$3"

    if grep -q "^${key}=" "$file" 2>/dev/null; then
        # Use a delimiter that is unlikely to appear in secrets
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
echo ""
printf "${BOLD}=== 3D Development Platform -- Secret Rotation ===${NC}\n"
echo ""

# Verify openssl is available
if ! command -v openssl &>/dev/null; then
    error "openssl is required but not found in PATH."
    exit 1
fi

# Verify .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    error ".env file not found at: $ENV_FILE"
    error "Create one first:  cp .env.example .env"
    exit 1
fi

info "Target .env file: $ENV_FILE"

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
echo ""
warning "This will rotate the following secrets:"
echo "   - JWT_SECRET_KEY        (all active sessions will be invalidated)"
echo "   - POSTGRES_PASSWORD     (database connection strings will be updated)"
echo "   - S3_ACCESS_KEY         (object storage access key)"
echo "   - S3_SECRET_KEY         (object storage secret key)"
echo "   - MINIO_ROOT_USER       (MinIO admin username)"
echo "   - MINIO_ROOT_PASSWORD   (MinIO admin password)"
echo ""

read -rp "$(printf "${YELLOW}Proceed with rotation? [y/N]: ${NC}")" CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
    info "Rotation cancelled."
    exit 0
fi

echo ""

# ---------------------------------------------------------------------------
# Step 1: Back up current .env
# ---------------------------------------------------------------------------
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/.env.backup.$TIMESTAMP"
cp "$ENV_FILE" "$BACKUP_FILE"
success "Backup created: $BACKUP_FILE"
log_rotation "BACKUP created: $BACKUP_FILE"

# ---------------------------------------------------------------------------
# Step 2: Generate new secrets
# ---------------------------------------------------------------------------
info "Generating new secrets..."

NEW_JWT_SECRET="$(generate_hex 32)"
NEW_DB_PASSWORD="$(generate_alphanum 32)"
NEW_S3_ACCESS_KEY="$(generate_alphanum 20)"
NEW_S3_SECRET_KEY="$(generate_hex 32)"
NEW_MINIO_ROOT_USER="$(generate_alphanum 16)"
NEW_MINIO_ROOT_PASSWORD="$(generate_alphanum 32)"

success "JWT_SECRET_KEY:     ${NEW_JWT_SECRET:0:8}...${NEW_JWT_SECRET: -4} (64 hex chars)"
success "POSTGRES_PASSWORD:  ${NEW_DB_PASSWORD:0:4}...${NEW_DB_PASSWORD: -4} (32 chars)"
success "S3_ACCESS_KEY:      ${NEW_S3_ACCESS_KEY:0:4}...${NEW_S3_ACCESS_KEY: -4} (20 chars)"
success "S3_SECRET_KEY:      ${NEW_S3_SECRET_KEY:0:8}...${NEW_S3_SECRET_KEY: -4} (64 hex chars)"
success "MINIO_ROOT_USER:    ${NEW_MINIO_ROOT_USER:0:4}...${NEW_MINIO_ROOT_USER: -4} (16 chars)"
success "MINIO_ROOT_PASSWORD:${NEW_MINIO_ROOT_PASSWORD:0:4}...${NEW_MINIO_ROOT_PASSWORD: -4} (32 chars)"

echo ""

# ---------------------------------------------------------------------------
# Step 3: Update .env file
# ---------------------------------------------------------------------------
info "Updating .env file..."

# Read current DB user (default to 'devuser')
CURRENT_DB_USER="devuser"
if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
    # Extract user from postgresql://USER:password@host/db
    EXTRACTED_USER="$(grep "^DATABASE_URL=" "$ENV_FILE" | sed -n 's|.*://\([^:]*\):.*|\1|p')"
    if [[ -n "$EXTRACTED_USER" ]]; then
        CURRENT_DB_USER="$EXTRACTED_USER"
    fi
fi

# Read current DB host and name from DATABASE_URL
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="dev_platform"
if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
    EXTRACTED_HOST="$(grep "^DATABASE_URL=" "$ENV_FILE" | sed -n 's|.*@\([^:/]*\).*|\1|p')"
    EXTRACTED_PORT="$(grep "^DATABASE_URL=" "$ENV_FILE" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')"
    EXTRACTED_DB="$(grep "^DATABASE_URL=" "$ENV_FILE" | sed -n 's|.*/\([^?]*\).*|\1|p')"
    [[ -n "$EXTRACTED_HOST" ]] && DB_HOST="$EXTRACTED_HOST"
    [[ -n "$EXTRACTED_PORT" ]] && DB_PORT="$EXTRACTED_PORT"
    [[ -n "$EXTRACTED_DB" ]] && DB_NAME="$EXTRACTED_DB"
fi

# Update secrets
update_env_var "JWT_SECRET_KEY" "$NEW_JWT_SECRET" "$ENV_FILE"
update_env_var "S3_ACCESS_KEY" "$NEW_S3_ACCESS_KEY" "$ENV_FILE"
update_env_var "S3_SECRET_KEY" "$NEW_S3_SECRET_KEY" "$ENV_FILE"

# Update database connection strings with new password
NEW_ASYNC_URL="postgresql+asyncpg://${CURRENT_DB_USER}:${NEW_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
NEW_SYNC_URL="postgresql://${CURRENT_DB_USER}:${NEW_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
update_env_var "DATABASE_URL" "$NEW_ASYNC_URL" "$ENV_FILE"
update_env_var "DATABASE_URL_SYNC" "$NEW_SYNC_URL" "$ENV_FILE"

# Update MinIO variables (if present or add them)
update_env_var "MINIO_ROOT_USER" "$NEW_MINIO_ROOT_USER" "$ENV_FILE"
update_env_var "MINIO_ROOT_PASSWORD" "$NEW_MINIO_ROOT_PASSWORD" "$ENV_FILE"

success ".env file updated"

# ---------------------------------------------------------------------------
# Step 4: Log the rotation event
# ---------------------------------------------------------------------------
log_rotation "ROTATED: JWT_SECRET_KEY, DATABASE_URL (password), S3_ACCESS_KEY, S3_SECRET_KEY, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD"
log_rotation "ENV_FILE: $ENV_FILE"
log_rotation "OPERATOR: $(whoami)@$(hostname)"
success "Rotation logged to: $LOG_FILE"

# ---------------------------------------------------------------------------
# Step 5: Post-rotation instructions
# ---------------------------------------------------------------------------
echo ""
printf "${BOLD}=== Post-Rotation Steps ===${NC}\n"
echo ""
warning "IMPORTANT: You must now restart all services for changes to take effect."
echo ""
echo "  For Docker Compose (development):"
echo "    docker compose down && docker compose up -d"
echo ""
echo "  For Docker Compose (staging):"
echo "    docker compose -f docker-compose.yml -f docker-compose.staging.yml down"
echo "    docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d"
echo ""
echo "  For Kubernetes:"
echo "    1. Update k8s/secrets.yaml or your external secret store"
echo "    2. kubectl apply -f k8s/secrets.yaml"
echo "    3. kubectl rollout restart deployment/backend -n devplatform"
echo "    4. kubectl rollout restart deployment/celery -n devplatform"
echo ""
warning "Database password change: You must also update the PostgreSQL user password:"
echo "    psql -U postgres -c \"ALTER USER ${CURRENT_DB_USER} PASSWORD '${NEW_DB_PASSWORD}';\""
echo ""
warning "MinIO credential change: If MinIO is already running with old credentials,"
echo "  you may need to recreate the MinIO container or use mc admin to update."
echo ""
warning "JWT rotation: All existing user sessions have been invalidated."
echo "  Users will need to re-authenticate."
echo ""

read -rp "$(printf "${CYAN}Press Enter to acknowledge...${NC}")"

echo ""
success "Secret rotation complete."
success "Backup available at: $BACKUP_FILE"
success "Rotation log: $LOG_FILE"
echo ""

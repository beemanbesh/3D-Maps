#!/usr/bin/env bash
# =============================================================================
# validate-env.sh -- Validate environment variables for 3D Development Platform
# =============================================================================
# Usage:  ./scripts/validate-env.sh [path-to-env-file]
#
# Exit codes:
#   0  All checks passed
#   1  One or more critical variables are missing or invalid
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
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf "  ${GREEN}[PASS]${NC}  %s\n" "$1"
}

warn() {
    WARN_COUNT=$((WARN_COUNT + 1))
    printf "  ${YELLOW}[WARN]${NC}  %s\n" "$1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "  ${RED}[FAIL]${NC}  %s\n" "$1"
}

section() {
    echo ""
    printf "${CYAN}${BOLD}--- %s ---${NC}\n" "$1"
}

# ---------------------------------------------------------------------------
# Load .env file if provided or if default exists
# ---------------------------------------------------------------------------
ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
    # Try to find .env relative to this script or in current directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        ENV_FILE="$PROJECT_ROOT/.env"
    elif [[ -f ".env" ]]; then
        ENV_FILE=".env"
    fi
fi

if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    printf "${BOLD}Loading environment from: %s${NC}\n" "$ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
else
    printf "${YELLOW}No .env file found. Validating exported environment variables only.${NC}\n"
fi

# ---------------------------------------------------------------------------
# Detect environment
# ---------------------------------------------------------------------------
APP_ENV="${APP_ENV:-development}"
printf "${BOLD}Environment: %s${NC}\n" "$APP_ENV"

# =============================================================================
# Checks
# =============================================================================

# ---------------------------------------------------------------------------
section "Database"
# ---------------------------------------------------------------------------

if [[ -z "${DATABASE_URL:-}" ]]; then
    fail "DATABASE_URL is not set (required)"
else
    pass "DATABASE_URL is set"
    # Validate format: should start with postgresql
    if [[ "$DATABASE_URL" =~ ^postgresql ]]; then
        pass "DATABASE_URL has valid PostgreSQL scheme"
    else
        fail "DATABASE_URL does not start with 'postgresql' -- unexpected scheme"
    fi
    # Check for default password in non-development environments
    if [[ "$APP_ENV" != "development" && "$DATABASE_URL" == *"devpassword"* ]]; then
        fail "DATABASE_URL contains default password 'devpassword' in $APP_ENV environment"
    fi
fi

if [[ -z "${DATABASE_URL_SYNC:-}" ]]; then
    warn "DATABASE_URL_SYNC is not set (required for migrations and Celery)"
else
    pass "DATABASE_URL_SYNC is set"
fi

# ---------------------------------------------------------------------------
section "Redis"
# ---------------------------------------------------------------------------

if [[ -z "${REDIS_URL:-}" ]]; then
    fail "REDIS_URL is not set (required)"
else
    pass "REDIS_URL is set"
    if [[ "$REDIS_URL" =~ ^redis:// ]]; then
        pass "REDIS_URL has valid redis:// scheme"
    else
        warn "REDIS_URL does not use redis:// scheme -- verify it is correct"
    fi
fi

# ---------------------------------------------------------------------------
section "JWT / Security"
# ---------------------------------------------------------------------------

if [[ -z "${JWT_SECRET_KEY:-}" ]]; then
    fail "JWT_SECRET_KEY is not set (required)"
else
    SECRET_LEN=${#JWT_SECRET_KEY}
    if [[ "$SECRET_LEN" -lt 32 ]]; then
        fail "JWT_SECRET_KEY is only $SECRET_LEN characters (minimum 32 recommended)"
    else
        pass "JWT_SECRET_KEY is set ($SECRET_LEN characters)"
    fi

    # Check for placeholder / default values
    KNOWN_DEFAULTS=(
        "change-this-to-a-random-secret-in-production"
        "change-this-in-production"
        "secret"
        "changeme"
    )
    JWT_LOWER="$(echo "$JWT_SECRET_KEY" | tr '[:upper:]' '[:lower:]')"
    for default_val in "${KNOWN_DEFAULTS[@]}"; do
        if [[ "$JWT_LOWER" == "$default_val" ]]; then
            if [[ "$APP_ENV" == "development" ]]; then
                warn "JWT_SECRET_KEY is a known default value (acceptable for development)"
            else
                fail "JWT_SECRET_KEY is a known default value -- MUST be changed for $APP_ENV"
            fi
            break
        fi
    done
fi

JWT_ALG="${JWT_ALGORITHM:-HS256}"
if [[ "$JWT_ALG" =~ ^(HS256|HS384|HS512|RS256|RS384|RS512|ES256|ES384|ES512)$ ]]; then
    pass "JWT_ALGORITHM is valid: $JWT_ALG"
else
    warn "JWT_ALGORITHM '$JWT_ALG' is not a standard algorithm"
fi

if [[ -n "${JWT_ACCESS_TOKEN_EXPIRE_MINUTES:-}" ]]; then
    if [[ "$JWT_ACCESS_TOKEN_EXPIRE_MINUTES" -gt 60 ]]; then
        warn "JWT_ACCESS_TOKEN_EXPIRE_MINUTES is $JWT_ACCESS_TOKEN_EXPIRE_MINUTES (>60 min is discouraged)"
    else
        pass "JWT_ACCESS_TOKEN_EXPIRE_MINUTES is $JWT_ACCESS_TOKEN_EXPIRE_MINUTES"
    fi
fi

# ---------------------------------------------------------------------------
section "API Keys"
# ---------------------------------------------------------------------------

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    warn "ANTHROPIC_API_KEY is not set (AI features will be unavailable)"
else
    if [[ "$ANTHROPIC_API_KEY" =~ ^sk-ant- ]]; then
        pass "ANTHROPIC_API_KEY is set and has valid prefix"
    elif [[ "$ANTHROPIC_API_KEY" == "sk-ant-your-key-here" ]]; then
        fail "ANTHROPIC_API_KEY is still the placeholder value from .env.example"
    else
        warn "ANTHROPIC_API_KEY is set but does not start with 'sk-ant-' -- verify format"
    fi
fi

if [[ -z "${MAPBOX_ACCESS_TOKEN:-}" ]]; then
    warn "MAPBOX_ACCESS_TOKEN is not set (map features will be unavailable)"
else
    if [[ "$MAPBOX_ACCESS_TOKEN" =~ ^pk\. ]]; then
        pass "MAPBOX_ACCESS_TOKEN is set and has valid prefix"
    elif [[ "$MAPBOX_ACCESS_TOKEN" == "pk.your-mapbox-token-here" ]]; then
        fail "MAPBOX_ACCESS_TOKEN is still the placeholder value from .env.example"
    else
        warn "MAPBOX_ACCESS_TOKEN is set but does not start with 'pk.' -- verify format"
    fi
fi

# ---------------------------------------------------------------------------
section "Object Storage (S3 / MinIO)"
# ---------------------------------------------------------------------------

if [[ -z "${S3_ACCESS_KEY:-}" ]]; then
    fail "S3_ACCESS_KEY is not set (required)"
else
    pass "S3_ACCESS_KEY is set"
    if [[ "$APP_ENV" != "development" && "$S3_ACCESS_KEY" == "minioadmin" ]]; then
        fail "S3_ACCESS_KEY is the default 'minioadmin' in $APP_ENV environment"
    fi
fi

if [[ -z "${S3_SECRET_KEY:-}" ]]; then
    fail "S3_SECRET_KEY is not set (required)"
else
    pass "S3_SECRET_KEY is set"
    if [[ "$APP_ENV" != "development" && "$S3_SECRET_KEY" == "minioadmin" ]]; then
        fail "S3_SECRET_KEY is the default 'minioadmin' in $APP_ENV environment"
    fi
fi

if [[ -z "${S3_ENDPOINT_URL:-}" ]]; then
    warn "S3_ENDPOINT_URL is not set (will default to http://localhost:9000)"
else
    if [[ "$S3_ENDPOINT_URL" =~ ^https?:// ]]; then
        pass "S3_ENDPOINT_URL is set: $S3_ENDPOINT_URL"
    else
        fail "S3_ENDPOINT_URL does not have http(s) scheme: $S3_ENDPOINT_URL"
    fi
fi

if [[ -z "${S3_BUCKET_NAME:-}" ]]; then
    warn "S3_BUCKET_NAME is not set (will default to 'dev-platform-uploads')"
else
    pass "S3_BUCKET_NAME is set: $S3_BUCKET_NAME"
fi

# ---------------------------------------------------------------------------
section "Monitoring"
# ---------------------------------------------------------------------------

if [[ -z "${SENTRY_DSN:-}" ]]; then
    if [[ "$APP_ENV" == "production" ]]; then
        warn "SENTRY_DSN is not set -- error tracking will be disabled in production"
    else
        pass "SENTRY_DSN is not set (optional for $APP_ENV)"
    fi
else
    if [[ "$SENTRY_DSN" =~ ^https:// ]]; then
        pass "SENTRY_DSN is set and uses HTTPS"
    else
        warn "SENTRY_DSN is set but does not use HTTPS -- verify the DSN"
    fi
fi

LOG_LEVEL="${LOG_LEVEL:-INFO}"
VALID_LEVELS="DEBUG INFO WARNING ERROR CRITICAL"
LOG_UPPER="$(echo "$LOG_LEVEL" | tr '[:lower:]' '[:upper:]')"
if echo "$VALID_LEVELS" | grep -qw "$LOG_UPPER"; then
    pass "LOG_LEVEL is valid: $LOG_UPPER"
else
    warn "LOG_LEVEL '$LOG_LEVEL' is not a standard Python logging level"
fi

# ---------------------------------------------------------------------------
section "Application"
# ---------------------------------------------------------------------------

if [[ -z "${APP_ENV:-}" ]]; then
    warn "APP_ENV is not set (defaults to 'development')"
else
    if [[ "$APP_ENV" =~ ^(development|staging|production|test)$ ]]; then
        pass "APP_ENV is valid: $APP_ENV"
    else
        warn "APP_ENV '$APP_ENV' is not a recognized environment name"
    fi
fi

APP_DEBUG="${APP_DEBUG:-false}"
if [[ "$APP_ENV" == "production" && "$APP_DEBUG" == "true" ]]; then
    fail "APP_DEBUG is 'true' in production -- this exposes detailed error information"
else
    pass "APP_DEBUG is '$APP_DEBUG' for $APP_ENV"
fi

if [[ -z "${ALLOWED_ORIGINS:-}" ]]; then
    if [[ "$APP_ENV" == "production" ]]; then
        warn "ALLOWED_ORIGINS is not set -- CORS may block frontend requests"
    fi
else
    pass "ALLOWED_ORIGINS is set: $ALLOWED_ORIGINS"
    if [[ "$APP_ENV" == "production" && "$ALLOWED_ORIGINS" == *"localhost"* ]]; then
        warn "ALLOWED_ORIGINS contains 'localhost' in production"
    fi
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
printf "${BOLD}=== Validation Summary ===${NC}\n"
printf "  ${GREEN}Passed:${NC}   %d\n" "$PASS_COUNT"
printf "  ${YELLOW}Warnings:${NC} %d\n" "$WARN_COUNT"
printf "  ${RED}Failed:${NC}   %d\n" "$FAIL_COUNT"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    printf "${RED}${BOLD}Validation FAILED with %d error(s).${NC}\n" "$FAIL_COUNT"
    printf "Fix the issues above before running the application.\n"
    exit 1
elif [[ "$WARN_COUNT" -gt 0 ]]; then
    printf "${YELLOW}${BOLD}Validation passed with %d warning(s).${NC}\n" "$WARN_COUNT"
    printf "Review the warnings above, especially for non-development environments.\n"
    exit 0
else
    printf "${GREEN}${BOLD}All checks passed.${NC}\n"
    exit 0
fi

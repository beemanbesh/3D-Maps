#!/usr/bin/env bash
# =============================================================================
# Blue-Green Deployment Script for Docker Compose (Staging)
# 3D Development Visualization Platform
# =============================================================================
#
# Deploys a new version to the inactive color (blue or green), runs health
# checks, switches nginx upstream traffic, and keeps the old color running
# for instant rollback.
#
# Usage:
#   ./scripts/deploy-blue-green.sh <blue|green> [OPTIONS]
#   ./scripts/deploy-blue-green.sh --rollback
#
# Options:
#   --version, -v TAG    Image version tag (default: git short SHA)
#   --timeout, -t SECS   Health check timeout in seconds (default: 120)
#   --skip-build         Skip building images (use pre-built)
#   --rollback           Switch traffic back to the previous color
#   --dry-run            Print actions without executing
#   -h, --help           Show this help message
#
# Examples:
#   ./scripts/deploy-blue-green.sh green
#   ./scripts/deploy-blue-green.sh green --version v1.3.0
#   ./scripts/deploy-blue-green.sh --rollback
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.deploy-state"
NGINX_CONF_DIR="$PROJECT_ROOT/infrastructure/nginx"
NGINX_TEMPLATE="$NGINX_CONF_DIR/staging-bluegreen.conf"
NGINX_ACTIVE_CONF="$NGINX_CONF_DIR/staging.conf"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
COMPOSE_STAGING="$PROJECT_ROOT/docker-compose.staging.yml"
COMPOSE_BG="$PROJECT_ROOT/docker-compose.bluegreen.yml"
LOG_FILE="$PROJECT_ROOT/logs/deploy-$(date +%Y%m%d-%H%M%S).log"

HEALTH_CHECK_TIMEOUT=120
HEALTH_CHECK_INTERVAL=5
VERSION_TAG=""
SKIP_BUILD=false
ROLLBACK=false
DRY_RUN=false
TARGET_COLOR=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------

log() {
    local level="$1"
    shift
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    local msg="[$timestamp] [$level] $*"
    echo -e "$msg"
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

info()    { log "INFO"    "${GREEN}$*${NC}"; }
warn()    { log "WARN"    "${YELLOW}$*${NC}"; }
error()   { log "ERROR"   "${RED}$*${NC}"; }
step()    { log "STEP"    "${BLUE}>>>${NC} $*"; }

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<'USAGE'
Blue-Green Deployment Script for Docker Compose (Staging)

Usage:
  ./scripts/deploy-blue-green.sh <blue|green> [OPTIONS]
  ./scripts/deploy-blue-green.sh --rollback

Arguments:
  blue|green            Target color to deploy to (the inactive environment)

Options:
  --version, -v TAG     Image version tag (default: git short SHA)
  --timeout, -t SECS    Health check timeout in seconds (default: 120)
  --skip-build          Skip building images (use pre-built)
  --rollback            Switch traffic back to the previous active color
  --dry-run             Print actions without executing
  -h, --help            Show this help message

Examples:
  ./scripts/deploy-blue-green.sh green
  ./scripts/deploy-blue-green.sh green --version v1.3.0
  ./scripts/deploy-blue-green.sh blue --skip-build --timeout 60
  ./scripts/deploy-blue-green.sh --rollback
USAGE
    exit 0
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            blue|green)
                TARGET_COLOR="$1"
                shift
                ;;
            --version|-v)
                VERSION_TAG="$2"
                shift 2
                ;;
            --timeout|-t)
                HEALTH_CHECK_TIMEOUT="$2"
                shift 2
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --rollback)
                ROLLBACK=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                error "Unknown argument: $1"
                usage
                ;;
        esac
    done

    # Set default version tag from git
    if [[ -z "$VERSION_TAG" ]]; then
        VERSION_TAG="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "latest")"
    fi

    # Validate arguments
    if [[ "$ROLLBACK" == false && -z "$TARGET_COLOR" ]]; then
        error "Target color (blue or green) is required unless using --rollback."
        echo ""
        usage
    fi
}

# -----------------------------------------------------------------------------
# State Management
# -----------------------------------------------------------------------------

# Read the currently active color from the state file.
get_active_color() {
    if [[ -f "$STATE_FILE" ]]; then
        grep "^ACTIVE_COLOR=" "$STATE_FILE" | cut -d= -f2
    else
        echo ""
    fi
}

# Read the previous active color from the state file.
get_previous_color() {
    if [[ -f "$STATE_FILE" ]]; then
        grep "^PREVIOUS_COLOR=" "$STATE_FILE" | cut -d= -f2
    else
        echo ""
    fi
}

# Save deployment state.
save_state() {
    local active="$1"
    local previous="$2"
    local version="$3"
    cat > "$STATE_FILE" <<EOF
ACTIVE_COLOR=$active
PREVIOUS_COLOR=$previous
ACTIVE_VERSION=$version
DEPLOY_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOYER=$(whoami)
EOF
    info "State saved: active=$active, previous=$previous, version=$version"
}

# Return the opposite color.
opposite_color() {
    if [[ "$1" == "blue" ]]; then
        echo "green"
    else
        echo "blue"
    fi
}

# -----------------------------------------------------------------------------
# Docker Compose Helpers
# -----------------------------------------------------------------------------

compose_exec() {
    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] docker compose $*"
        return 0
    fi
    docker compose \
        -f "$COMPOSE_FILE" \
        -f "$COMPOSE_STAGING" \
        -f "$COMPOSE_BG" \
        "$@"
}

# -----------------------------------------------------------------------------
# Build Images
# -----------------------------------------------------------------------------

build_images() {
    local color="$1"
    local tag="$2"

    step "Building images for $color environment (tag: $tag)"

    if [[ "$SKIP_BUILD" == true ]]; then
        info "Skipping build (--skip-build flag set)"
        return 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would build backend and frontend images with tag $tag"
        return 0
    fi

    info "Building backend image: devplatform/backend:$tag"
    docker build \
        -t "devplatform/backend:$tag" \
        -f "$PROJECT_ROOT/infrastructure/docker/Dockerfile.backend" \
        "$PROJECT_ROOT/backend"

    info "Building frontend image: devplatform/frontend:$tag"
    docker build \
        -t "devplatform/frontend:$tag" \
        -f "$PROJECT_ROOT/infrastructure/docker/Dockerfile.frontend" \
        --build-arg NODE_ENV=production \
        "$PROJECT_ROOT/frontend"

    info "Images built successfully"
}

# -----------------------------------------------------------------------------
# Deploy to Target Color
# -----------------------------------------------------------------------------

deploy_to_color() {
    local color="$1"
    local tag="$2"

    step "Deploying version $tag to $color environment"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would deploy backend-$color, frontend-$color, celery-$color"
        return 0
    fi

    # Set the image tag as an environment variable for compose
    export DEPLOY_TAG="$tag"
    export DEPLOY_COLOR="$color"

    # Start or update the target color services
    compose_exec up -d \
        "backend-$color" \
        "frontend-$color" \
        "celery-$color"

    info "Services for $color environment started"
}

# -----------------------------------------------------------------------------
# Health Check
# -----------------------------------------------------------------------------

wait_for_health() {
    local color="$1"
    local timeout="$2"
    local elapsed=0

    step "Waiting for $color environment to become healthy (timeout: ${timeout}s)"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would wait for health checks on backend-$color"
        return 0
    fi

    while [[ $elapsed -lt $timeout ]]; do
        # Check backend health
        local backend_healthy=false
        if docker compose \
            -f "$COMPOSE_FILE" \
            -f "$COMPOSE_STAGING" \
            -f "$COMPOSE_BG" \
            exec -T "backend-$color" \
            curl -sf http://localhost:8000/api/v1/health > /dev/null 2>&1; then
            backend_healthy=true
        fi

        # Check frontend health
        local frontend_healthy=false
        if docker compose \
            -f "$COMPOSE_FILE" \
            -f "$COMPOSE_STAGING" \
            -f "$COMPOSE_BG" \
            exec -T "frontend-$color" \
            wget -q --spider http://localhost:5173/ 2>/dev/null; then
            frontend_healthy=true
        fi

        if [[ "$backend_healthy" == true && "$frontend_healthy" == true ]]; then
            info "Health checks passed for $color environment (${elapsed}s elapsed)"
            return 0
        fi

        info "Waiting... backend=$backend_healthy, frontend=$frontend_healthy (${elapsed}s/${timeout}s)"
        sleep "$HEALTH_CHECK_INTERVAL"
        elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
    done

    error "Health checks did not pass within ${timeout}s"
    return 1
}

# -----------------------------------------------------------------------------
# Nginx Traffic Switching
# -----------------------------------------------------------------------------

generate_nginx_conf() {
    local color="$1"

    step "Generating nginx configuration for $color upstream"

    local conf_content
    conf_content=$(cat <<NGINX_CONF
# =============================================================================
# Nginx -- Staging Blue-Green Configuration
# 3D Development Visualization Platform
# Auto-generated by deploy-blue-green.sh -- do not edit manually
# Active color: $color
# Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# =============================================================================

worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid       /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # -------------------------------------------------------------------------
    # Logging
    # -------------------------------------------------------------------------
    log_format main '\$remote_addr - \$remote_user [\$time_local] '
                    '"\$request" \$status \$body_bytes_sent '
                    '"\$http_referer" "\$http_user_agent" '
                    'rt=\$request_time slot=$color';

    access_log /var/log/nginx/access.log main;

    # -------------------------------------------------------------------------
    # Performance
    # -------------------------------------------------------------------------
    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout 65;

    # -------------------------------------------------------------------------
    # Gzip Compression
    # -------------------------------------------------------------------------
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_min_length 256;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        application/wasm
        image/svg+xml
        model/gltf-binary
        model/gltf+json;

    # -------------------------------------------------------------------------
    # Client body size -- allow large 3D model uploads
    # -------------------------------------------------------------------------
    client_max_body_size 100M;

    # -------------------------------------------------------------------------
    # Upstream: Active Backend (color: $color)
    # -------------------------------------------------------------------------
    upstream backend {
        server backend-${color}:8000;
    }

    # -------------------------------------------------------------------------
    # Upstream: Active Frontend (color: $color)
    # -------------------------------------------------------------------------
    upstream frontend {
        server frontend-${color}:5173;
    }

    # -------------------------------------------------------------------------
    # Server -- port 80
    # -------------------------------------------------------------------------
    server {
        listen 80;
        server_name _;

        # -----------------------------------------------------------------
        # Security Headers
        # -----------------------------------------------------------------
        add_header X-Frame-Options        "SAMEORIGIN"       always;
        add_header X-Content-Type-Options  "nosniff"          always;
        add_header X-XSS-Protection        "1; mode=block"    always;
        add_header Referrer-Policy         "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy      "camera=(), microphone=(), geolocation=()" always;
        add_header X-Deploy-Slot           "$color"           always;

        # -----------------------------------------------------------------
        # Frontend -- default location
        # -----------------------------------------------------------------
        location / {
            proxy_pass http://frontend;

            proxy_http_version 1.1;
            proxy_set_header Host              \$host;
            proxy_set_header X-Real-IP         \$remote_addr;
            proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # -----------------------------------------------------------------
        # Backend API
        # -----------------------------------------------------------------
        location /api {
            proxy_pass http://backend;

            proxy_http_version 1.1;
            proxy_set_header Host              \$host;
            proxy_set_header X-Real-IP         \$remote_addr;
            proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;

            # Increased timeouts for long-running 3D processing requests
            proxy_read_timeout    120s;
            proxy_connect_timeout 10s;
            proxy_send_timeout    120s;
        }

        # -----------------------------------------------------------------
        # WebSocket -- backend
        # -----------------------------------------------------------------
        location /ws {
            proxy_pass http://backend;

            proxy_http_version 1.1;
            proxy_set_header Upgrade           \$http_upgrade;
            proxy_set_header Connection        "upgrade";
            proxy_set_header Host              \$host;
            proxy_set_header X-Real-IP         \$remote_addr;
            proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;

            # WebSocket connections can be long-lived
            proxy_read_timeout  3600s;
            proxy_send_timeout  3600s;
        }

        # -----------------------------------------------------------------
        # Health check endpoint for the proxy itself
        # -----------------------------------------------------------------
        location /nginx-health {
            access_log off;
            return 200 "ok\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_CONF
)

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would write nginx config pointing to $color"
        return 0
    fi

    echo "$conf_content" > "$NGINX_ACTIVE_CONF"
    info "Nginx configuration written to $NGINX_ACTIVE_CONF"
}

reload_nginx() {
    step "Reloading nginx to apply traffic switch"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would reload nginx"
        return 0
    fi

    # Reload nginx inside the container
    docker compose \
        -f "$COMPOSE_FILE" \
        -f "$COMPOSE_STAGING" \
        -f "$COMPOSE_BG" \
        exec -T nginx nginx -s reload

    info "Nginx reloaded successfully"
}

# -----------------------------------------------------------------------------
# Verify Traffic
# -----------------------------------------------------------------------------

verify_traffic() {
    local color="$1"

    step "Verifying traffic is flowing to $color environment"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would verify traffic routing"
        return 0
    fi

    # Give nginx a moment to apply the reload
    sleep 2

    # Check that the backend health endpoint responds through nginx
    local response
    response=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost/api/v1/health 2>/dev/null || echo "000")

    if [[ "$response" == "200" ]]; then
        info "Traffic verification passed: backend responding through nginx (HTTP $response)"
    else
        warn "Traffic verification: backend returned HTTP $response (may need a moment to stabilize)"
    fi

    # Check the deploy slot header
    local slot_header
    slot_header=$(curl -sf -I http://localhost/ 2>/dev/null | grep -i "x-deploy-slot" | tr -d '\r' || echo "")

    if [[ -n "$slot_header" ]]; then
        info "Deploy slot header: $slot_header"
    fi

    # Check that the frontend responds
    local frontend_response
    frontend_response=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "000")

    if [[ "$frontend_response" == "200" ]]; then
        info "Frontend verification passed (HTTP $frontend_response)"
    else
        warn "Frontend returned HTTP $frontend_response"
    fi
}

# -----------------------------------------------------------------------------
# Rollback
# -----------------------------------------------------------------------------

do_rollback() {
    step "Starting rollback procedure"

    local previous_color
    previous_color="$(get_previous_color)"

    if [[ -z "$previous_color" ]]; then
        error "No previous deployment state found. Cannot rollback."
        error "State file not found at: $STATE_FILE"
        exit 1
    fi

    local current_color
    current_color="$(get_active_color)"

    info "Rolling back: $current_color -> $previous_color"

    # Generate nginx config for the previous color
    generate_nginx_conf "$previous_color"

    # Reload nginx
    reload_nginx

    # Verify traffic
    verify_traffic "$previous_color"

    # Update state (swap active and previous)
    save_state "$previous_color" "$current_color" "rollback"

    info "============================================="
    info "  ROLLBACK COMPLETE"
    info "  Active environment: $previous_color"
    info "  Previous environment: $current_color (still running)"
    info "============================================="
}

# -----------------------------------------------------------------------------
# Main Deployment Flow
# -----------------------------------------------------------------------------

do_deploy() {
    local color="$TARGET_COLOR"
    local current_active
    current_active="$(get_active_color)"

    # Validate that we are deploying to the inactive color
    if [[ "$current_active" == "$color" ]]; then
        warn "$color is already the ACTIVE environment."
        warn "You should deploy to $(opposite_color "$color") instead."
        read -r -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            info "Deployment cancelled."
            exit 0
        fi
    fi

    info "============================================="
    info "  BLUE-GREEN DEPLOYMENT"
    info "  Target: $color"
    info "  Version: $VERSION_TAG"
    info "  Current active: ${current_active:-none}"
    info "============================================="

    # Step 1: Build images
    build_images "$color" "$VERSION_TAG"

    # Step 2: Deploy to target color
    deploy_to_color "$color" "$VERSION_TAG"

    # Step 3: Wait for health checks
    if ! wait_for_health "$color" "$HEALTH_CHECK_TIMEOUT"; then
        error "Deployment FAILED: health checks did not pass."
        error "The $color environment is running but nginx has NOT been switched."
        error "Investigate the $color services, then either:"
        error "  - Fix the issue and re-run this script"
        error "  - Stop the $color services manually"
        exit 1
    fi

    # Step 4: Switch nginx upstream to new color
    generate_nginx_conf "$color"

    # Step 5: Ensure nginx is running, then reload
    # Start nginx if it is not already running
    compose_exec up -d nginx
    reload_nginx

    # Step 6: Verify traffic is flowing to the new version
    verify_traffic "$color"

    # Step 7: Save state (keep old color for rollback)
    save_state "$color" "${current_active:-$(opposite_color "$color")}" "$VERSION_TAG"

    info "============================================="
    info "  DEPLOYMENT COMPLETE"
    info "  Active environment: $color"
    info "  Version: $VERSION_TAG"
    if [[ -n "$current_active" ]]; then
        info "  Previous environment: $current_active (still running for rollback)"
    fi
    info "  Rollback command: $0 --rollback"
    info "============================================="
    info ""
    info "Monitor the deployment for at least 15 minutes."
    info "If issues arise, run: $0 --rollback"
}

# -----------------------------------------------------------------------------
# Entry Point
# -----------------------------------------------------------------------------

main() {
    parse_args "$@"

    info "Deploy script started (PID: $$)"
    info "Project root: $PROJECT_ROOT"
    info "Log file: $LOG_FILE"

    if [[ "$ROLLBACK" == true ]]; then
        do_rollback
    else
        do_deploy
    fi
}

main "$@"

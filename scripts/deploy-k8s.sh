#!/usr/bin/env bash
# =============================================================================
# Blue-Green Kubernetes Deployment Script
# 3D Development Visualization Platform
# =============================================================================
#
# Performs blue-green deployments on Kubernetes by updating the inactive slot's
# Deployment with a new container image, waiting for the rollout to complete,
# running smoke tests, and then patching the Service selector to switch traffic.
#
# Usage:
#   ./scripts/deploy-k8s.sh --image-tag <TAG> --slot <blue|green> [OPTIONS]
#   ./scripts/deploy-k8s.sh --rollback
#
# Options:
#   --image-tag, -i TAG     Container image tag to deploy (required unless --rollback)
#   --slot, -s SLOT         Target slot: blue or green (required unless --rollback)
#   --namespace, -n NS      Kubernetes namespace (default: devplatform)
#   --registry, -r REG      Container registry prefix (default: devplatform)
#   --timeout SECS          Rollout timeout in seconds (default: 180)
#   --smoke-test-url URL    URL for smoke test health check
#   --skip-smoke-tests      Skip smoke tests after rollout
#   --rollback              Revert to the previous slot
#   --dry-run               Print commands without executing
#   -h, --help              Show this help message
#
# Examples:
#   ./scripts/deploy-k8s.sh --image-tag v1.3.0 --slot green
#   ./scripts/deploy-k8s.sh --image-tag abc1234 --slot blue --namespace devplatform-staging
#   ./scripts/deploy-k8s.sh --rollback
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_BG_DIR="$PROJECT_ROOT/k8s/blue-green"

NAMESPACE="devplatform"
REGISTRY="devplatform"
IMAGE_TAG=""
TARGET_SLOT=""
ROLLOUT_TIMEOUT=180
SMOKE_TEST_URL=""
SKIP_SMOKE_TESTS=false
ROLLBACK=false
DRY_RUN=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Deployment log file
DEPLOY_LOG="$PROJECT_ROOT/logs/k8s-deploy-$(date +%Y%m%d-%H%M%S).log"

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
    mkdir -p "$(dirname "$DEPLOY_LOG")"
    echo "$msg" >> "$DEPLOY_LOG" 2>/dev/null || true
}

info()  { log "INFO"  "${GREEN}$*${NC}"; }
warn()  { log "WARN"  "${YELLOW}$*${NC}"; }
error() { log "ERROR" "${RED}$*${NC}"; }
step()  { log "STEP"  "${BLUE}>>>${NC} $*"; }
debug() { log "DEBUG" "${CYAN}$*${NC}"; }

# -----------------------------------------------------------------------------
# Usage
# -----------------------------------------------------------------------------

usage() {
    cat <<'USAGE'
Blue-Green Kubernetes Deployment Script

Usage:
  ./scripts/deploy-k8s.sh --image-tag <TAG> --slot <blue|green> [OPTIONS]
  ./scripts/deploy-k8s.sh --rollback

Required (unless --rollback):
  --image-tag, -i TAG     Container image tag to deploy
  --slot, -s SLOT         Target slot: blue or green

Options:
  --namespace, -n NS      Kubernetes namespace (default: devplatform)
  --registry, -r REG      Container registry prefix (default: devplatform)
  --timeout SECS          Rollout timeout in seconds (default: 180)
  --smoke-test-url URL    URL for smoke test health check
  --skip-smoke-tests      Skip smoke tests after rollout
  --rollback              Revert to the previous slot
  --dry-run               Print commands without executing
  -h, --help              Show this help message

Examples:
  ./scripts/deploy-k8s.sh --image-tag v1.3.0 --slot green
  ./scripts/deploy-k8s.sh --image-tag abc1234 --slot blue --timeout 300
  ./scripts/deploy-k8s.sh --rollback --namespace devplatform-staging
USAGE
    exit 0
}

# -----------------------------------------------------------------------------
# Argument Parsing
# -----------------------------------------------------------------------------

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --image-tag|-i)
                IMAGE_TAG="$2"
                shift 2
                ;;
            --slot|-s)
                TARGET_SLOT="$2"
                shift 2
                ;;
            --namespace|-n)
                NAMESPACE="$2"
                shift 2
                ;;
            --registry|-r)
                REGISTRY="$2"
                shift 2
                ;;
            --timeout)
                ROLLOUT_TIMEOUT="$2"
                shift 2
                ;;
            --smoke-test-url)
                SMOKE_TEST_URL="$2"
                shift 2
                ;;
            --skip-smoke-tests)
                SKIP_SMOKE_TESTS=true
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

    # Validate required arguments
    if [[ "$ROLLBACK" == false ]]; then
        if [[ -z "$IMAGE_TAG" ]]; then
            error "Missing required argument: --image-tag"
            echo ""
            usage
        fi
        if [[ -z "$TARGET_SLOT" ]]; then
            error "Missing required argument: --slot"
            echo ""
            usage
        fi
        if [[ "$TARGET_SLOT" != "blue" && "$TARGET_SLOT" != "green" ]]; then
            error "Invalid slot: $TARGET_SLOT (must be 'blue' or 'green')"
            exit 1
        fi
    fi
}

# -----------------------------------------------------------------------------
# Helper: kubectl wrapper
# -----------------------------------------------------------------------------

kube() {
    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] kubectl $*"
        return 0
    fi
    kubectl "$@"
}

# -----------------------------------------------------------------------------
# Helper: get the opposite slot
# -----------------------------------------------------------------------------

opposite_slot() {
    if [[ "$1" == "blue" ]]; then
        echo "green"
    else
        echo "blue"
    fi
}

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

preflight_checks() {
    step "Running pre-flight checks"

    # Check kubectl is available
    if ! command -v kubectl &>/dev/null; then
        error "kubectl is not installed or not in PATH"
        exit 1
    fi

    # Check cluster connectivity
    if [[ "$DRY_RUN" == false ]]; then
        if ! kubectl cluster-info &>/dev/null; then
            error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
            exit 1
        fi
        info "Cluster connection verified"

        # Check namespace exists
        if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
            error "Namespace '$NAMESPACE' does not exist"
            exit 1
        fi
        info "Namespace '$NAMESPACE' exists"
    fi
}

# -----------------------------------------------------------------------------
# Get Current State
# -----------------------------------------------------------------------------

get_active_slot() {
    kubectl get svc backend -n "$NAMESPACE" \
        -o jsonpath='{.spec.selector.slot}' 2>/dev/null || echo ""
}

get_previous_slot() {
    kubectl get svc backend -n "$NAMESPACE" \
        -o jsonpath='{.metadata.annotations.devplatform\.io/previous-slot}' 2>/dev/null || echo ""
}

get_deployment_image() {
    local slot="$1"
    kubectl get deployment "backend-$slot" -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "N/A"
}

print_current_state() {
    step "Current cluster state"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would query current cluster state"
        return 0
    fi

    local active_slot
    active_slot="$(get_active_slot)"
    local previous_slot
    previous_slot="$(get_previous_slot)"

    info "Active slot:   ${active_slot:-not set}"
    info "Previous slot: ${previous_slot:-not set}"

    # Show deployment status for both slots
    for slot in blue green; do
        local image
        image="$(get_deployment_image "$slot")"
        local ready
        ready=$(kubectl get deployment "backend-$slot" -n "$NAMESPACE" \
            -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local desired
        desired=$(kubectl get deployment "backend-$slot" -n "$NAMESPACE" \
            -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
        local status_marker=""
        if [[ "$slot" == "$active_slot" ]]; then
            status_marker=" (ACTIVE)"
        fi
        info "  backend-$slot: image=$image, ready=$ready/$desired$status_marker"
    done
}

# -----------------------------------------------------------------------------
# Update Deployment Image
# -----------------------------------------------------------------------------

update_deployment_image() {
    local slot="$1"
    local tag="$2"

    local backend_image="$REGISTRY/backend:$tag"
    local frontend_image="$REGISTRY/frontend:$tag"

    step "Updating backend-$slot image to $backend_image"

    kube set image deployment "backend-$slot" \
        -n "$NAMESPACE" \
        "backend=$backend_image"

    info "Deployment backend-$slot image updated"

    # Also update the frontend deployment if it exists as a blue-green resource
    if kubectl get deployment "frontend-$slot" -n "$NAMESPACE" &>/dev/null 2>&1; then
        step "Updating frontend-$slot image to $frontend_image"
        kube set image deployment "frontend-$slot" \
            -n "$NAMESPACE" \
            "frontend=$frontend_image"
        info "Deployment frontend-$slot image updated"
    fi
}

# -----------------------------------------------------------------------------
# Wait for Rollout
# -----------------------------------------------------------------------------

wait_for_rollout() {
    local slot="$1"

    step "Waiting for backend-$slot rollout to complete (timeout: ${ROLLOUT_TIMEOUT}s)"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would wait for rollout"
        return 0
    fi

    if ! kubectl rollout status deployment "backend-$slot" \
        -n "$NAMESPACE" \
        --timeout="${ROLLOUT_TIMEOUT}s"; then
        error "Rollout of backend-$slot did not complete within ${ROLLOUT_TIMEOUT}s"
        error "Check pod status:"
        kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/name=backend,slot=$slot" \
            -o wide
        error "Check events:"
        kubectl get events -n "$NAMESPACE" \
            --field-selector involvedObject.kind=Deployment,involvedObject.name="backend-$slot" \
            --sort-by='.lastTimestamp' | tail -10
        return 1
    fi

    info "Rollout of backend-$slot completed successfully"

    # Wait for frontend if it exists
    if kubectl get deployment "frontend-$slot" -n "$NAMESPACE" &>/dev/null 2>&1; then
        step "Waiting for frontend-$slot rollout to complete"
        if ! kubectl rollout status deployment "frontend-$slot" \
            -n "$NAMESPACE" \
            --timeout="${ROLLOUT_TIMEOUT}s"; then
            error "Rollout of frontend-$slot did not complete within ${ROLLOUT_TIMEOUT}s"
            return 1
        fi
        info "Rollout of frontend-$slot completed successfully"
    fi
}

# -----------------------------------------------------------------------------
# Smoke Tests
# -----------------------------------------------------------------------------

run_smoke_tests() {
    local slot="$1"

    step "Running smoke tests against $slot slot"

    if [[ "$SKIP_SMOKE_TESTS" == true ]]; then
        warn "Smoke tests skipped (--skip-smoke-tests flag)"
        return 0
    fi

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would run smoke tests"
        return 0
    fi

    local test_failures=0

    # Test 1: Check that pods are ready
    info "Smoke test 1/4: Pod readiness"
    local ready_pods
    ready_pods=$(kubectl get pods -n "$NAMESPACE" \
        -l "app.kubernetes.io/name=backend,slot=$slot" \
        -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' | tr ' ' '\n' | grep -c "True" || echo "0")

    if [[ "$ready_pods" -gt 0 ]]; then
        info "  PASS: $ready_pods pod(s) ready in $slot slot"
    else
        error "  FAIL: No ready pods in $slot slot"
        test_failures=$((test_failures + 1))
    fi

    # Test 2: Health check via port-forward
    info "Smoke test 2/4: Backend health endpoint"
    local pod_name
    pod_name=$(kubectl get pods -n "$NAMESPACE" \
        -l "app.kubernetes.io/name=backend,slot=$slot" \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [[ -n "$pod_name" ]]; then
        # Use kubectl exec to curl the health endpoint inside the pod
        local health_response
        health_response=$(kubectl exec "$pod_name" -n "$NAMESPACE" -c backend -- \
            curl -sf http://localhost:8000/api/v1/health 2>/dev/null || echo "FAIL")

        if [[ "$health_response" != "FAIL" ]]; then
            info "  PASS: Health endpoint responded successfully"
            debug "  Response: $health_response"
        else
            error "  FAIL: Health endpoint did not respond"
            test_failures=$((test_failures + 1))
        fi
    else
        error "  FAIL: No pod found for smoke test"
        test_failures=$((test_failures + 1))
    fi

    # Test 3: Check deployment image matches expected tag
    info "Smoke test 3/4: Image tag verification"
    local actual_image
    actual_image="$(get_deployment_image "$slot")"
    local expected_image="$REGISTRY/backend:$IMAGE_TAG"

    if [[ "$actual_image" == "$expected_image" ]]; then
        info "  PASS: Image tag matches ($IMAGE_TAG)"
    else
        warn "  WARN: Image mismatch (expected: $expected_image, actual: $actual_image)"
        # This is a warning, not a failure -- the image may have been set differently
    fi

    # Test 4: External smoke test URL if provided
    if [[ -n "$SMOKE_TEST_URL" ]]; then
        info "Smoke test 4/4: External URL check ($SMOKE_TEST_URL)"
        local external_response
        external_response=$(curl -sf -o /dev/null -w "%{http_code}" "$SMOKE_TEST_URL" 2>/dev/null || echo "000")

        if [[ "$external_response" == "200" ]]; then
            info "  PASS: External URL returned HTTP 200"
        else
            error "  FAIL: External URL returned HTTP $external_response"
            test_failures=$((test_failures + 1))
        fi
    else
        info "Smoke test 4/4: External URL check (skipped -- no --smoke-test-url provided)"
    fi

    # Report results
    echo ""
    if [[ $test_failures -gt 0 ]]; then
        error "Smoke tests: $test_failures failure(s) detected"
        error "Traffic will NOT be switched. Fix the issues and re-deploy."
        return 1
    else
        info "Smoke tests: All tests passed"
        return 0
    fi
}

# -----------------------------------------------------------------------------
# Switch Traffic
# -----------------------------------------------------------------------------

switch_traffic() {
    local new_slot="$1"
    local old_slot="$2"

    step "Switching traffic: $old_slot -> $new_slot"

    local switch_timestamp
    switch_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    # Patch the backend service
    kube patch svc backend -n "$NAMESPACE" --type=merge -p \
        "{
          \"spec\": {
            \"selector\": {
              \"slot\": \"$new_slot\"
            }
          },
          \"metadata\": {
            \"annotations\": {
              \"devplatform.io/active-slot\": \"$new_slot\",
              \"devplatform.io/previous-slot\": \"$old_slot\",
              \"devplatform.io/last-switch\": \"$switch_timestamp\",
              \"devplatform.io/switch-reason\": \"deployment\",
              \"devplatform.io/image-tag\": \"$IMAGE_TAG\"
            }
          }
        }"

    info "Backend service selector updated to slot=$new_slot"

    # Patch the frontend service
    kube patch svc frontend -n "$NAMESPACE" --type=merge -p \
        "{
          \"spec\": {
            \"selector\": {
              \"slot\": \"$new_slot\"
            }
          },
          \"metadata\": {
            \"annotations\": {
              \"devplatform.io/active-slot\": \"$new_slot\",
              \"devplatform.io/previous-slot\": \"$old_slot\",
              \"devplatform.io/last-switch\": \"$switch_timestamp\",
              \"devplatform.io/switch-reason\": \"deployment\",
              \"devplatform.io/image-tag\": \"$IMAGE_TAG\"
            }
          }
        }"

    info "Frontend service selector updated to slot=$new_slot"
}

# -----------------------------------------------------------------------------
# Log Deployment Event
# -----------------------------------------------------------------------------

log_deployment_event() {
    local slot="$1"
    local tag="$2"
    local status="$3"

    step "Logging deployment event"

    if [[ "$DRY_RUN" == true ]]; then
        info "[DRY RUN] Would log deployment event"
        return 0
    fi

    local event_timestamp
    event_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    # Create a ConfigMap to record the deployment event
    # This provides an audit trail queryable via kubectl
    local event_name="deploy-event-$(date +%Y%m%d-%H%M%S)"

    kube create configmap "$event_name" \
        -n "$NAMESPACE" \
        --from-literal="timestamp=$event_timestamp" \
        --from-literal="slot=$slot" \
        --from-literal="image-tag=$tag" \
        --from-literal="status=$status" \
        --from-literal="deployer=$(whoami)" \
        --from-literal="host=$(hostname)" \
        2>/dev/null || true

    # Label the event ConfigMap for easy querying
    kube label configmap "$event_name" \
        -n "$NAMESPACE" \
        "app.kubernetes.io/component=deploy-event" \
        "app.kubernetes.io/part-of=3d-development-platform" \
        2>/dev/null || true

    info "Deployment event logged: $event_name"
    info "  Query events: kubectl get cm -n $NAMESPACE -l app.kubernetes.io/component=deploy-event"
}

# -----------------------------------------------------------------------------
# Rollback
# -----------------------------------------------------------------------------

do_rollback() {
    step "Starting rollback procedure"

    preflight_checks

    if [[ "$DRY_RUN" == false ]]; then
        local current_slot
        current_slot="$(get_active_slot)"
        local previous_slot
        previous_slot="$(get_previous_slot)"

        if [[ -z "$previous_slot" ]]; then
            error "No previous slot annotation found. Cannot determine rollback target."
            error "Set it manually:"
            error "  kubectl patch svc backend -n $NAMESPACE -p '{\"spec\":{\"selector\":{\"slot\":\"blue\"}}}'"
            exit 1
        fi

        if [[ "$previous_slot" == "$current_slot" ]]; then
            warn "Previous slot ($previous_slot) is the same as current slot ($current_slot)."
            warn "Nothing to rollback."
            exit 0
        fi

        info "Rolling back: $current_slot -> $previous_slot"

        # Verify the rollback target has healthy pods
        local ready_pods
        ready_pods=$(kubectl get pods -n "$NAMESPACE" \
            -l "app.kubernetes.io/name=backend,slot=$previous_slot" \
            -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' | tr ' ' '\n' | grep -c "True" || echo "0")

        if [[ "$ready_pods" -eq 0 ]]; then
            error "No ready pods in the $previous_slot slot. Rollback target is not healthy."
            error "Check the $previous_slot deployment and fix any issues first."
            exit 1
        fi

        info "Rollback target ($previous_slot) has $ready_pods ready pod(s)"

        # Set IMAGE_TAG for the switch_traffic function annotation
        IMAGE_TAG="rollback-to-$previous_slot"

        # Switch traffic
        switch_traffic "$previous_slot" "$current_slot"

        # Log the rollback event
        log_deployment_event "$previous_slot" "rollback" "success"

        print_current_state

        info "============================================="
        info "  ROLLBACK COMPLETE"
        info "  Active slot: $previous_slot"
        info "  Previous slot: $current_slot (still running)"
        info "============================================="
    else
        info "[DRY RUN] Would perform rollback"
    fi
}

# -----------------------------------------------------------------------------
# Main Deployment Flow
# -----------------------------------------------------------------------------

do_deploy() {
    preflight_checks
    print_current_state

    local current_active
    if [[ "$DRY_RUN" == false ]]; then
        current_active="$(get_active_slot)"
    else
        current_active="unknown"
    fi

    # Warn if deploying to the active slot
    if [[ "$current_active" == "$TARGET_SLOT" && "$DRY_RUN" == false ]]; then
        warn "$TARGET_SLOT is currently the ACTIVE slot receiving traffic."
        warn "You should deploy to $(opposite_slot "$TARGET_SLOT") instead."
        warn "Continuing will update the live deployment in-place."
        read -r -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            info "Deployment cancelled."
            exit 0
        fi
    fi

    echo ""
    info "============================================="
    info "  KUBERNETES BLUE-GREEN DEPLOYMENT"
    info "  Target slot: $TARGET_SLOT"
    info "  Image tag:   $IMAGE_TAG"
    info "  Namespace:   $NAMESPACE"
    info "  Registry:    $REGISTRY"
    info "  Current active: ${current_active:-none}"
    info "============================================="
    echo ""

    # Step 1: Update the inactive slot's deployment image
    update_deployment_image "$TARGET_SLOT" "$IMAGE_TAG"

    # Step 2: Wait for the rollout to complete
    if ! wait_for_rollout "$TARGET_SLOT"; then
        error "Deployment FAILED at rollout stage."
        error "Traffic has NOT been switched. The $current_active slot is still active."
        log_deployment_event "$TARGET_SLOT" "$IMAGE_TAG" "failed-rollout"
        exit 1
    fi

    # Step 3: Run smoke tests
    if ! run_smoke_tests "$TARGET_SLOT"; then
        error "Deployment FAILED at smoke test stage."
        error "Traffic has NOT been switched. The $current_active slot is still active."
        error "Fix the issues, then either:"
        error "  - Re-run: $0 --image-tag $IMAGE_TAG --slot $TARGET_SLOT"
        error "  - Roll back the deployment image: kubectl rollout undo deployment/backend-$TARGET_SLOT -n $NAMESPACE"
        log_deployment_event "$TARGET_SLOT" "$IMAGE_TAG" "failed-smoke-tests"
        exit 1
    fi

    # Step 4: Patch the service selector to point to the new slot
    local old_slot="${current_active:-$(opposite_slot "$TARGET_SLOT")}"
    switch_traffic "$TARGET_SLOT" "$old_slot"

    # Step 5: Log deployment event
    log_deployment_event "$TARGET_SLOT" "$IMAGE_TAG" "success"

    # Final state
    echo ""
    print_current_state

    echo ""
    info "============================================="
    info "  DEPLOYMENT COMPLETE"
    info "  Active slot:     $TARGET_SLOT"
    info "  Image tag:       $IMAGE_TAG"
    info "  Previous slot:   $old_slot (still running for rollback)"
    info "  Rollback:        $0 --rollback -n $NAMESPACE"
    info "============================================="
    info ""
    info "Monitor the deployment for at least 15 minutes."
    info "If issues arise, run: $0 --rollback -n $NAMESPACE"
}

# -----------------------------------------------------------------------------
# Entry Point
# -----------------------------------------------------------------------------

main() {
    parse_args "$@"

    info "Kubernetes deploy script started (PID: $$)"
    info "Log file: $DEPLOY_LOG"

    if [[ "$ROLLBACK" == true ]]; then
        do_rollback
    else
        do_deploy
    fi
}

main "$@"

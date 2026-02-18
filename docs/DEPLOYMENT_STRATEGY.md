# Blue-Green / Rolling Deployment Strategy

## 3D Development Visualization Platform

---

## Table of Contents

1. [Overview](#overview)
2. [How Blue-Green Deployment Works](#how-blue-green-deployment-works)
3. [Deployment Steps](#deployment-steps)
4. [Docker Compose Approach](#docker-compose-approach)
5. [Kubernetes Approach](#kubernetes-approach)
6. [ECS / AWS Approach](#ecs--aws-approach)
7. [Rollback Procedures](#rollback-procedures)
8. [Database Migration Strategy](#database-migration-strategy)
9. [Health Check Requirements](#health-check-requirements)
10. [Monitoring and Verification](#monitoring-and-verification)

---

## Overview

This platform uses a **blue-green deployment** strategy to achieve zero-downtime releases. The
core idea is to maintain two identical production environments -- referred to as **blue** and
**green** -- where only one environment serves live traffic at any given time. New releases are
deployed to the inactive environment, validated, and then traffic is switched over. If anything
goes wrong, traffic can be instantly reverted to the previous environment.

### Why Blue-Green?

The 3D Development Visualization Platform handles real-time WebSocket connections for
collaborative 3D editing, long-running Celery tasks for model processing, and large file
uploads (GLB/GLTF models up to 100 MB). A traditional rolling update risks dropping active
WebSocket sessions or interrupting in-progress uploads. Blue-green deployment ensures:

- **Zero downtime** -- Users never see a maintenance page.
- **Instant rollback** -- If the new version has issues, reverting is a single traffic switch
  (typically under 5 seconds).
- **Full pre-production validation** -- Smoke tests run against the new version in the real
  environment before any user traffic reaches it.
- **Predictable releases** -- The deployment process is the same every time, regardless of the
  change size.

### Supported Deployment Targets

| Target | Mechanism | Script |
|--------|-----------|--------|
| Docker Compose (staging) | Nginx upstream swap | `scripts/deploy-blue-green.sh` |
| Kubernetes | Service selector patch | `scripts/deploy-k8s.sh` |
| AWS ECS (Fargate) | CodeDeploy blue/green with ALB target groups | Terraform + CodeDeploy |

---

## How Blue-Green Deployment Works

```
                    +-------------------+
                    |   Load Balancer   |
                    |  (ALB / Nginx)    |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+          +--------v--------+
     |   Blue Env       |          |   Green Env      |
     |   (v1.2.0)       |          |   (v1.3.0)       |
     |   ACTIVE          |          |   INACTIVE       |
     |                   |          |                   |
     |  backend-blue     |          |  backend-green    |
     |  frontend-blue    |          |  frontend-green   |
     |  celery-blue      |          |  celery-green     |
     +-------------------+          +-------------------+
              |                             |
              +-------------+---------------+
                            |
                   +--------v--------+
                   |  Shared Services |
                   |  - PostgreSQL    |
                   |  - Redis         |
                   |  - MinIO / S3    |
                   +-----------------+
```

Key points:
- **Blue** and **Green** are two complete sets of application containers (backend, frontend,
  celery workers).
- **Shared services** (database, Redis, object storage) are NOT duplicated -- both environments
  connect to the same data layer.
- The **load balancer** (ALB in AWS, Nginx in Docker Compose, Service selector in Kubernetes)
  controls which environment receives live traffic.
- At any given time, one environment is **active** (serving traffic) and the other is
  **inactive** (idle or being updated).

---

## Deployment Steps

Every deployment follows this sequence regardless of the infrastructure target:

### Step 1: Identify the Inactive Environment

Determine which slot (blue or green) is currently NOT serving traffic. This is the
**deployment target**.

```bash
# Docker Compose: check which upstream nginx is pointing to
grep "server backend-" infrastructure/nginx/staging-bluegreen.conf

# Kubernetes: check the service selector
kubectl get svc backend -n devplatform -o jsonpath='{.spec.selector.slot}'

# ECS: check which target group is active on the ALB listener
aws elbv2 describe-listeners --load-balancer-arn $ALB_ARN \
  --query 'Listeners[0].DefaultAction.TargetGroupArn'
```

### Step 2: Deploy New Version to Inactive Environment

Build and push new container images, then deploy them to the inactive slot.

```bash
# Tag images with version
docker build -t devplatform/backend:v1.3.0 ./backend
docker build -t devplatform/frontend:v1.3.0 ./frontend

# Deploy to inactive slot (example: green)
# Docker Compose:
./scripts/deploy-blue-green.sh green

# Kubernetes:
./scripts/deploy-k8s.sh --image-tag v1.3.0 --slot green
```

### Step 3: Run Smoke Tests Against Inactive Environment

Before switching traffic, validate the new deployment:

```bash
# Health check
curl -f http://backend-green:8000/api/v1/health

# API smoke tests
curl -f http://backend-green:8000/api/v1/projects
curl -f http://frontend-green:5173/

# WebSocket connectivity test
wscat -c ws://backend-green:8000/ws/test
```

Smoke tests must verify:
- Backend health endpoint returns 200
- Database connectivity (the health endpoint checks this)
- Redis connectivity
- S3/MinIO connectivity
- Frontend serves the application shell
- WebSocket upgrade succeeds
- API version header matches expected version

### Step 4: Switch Traffic

Once smoke tests pass, update the load balancer to route traffic to the new environment.

```bash
# Docker Compose: swap nginx upstream, reload
# Kubernetes: patch service selector
# ECS: CodeDeploy shifts traffic via ALB target group
```

### Step 5: Monitor for Errors

After the traffic switch, closely monitor for 5-15 minutes:

- HTTP 5xx error rate (should remain below 0.1%)
- API response time P95 (should stay under 2 seconds)
- WebSocket connection success rate
- Celery task failure rate
- Application logs for new exceptions

### Step 6: Rollback if Needed

If monitoring reveals issues, immediately switch traffic back to the previous environment:

```bash
# Docker Compose:
./scripts/deploy-blue-green.sh --rollback

# Kubernetes:
./scripts/deploy-k8s.sh --rollback

# ECS: CodeDeploy automatic rollback or manual target group switch
```

### Step 7: Decommission Old Version (Optional)

After the new version has been stable for a defined bake period (recommended: 1 hour minimum),
the old environment can be scaled down or left idle for emergency rollback.

---

## Docker Compose Approach

### Architecture

In the Docker Compose staging environment, blue-green is implemented using **duplicate service
definitions** with color-suffixed names and an **nginx upstream swap** to switch traffic.

### Service Naming Convention

| Service | Blue Name | Green Name |
|---------|-----------|------------|
| Backend API | `backend-blue` | `backend-green` |
| Frontend | `frontend-blue` | `frontend-green` |
| Celery Worker | `celery-blue` | `celery-green` |

### Nginx Upstream Configuration

The nginx config uses a templated upstream that points to the active color:

```nginx
# Active backend (switched during deployment)
upstream backend_active {
    server backend-blue:8000;    # <-- swap to backend-green:8000
}

upstream frontend_active {
    server frontend-blue:5173;   # <-- swap to frontend-green:5173
}
```

During deployment, the script:
1. Generates a new nginx config with the target color's upstream servers.
2. Copies it into the nginx container.
3. Sends `nginx -s reload` to apply the change without downtime.

### Usage

```bash
# Deploy to green (assuming blue is currently active)
./scripts/deploy-blue-green.sh green

# Deploy to blue (assuming green is currently active)
./scripts/deploy-blue-green.sh blue

# Rollback to previous color
./scripts/deploy-blue-green.sh --rollback
```

See `scripts/deploy-blue-green.sh` for the full implementation.

---

## Kubernetes Approach

### Architecture

In Kubernetes, blue-green is implemented using **label selectors** on the Service resource.
Both blue and green Deployments run simultaneously, but the Service's `spec.selector.slot`
field determines which set of pods receives traffic.

### Resources

```
k8s/blue-green/
  backend-blue.yaml      # Deployment: app=backend, slot=blue
  backend-green.yaml     # Deployment: app=backend, slot=green
  switch-traffic.yaml    # Service definition with configurable selector
  rollback.yaml          # Job to revert service selector
```

### How It Works

1. Both `backend-blue` and `backend-green` Deployments exist in the cluster.
2. The `backend` Service has a selector that includes `slot: blue` (or `slot: green`).
3. To deploy a new version, update the inactive Deployment's image.
4. Once the new pods are healthy, patch the Service selector to the new slot.

```bash
# Switch traffic from blue to green
kubectl patch svc backend -n devplatform \
  -p '{"spec":{"selector":{"slot":"green"}}}'

# Switch traffic from green to blue (rollback)
kubectl patch svc backend -n devplatform \
  -p '{"spec":{"selector":{"slot":"blue"}}}'
```

### Usage

```bash
# Deploy v1.3.0 to the green slot
./scripts/deploy-k8s.sh --image-tag v1.3.0 --slot green

# Rollback to previous slot
./scripts/deploy-k8s.sh --rollback
```

See `scripts/deploy-k8s.sh` for the full implementation.

---

## ECS / AWS Approach

### Architecture

On AWS ECS with Fargate, blue-green deployment is implemented using **AWS CodeDeploy** with
two ALB target groups. CodeDeploy manages the traffic shift between the blue and green target
groups, with optional canary or linear traffic shifting.

### How It Works

1. Two ALB target groups are provisioned (blue and green) for each service.
2. The ECS service is configured with a CodeDeploy deployment controller.
3. When a new task definition is registered, CodeDeploy creates a new task set in the
   replacement (green) target group.
4. CodeDeploy shifts traffic according to the configured strategy:
   - **AllAtOnce** -- Instant switch (fastest, highest risk).
   - **Linear10PercentEvery1Minute** -- Gradual shift over 10 minutes.
   - **Canary10Percent5Minutes** -- 10% canary for 5 minutes, then full switch.
5. If CloudWatch alarms trigger during the shift, CodeDeploy automatically rolls back.

### Terraform Configuration

The existing `terraform/ecs.tf` already provisions:
- ECS cluster with Fargate capacity providers
- Task definitions for backend, frontend, and celery
- ALB with target groups and listener rules
- Deployment circuit breaker with automatic rollback

To enable full blue-green with CodeDeploy, the following additions are needed:

```hcl
# Second target group for blue-green
resource "aws_lb_target_group" "backend_green" {
  name        = "${local.name_prefix}-backend-green-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path     = "/api/v1/health"
    matcher  = "200"
    interval = 30
  }
}

# CodeDeploy application
resource "aws_codedeploy_app" "main" {
  compute_platform = "ECS"
  name             = "${local.name_prefix}-deploy"
}

# CodeDeploy deployment group
resource "aws_codedeploy_deployment_group" "backend" {
  app_name               = aws_codedeploy_app.main.name
  deployment_group_name  = "${local.name_prefix}-backend"
  service_role_arn       = aws_iam_role.codedeploy.arn
  deployment_config_name = "CodeDeployDefault.ECSCanary10Percent5Minutes"

  ecs_service {
    cluster_name = aws_ecs_cluster.main.name
    service_name = aws_ecs_service.backend.name
  }

  blue_green_deployment_config {
    terminate_blue_instances_on_deployment_success {
      action                           = "TERMINATE"
      termination_wait_time_in_minutes = 60
    }

    deployment_ready_option {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_lb_listener.https.arn]
      }
      target_group {
        name = aws_lb_target_group.backend.name
      }
      target_group {
        name = aws_lb_target_group.backend_green.name
      }
    }
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }

  alarm_configuration {
    alarms  = [aws_cloudwatch_metric_alarm.backend_5xx.name]
    enabled = true
  }
}
```

### Triggering a Deployment

```bash
# Register new task definition
aws ecs register-task-definition --cli-input-json file://task-def.json

# Create CodeDeploy deployment
aws deploy create-deployment \
  --application-name devplatform-deploy \
  --deployment-group-name devplatform-backend \
  --revision '{"revisionType":"AppSpecContent","appSpecContent":{"content":"{...}"}}'
```

---

## Rollback Procedures

### Immediate Rollback (All Targets)

Rollback is always a traffic switch back to the previous environment. No containers need to
be rebuilt or redeployed.

| Target | Rollback Time | Method |
|--------|---------------|--------|
| Docker Compose | < 5 seconds | Swap nginx upstream back, reload |
| Kubernetes | < 5 seconds | Patch service selector back |
| ECS / CodeDeploy | < 30 seconds | CodeDeploy rollback or manual target group switch |

### Docker Compose Rollback

```bash
./scripts/deploy-blue-green.sh --rollback
```

This reads the previous active color from the state file and switches nginx back to it.

### Kubernetes Rollback

```bash
./scripts/deploy-k8s.sh --rollback
```

Or manually:

```bash
# Read previous slot from the annotation
PREV=$(kubectl get svc backend -n devplatform \
  -o jsonpath='{.metadata.annotations.devplatform\.io/previous-slot}')

kubectl patch svc backend -n devplatform \
  -p "{\"spec\":{\"selector\":{\"slot\":\"$PREV\"}}}"
```

### ECS Rollback

```bash
# CodeDeploy automatic rollback (triggered by alarm)
# Or manual:
aws deploy stop-deployment --deployment-id $DEPLOYMENT_ID --auto-rollback-enabled
```

### When to Rollback

Trigger an immediate rollback if any of the following occur within 15 minutes of deployment:

- HTTP 5xx error rate exceeds 1%
- API P95 latency exceeds 5 seconds
- Health check failures on more than 1 pod/task
- WebSocket connection failure rate exceeds 5%
- Celery task failure rate doubles compared to pre-deployment baseline
- Any critical error in application logs that was not present before deployment

---

## Database Migration Strategy

### Backward-Compatible Migrations Only

Because both blue and green environments share the same database, **all schema migrations must
be backward-compatible**. This means the old version of the application must continue to
function correctly with the new schema.

### Rules for Safe Migrations

1. **Adding a column** -- Always add with a DEFAULT value or as NULLABLE. The old code will
   simply ignore the new column.

2. **Removing a column** -- Never drop a column in the same release that stops using it. Use
   a two-phase approach:
   - Release N: Deploy code that no longer reads/writes the column.
   - Release N+1: Drop the column via migration.

3. **Renaming a column** -- Never rename directly. Instead:
   - Release N: Add the new column, backfill data, update code to write to both columns.
   - Release N+1: Update code to read only from the new column.
   - Release N+2: Drop the old column.

4. **Adding a table** -- Safe. The old code does not reference it.

5. **Changing a column type** -- Treat as a rename (create new column, migrate data, drop old).

6. **Adding an index** -- Safe. Use `CREATE INDEX CONCURRENTLY` to avoid table locks.

7. **Adding a NOT NULL constraint** -- Two-phase:
   - Release N: Add the column as nullable with a default, backfill existing rows.
   - Release N+1: Add the NOT NULL constraint.

### Migration Execution

Migrations are run **before** deploying to the inactive environment:

```bash
# Run migrations against the shared database
docker compose exec backend alembic upgrade head

# Or in Kubernetes
kubectl exec -n devplatform deploy/backend-blue -- alembic upgrade head
```

This ensures the database schema is ready before any new code runs against it.

---

## Health Check Requirements

All services must implement health checks that validate their dependencies. The deployment
scripts rely on these endpoints to determine when a new deployment is ready to receive traffic.

### Backend API Health Check

**Endpoint:** `GET /api/v1/health`
**Expected Response:** HTTP 200

```json
{
  "status": "healthy",
  "version": "1.3.0",
  "checks": {
    "database": "connected",
    "redis": "connected",
    "storage": "connected"
  }
}
```

The health check must verify:
- PostgreSQL connection is active and responsive
- Redis connection is active
- S3/MinIO is reachable
- Application version matches expected deployment version

### Frontend Health Check

**Endpoint:** `GET /` (returns the SPA shell)
**Expected Response:** HTTP 200 with HTML content

### Celery Worker Health Check

**Command:** `celery -A app.tasks.worker inspect ping`
**Expected Response:** Worker responds to ping within 10 seconds.

### Health Check Timing

| Parameter | Backend | Frontend | Celery |
|-----------|---------|----------|--------|
| Initial delay | 15s | 5s | 30s |
| Interval | 10s | 10s | 30s |
| Timeout | 5s | 3s | 10s |
| Failure threshold | 3 | 3 | 3 |
| Success threshold | 1 | 1 | 1 |

### Deployment Readiness Gate

The deployment scripts wait for health checks to pass before switching traffic. The maximum
wait time is **120 seconds** (configurable). If health checks do not pass within this window,
the deployment is aborted and no traffic switch occurs.

---

## Monitoring and Verification

### Pre-Deployment Checklist

- [ ] All migrations are backward-compatible
- [ ] Migration has been tested against a copy of production data
- [ ] Docker images have been built and pushed to the registry
- [ ] Smoke test suite is up to date
- [ ] On-call engineer is aware of the deployment
- [ ] Rollback procedure has been reviewed

### Post-Deployment Monitoring

Monitor the following for at least 15 minutes after traffic switch:

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| HTTP 5xx rate | ALB / Nginx logs | > 1% of requests |
| API P95 latency | Application metrics | > 2 seconds |
| WebSocket disconnects | Application metrics | > 5% increase |
| Celery task failures | Celery Flower / CloudWatch | > 2x baseline |
| Memory usage | Container metrics | > 80% of limit |
| CPU usage | Container metrics | > 70% sustained |
| Pod/task restarts | Kubernetes / ECS | Any unexpected restarts |

### Deployment Log

Every deployment should be logged with:
- Timestamp
- Deployer identity
- Previous version and new version
- Active slot before and after
- Smoke test results
- Any issues encountered

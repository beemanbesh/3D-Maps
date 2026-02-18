# Backup and Disaster Recovery Plan

**Platform:** 3D Development Visualization Platform
**Namespace:** `devplatform`
**Last Updated:** 2026-02-16
**Document Owner:** Platform Engineering Team
**Review Cadence:** Quarterly

---

## Table of Contents

1. [Overview](#overview)
2. [Backup Strategy](#backup-strategy)
3. [Backup Schedule](#backup-schedule)
4. [Restore Procedures](#restore-procedures)
5. [RPO and RTO Targets](#rpo-and-rto-targets)
6. [Disaster Scenarios and Responses](#disaster-scenarios-and-responses)
7. [Testing Plan](#testing-plan)
8. [Monitoring and Alerting](#monitoring-and-alerting)
9. [Runbook Contacts](#runbook-contacts)

---

## Overview

This document defines the backup strategy, disaster recovery procedures, and business continuity plan for the 3D Development Visualization Platform. The platform consists of the following stateful services:

| Service | Image | Role | Data Criticality |
|---------|-------|------|------------------|
| **PostgreSQL** (PostGIS 15-3.4) | `postgis/postgis:15-3.4` | Primary relational database with geospatial extensions | **Critical** -- user data, project metadata, spatial models |
| **MinIO** | `minio/minio:latest` | S3-compatible object storage for 3D assets, textures, and uploads | **Critical** -- binary assets, uploaded files |
| **Redis** (7.2 Alpine) | `redis:7.2-alpine` | Cache layer, Celery task broker, session storage | **Medium** -- ephemeral cache, but task queue state matters |

Stateless services (backend API, Celery workers, frontend) are deployed from container images and do not require data-level backups. Their configuration is managed through Kubernetes ConfigMaps (`devplatform-config`), Secrets (`devplatform-secrets`), and version-controlled manifests in the `k8s/` directory.

### Guiding Principles

- **Automate everything.** All backups run on cron schedules with no manual intervention.
- **Encrypt at rest and in transit.** Backup files are encrypted before upload to remote storage.
- **Test restores, not just backups.** A backup that has never been restored is not a backup.
- **Defense in depth.** Multiple backup methods overlap to cover different failure modes.

---

## Backup Strategy

### 2.1 PostgreSQL

PostgreSQL is the most critical data store. It holds all user accounts, project definitions, 3D model metadata, spatial geometries (via PostGIS), and application state.

#### Automated Daily Dumps (`pg_dump`)

- **Tool:** `pg_dump` with custom format (`-Fc`) for parallel restore support.
- **Frequency:** Daily at 02:00 UTC.
- **Script:** [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh)
- **Compression:** gzip applied after dump.
- **Upload Target:** S3 bucket `s3://devplatform-backups/postgres/daily/`.
- **Retention:** 30 daily backups. Older backups are automatically pruned from S3 after each successful run.
- **Naming Convention:** `dev_platform_YYYY-MM-DD_HHMMSS.dump.gz`

#### WAL Archiving for Point-in-Time Recovery (PITR)

- **Mechanism:** PostgreSQL continuous archiving via `archive_command` shipping WAL segments to S3.
- **Configuration** (add to `postgresql.conf` or StatefulSet env):
  ```
  wal_level = replica
  archive_mode = on
  archive_command = 'aws s3 cp %p s3://devplatform-backups/postgres/wal/%f --sse AES256'
  archive_timeout = 300
  ```
- **Recovery:** WAL segments allow restoring the database to any point in time after the most recent base backup, down to individual transactions.
- **Retention:** WAL archives retained for 7 days beyond the oldest retained daily backup (effectively 37 days).

#### Configuration Notes

The database connection parameters are sourced from Kubernetes:
- **Host:** `postgres` (ClusterIP service in `devplatform` namespace)
- **Port:** `5432`
- **Database:** `dev_platform`
- **User:** `devuser`
- **Password:** From `devplatform-secrets` -> `POSTGRES_PASSWORD`

### 2.2 MinIO / S3 Object Storage

MinIO stores all binary assets: uploaded 3D models (glTF, OBJ, FBX), generated textures, thumbnails, and processed outputs from Celery workers.

#### Cross-Region Replication

- **Method:** MinIO server-side bucket replication to a secondary MinIO cluster (or AWS S3 bucket) in a different availability zone or region.
- **Configuration:**
  ```bash
  # Add replication remote
  mc alias set backup-region https://backup-minio.example.com ACCESS_KEY SECRET_KEY

  # Enable replication on the primary bucket
  mc replicate add primary/dev-platform-uploads \
    --remote-bucket backup-region/dev-platform-uploads-replica \
    --replicate "delete,delete-marker,existing-objects"
  ```
- **Versioning:** Enabled on both source and destination buckets.
  ```bash
  mc version enable primary/dev-platform-uploads
  mc version enable backup-region/dev-platform-uploads-replica
  ```
- **Lifecycle Rules:** Non-current versions retained for 90 days, then expired.

#### Periodic Mirror Sync

- **Tool:** `mc mirror` via [`scripts/backup-minio.sh`](../scripts/backup-minio.sh)
- **Frequency:** Every 6 hours.
- **Purpose:** Acts as a secondary backup mechanism independent of replication. Validates integrity via checksums.
- **Target:** `s3://devplatform-backups/minio-mirror/`

### 2.3 Redis

Redis serves as both the application cache and the Celery task broker. While cache data is ephemeral, in-flight task state has operational value.

#### AOF Persistence

- **Configuration:**
  ```
  appendonly yes
  appendfsync everysec
  auto-aof-rewrite-percentage 100
  auto-aof-rewrite-min-size 64mb
  ```
- **Effect:** Every write operation is logged to an append-only file. On restart, Redis replays the AOF to restore state.

#### RDB Snapshots

- **Configuration:**
  ```
  save 900 1
  save 300 10
  save 60 10000
  ```
- **Enhanced Schedule:** Additional RDB snapshot every 15 minutes via cron:
  ```bash
  */15 * * * * redis-cli BGSAVE
  ```
- **Upload:** RDB files (`dump.rdb`) are copied to `s3://devplatform-backups/redis/` every 15 minutes after a successful `BGSAVE`.

#### Kubernetes Volume Note

The current `k8s/redis.yaml` uses `emptyDir: {}` for the Redis data volume. **For production, this must be changed to a PersistentVolumeClaim** to survive pod restarts:
```yaml
volumes:
  - name: redis-data
    persistentVolumeClaim:
      claimName: redis-data-pvc
```

### 2.4 Application Configuration

- **Infrastructure as Code:** All Kubernetes manifests are stored in the `k8s/` directory and version-controlled in Git.
- **Docker Compose:** `docker-compose.yml` and `docker-compose.staging.yml` are version-controlled.
- **Terraform:** Infrastructure definitions in the `terraform/` directory.
- **Alembic Migrations:** Database schema migrations in `backend/migrations/`, version-controlled.
- **Secrets Management:**
  - Development: `.env` file (excluded from Git via `.gitignore`).
  - Production: Kubernetes Secrets (`devplatform-secrets`), with recommendation to migrate to Sealed Secrets, External Secrets Operator, or HashiCorp Vault (as noted in `k8s/secrets.yaml`).
- **Environment Variables:** Defined in `k8s/configmap.yaml` (`devplatform-config`) and tracked in Git.

---

## Backup Schedule

| Component | Method | Frequency | Retention | Storage Location | Script |
|-----------|--------|-----------|-----------|-----------------|--------|
| PostgreSQL (full dump) | `pg_dump -Fc` + gzip | Daily at 02:00 UTC | 30 days | `s3://devplatform-backups/postgres/daily/` | `scripts/backup-postgres.sh` |
| PostgreSQL (WAL archives) | `archive_command` | Continuous | 37 days | `s3://devplatform-backups/postgres/wal/` | PostgreSQL built-in |
| MinIO (replication) | Server-side replication | Real-time | Versioned, 90-day non-current | Secondary MinIO / S3 region | MinIO built-in |
| MinIO (mirror sync) | `mc mirror` | Every 6 hours | Latest mirror state | `s3://devplatform-backups/minio-mirror/` | `scripts/backup-minio.sh` |
| Redis (AOF) | Append-only file | Continuous (everysec) | Current | PersistentVolume | Redis built-in |
| Redis (RDB snapshot) | `BGSAVE` | Every 15 minutes | 48 hours (192 snapshots) | `s3://devplatform-backups/redis/` | Cron job |
| Application config | Git version control | Every commit | Indefinite | Git repository | N/A |
| Kubernetes secrets | Sealed Secrets / Vault | On change | Versioned | Secrets manager | N/A |

---

## Restore Procedures

### 4.1 Database Restore from Dump

Use this procedure to restore PostgreSQL from a daily `pg_dump` backup.

**Script:** [`scripts/restore-postgres.sh`](../scripts/restore-postgres.sh)

**Manual Steps:**

```bash
# 1. List available backups
aws s3 ls s3://devplatform-backups/postgres/daily/ --human-readable

# 2. Download the desired backup
aws s3 cp s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz ./restore.dump.gz

# 3. Decompress
gunzip restore.dump.gz

# 4. Stop application services to prevent writes
kubectl -n devplatform scale deployment backend --replicas=0
kubectl -n devplatform scale deployment celery --replicas=0

# 5. Connect to PostgreSQL pod and drop/recreate the database
kubectl -n devplatform exec -it postgres-0 -- bash
psql -U devuser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'dev_platform' AND pid <> pg_backend_pid();"
psql -U devuser -d postgres -c "DROP DATABASE IF EXISTS dev_platform;"
psql -U devuser -d postgres -c "CREATE DATABASE dev_platform OWNER devuser;"
psql -U devuser -d dev_platform -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 6. Restore the dump
pg_restore -U devuser -d dev_platform -Fc --no-owner --no-privileges restore.dump

# 7. Run Alembic migrations to ensure schema is current
cd /app && alembic upgrade head

# 8. Verify restoration
psql -U devuser -d dev_platform -c "\dt" | wc -l
psql -U devuser -d dev_platform -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 9. Restart application services
kubectl -n devplatform scale deployment backend --replicas=2
kubectl -n devplatform scale deployment celery --replicas=1
```

### 4.2 Database Point-in-Time Recovery (PITR)

Use this when you need to recover to a specific moment (e.g., just before an accidental deletion).

```bash
# 1. Identify the target recovery time
TARGET_TIME="2026-02-15 14:30:00 UTC"

# 2. Stop PostgreSQL
kubectl -n devplatform scale statefulset postgres --replicas=0

# 3. Download the most recent base backup taken BEFORE the target time
aws s3 cp s3://devplatform-backups/postgres/daily/dev_platform_2026-02-15_020000.dump.gz ./base_backup.dump.gz

# 4. Download all WAL segments from the base backup through the target time
aws s3 sync s3://devplatform-backups/postgres/wal/ ./wal_archive/

# 5. Prepare the data directory with recovery configuration
#    Create recovery.signal and configure in postgresql.conf:
cat >> postgresql.conf << 'CONF'
restore_command = 'cp /wal_archive/%f %p'
recovery_target_time = '2026-02-15 14:30:00 UTC'
recovery_target_action = 'promote'
CONF

# 6. Start PostgreSQL -- it will replay WAL up to the target time
kubectl -n devplatform scale statefulset postgres --replicas=1

# 7. Verify the data is consistent at the target time
psql -U devuser -d dev_platform -c "SELECT max(created_at) FROM projects;"

# 8. Restart application services
kubectl -n devplatform scale deployment backend --replicas=2
kubectl -n devplatform scale deployment celery --replicas=1
```

### 4.3 S3 / MinIO Object Restore

#### Restore a Single Object (Versioned)

```bash
# List object versions
mc ls --versions primary/dev-platform-uploads/models/project-123/model.glb

# Restore a specific version by copying it as the current version
mc cp --version-id "VERSION_ID" primary/dev-platform-uploads/models/project-123/model.glb \
  primary/dev-platform-uploads/models/project-123/model.glb
```

#### Restore Entire Bucket from Mirror

```bash
# If the primary bucket is lost, restore from the backup mirror
mc mirror --overwrite \
  backup/devplatform-backups/minio-mirror/dev-platform-uploads/ \
  primary/dev-platform-uploads/
```

#### Restore from Cross-Region Replica

```bash
# If the primary MinIO cluster is lost, point the application to the replica
# Update the configmap:
kubectl -n devplatform edit configmap devplatform-config
# Change S3_ENDPOINT_URL to point to the backup region

# Or mirror the replica back to a new primary
mc mirror backup-region/dev-platform-uploads-replica/ primary/dev-platform-uploads/
```

### 4.4 Full System Rebuild from Scratch

This procedure rebuilds the entire platform from zero infrastructure.

#### Prerequisites

- Access to the Git repository containing all infrastructure code.
- Access to the S3 backup bucket (`s3://devplatform-backups/`).
- Kubernetes cluster provisioned (or Terraform state available).
- Container registry access for `devplatform/backend` and `devplatform/frontend` images.

#### Steps

```bash
# ==============================================================================
# PHASE 1: Infrastructure
# ==============================================================================

# 1. Provision infrastructure with Terraform
cd terraform/
terraform init
terraform apply

# 2. Configure kubectl for the new cluster
aws eks update-kubeconfig --name devplatform-cluster --region us-east-1

# ==============================================================================
# PHASE 2: Kubernetes Resources
# ==============================================================================

# 3. Create namespace
kubectl apply -f k8s/namespace.yaml

# 4. Apply secrets (ensure real values, not template placeholders)
kubectl apply -f k8s/secrets.yaml

# 5. Apply configmap
kubectl apply -f k8s/configmap.yaml

# 6. Deploy stateful services
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/minio.yaml

# 7. Wait for stateful services to be ready
kubectl -n devplatform wait --for=condition=ready pod -l app.kubernetes.io/name=postgres --timeout=120s
kubectl -n devplatform wait --for=condition=ready pod -l app.kubernetes.io/name=redis --timeout=60s
kubectl -n devplatform wait --for=condition=ready pod -l app.kubernetes.io/name=minio --timeout=60s

# ==============================================================================
# PHASE 3: Data Restoration
# ==============================================================================

# 8. Restore PostgreSQL from latest backup
./scripts/restore-postgres.sh --force s3://devplatform-backups/postgres/daily/LATEST.dump.gz

# 9. Restore MinIO data
mc mirror backup/devplatform-backups/minio-mirror/dev-platform-uploads/ primary/dev-platform-uploads/

# ==============================================================================
# PHASE 4: Application Deployment
# ==============================================================================

# 10. Deploy application services
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/celery.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml

# 11. Verify health
kubectl -n devplatform get pods
curl -f https://devplatform.example.com/api/v1/health

# ==============================================================================
# PHASE 5: Post-Restore Validation
# ==============================================================================

# 12. Verify database integrity
kubectl -n devplatform exec -it postgres-0 -- psql -U devuser -d dev_platform \
  -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 13. Verify MinIO objects are accessible
mc ls primary/dev-platform-uploads/ --summarize

# 14. Run application smoke tests
cd tests/ && pytest -x --tb=short smoke/

# 15. Re-enable backup cron jobs
# (Verify crontab or CronJob resources are active)
```

**Estimated Time:** 2-4 hours depending on data volume.

---

## RPO and RTO Targets

### Recovery Point Objective (RPO)

The RPO defines the maximum acceptable amount of data loss measured in time.

| Component | RPO Target | Mechanism | Worst-Case Data Loss |
|-----------|-----------|-----------|---------------------|
| PostgreSQL | **1 hour** | WAL archiving (continuous) + daily dumps | Up to `archive_timeout` (5 min) of transactions if WAL shipping is delayed |
| MinIO / S3 | **0 (zero)** | Real-time cross-region replication with versioning | Object-level: zero (versioned). Bucket-level: up to 6 hours (mirror interval) |
| Redis | **15 minutes** | RDB snapshots every 15 min + AOF everysec | 15 minutes of cache/task state |
| Application Config | **0 (zero)** | Git version control | None -- all config is in Git |

### Recovery Time Objective (RTO)

The RTO defines the maximum acceptable downtime after a disaster.

| Scenario | RTO Target | Notes |
|----------|-----------|-------|
| **Single service failure** | **30 minutes** | Kubernetes self-healing restarts pods automatically. Manual intervention only if persistent. |
| **Database restore from dump** | **1-2 hours** | Depends on database size. Includes download, restore, migration, and verification. |
| **Full system rebuild** | **4 hours** | Terraform provisioning + Kubernetes deployment + data restoration + validation. |
| **Region failover** | **2 hours** | DNS switch + verify replica data + deploy application layer. |

### Tier Classification

| Tier | Services | RPO | RTO | Backup Frequency |
|------|----------|-----|-----|-----------------|
| **Tier 1 (Critical)** | PostgreSQL, MinIO | 1 hour / 0 | 30 min - 2 hours | Continuous + daily |
| **Tier 2 (Important)** | Redis, Backend API | 15 min / N/A | 30 min | Every 15 min / N/A |
| **Tier 3 (Standard)** | Frontend, Celery Workers | N/A | 30 min | N/A (stateless) |

---

## Disaster Scenarios and Responses

### 6.1 Database Corruption

**Symptoms:** Application errors referencing database integrity, `pg_catalog` errors, failed queries on specific tables, PostgreSQL refusing to start.

**Severity:** Critical

**Response:**

1. **Immediate:** Scale backend and Celery to 0 replicas to prevent further corruption.
   ```bash
   kubectl -n devplatform scale deployment backend --replicas=0
   kubectl -n devplatform scale deployment celery --replicas=0
   ```

2. **Assess Scope:** Determine if corruption is localized (single table) or systemic.
   ```bash
   kubectl -n devplatform exec -it postgres-0 -- pg_amcheck -U devuser dev_platform
   ```

3. **Localized Corruption:** Attempt table-level repair.
   ```bash
   REINDEX TABLE affected_table;
   VACUUM FULL affected_table;
   ```

4. **Systemic Corruption:** Restore from the most recent clean backup.
   - If corruption happened recently: Use PITR to recover to just before the corruption event (see Section 4.2).
   - If corruption timeline is unknown: Restore from the latest daily dump (see Section 4.1).

5. **Post-Recovery:**
   - Run `ANALYZE` on all tables to refresh statistics.
   - Verify application functionality end-to-end.
   - Investigate root cause (disk failure, OOM, improper shutdown).
   - Restore backend/Celery replicas.

**RTO:** 1-2 hours.

### 6.2 S3 / MinIO Storage Failure

**Symptoms:** HTTP 500 errors on file upload/download, MinIO health check failures, missing objects.

**Severity:** Critical

**Response:**

1. **Immediate:** Check MinIO health and pod status.
   ```bash
   kubectl -n devplatform get pods -l app.kubernetes.io/name=minio
   kubectl -n devplatform logs minio-0 --tail=100
   mc admin info primary
   ```

2. **Pod/Volume Issue:** If the MinIO pod is crash-looping, check the PersistentVolumeClaim.
   ```bash
   kubectl -n devplatform describe pvc minio-data-minio-0
   ```

3. **Data Loss -- Partial:** Restore specific objects from versioning or the mirror backup.
   ```bash
   # From versioning
   mc ls --versions primary/dev-platform-uploads/path/to/object
   mc cp --version-id "VERSION_ID" primary/dev-platform-uploads/path/to/object ./restored-object

   # From mirror
   mc cp backup/devplatform-backups/minio-mirror/dev-platform-uploads/path/to/object primary/dev-platform-uploads/path/to/object
   ```

4. **Data Loss -- Complete Bucket:** Restore entire bucket from mirror or replica.
   ```bash
   mc mirror backup/devplatform-backups/minio-mirror/dev-platform-uploads/ primary/dev-platform-uploads/
   ```

5. **Cluster Loss:** Fail over to the cross-region replica by updating `S3_ENDPOINT_URL` in `devplatform-config`.

**RTO:** 30 minutes (pod restart) to 2 hours (full restore).

### 6.3 Complete Infrastructure Loss

**Symptoms:** Total loss of Kubernetes cluster, all services down, DNS unreachable.

**Severity:** Critical / Catastrophic

**Response:**

1. **Communicate:** Notify stakeholders. Activate incident response.

2. **Provision New Infrastructure:**
   ```bash
   cd terraform/
   terraform init
   terraform apply -auto-approve
   ```

3. **Execute Full System Rebuild:** Follow Section 4.4 (Full System Rebuild from Scratch) step by step.

4. **DNS Cutover:** Update DNS records to point to the new cluster's ingress.

5. **Validation:** Run full smoke test suite and verify all user-facing functionality.

6. **Post-Incident:**
   - Conduct a blameless post-mortem.
   - Update this document with lessons learned.
   - Review and strengthen infrastructure resilience (multi-AZ, multi-region).

**RTO:** 4 hours.

### 6.4 Security Breach

**Symptoms:** Unauthorized access detected, suspicious API activity, data exfiltration alerts, compromised credentials.

**Severity:** Critical

**Response:**

1. **Contain Immediately:**
   ```bash
   # Isolate the cluster by restricting network policies
   kubectl -n devplatform apply -f k8s/network-policy-lockdown.yaml

   # Rotate ALL secrets immediately
   kubectl -n devplatform delete secret devplatform-secrets
   # Recreate with new values (generate fresh passwords, keys, tokens)
   ```

2. **Revoke Access:**
   - Rotate PostgreSQL password. Update `devplatform-secrets`.
   - Rotate MinIO access/secret keys. Update `devplatform-secrets`.
   - Rotate JWT secret key. This will invalidate all active sessions.
   - Rotate the Anthropic API key.
   - Revoke any compromised IAM credentials or Kubernetes service accounts.

3. **Assess Damage:**
   - Review PostgreSQL audit logs for unauthorized queries.
   - Review MinIO access logs for unauthorized object access.
   - Check for unauthorized data modifications.

4. **Restore if Necessary:**
   - If data was tampered with, restore from the last known-clean backup using PITR.
   - If objects were modified, restore from versioned S3/MinIO history.

5. **Forensics and Reporting:**
   - Preserve logs and evidence before rotating.
   - Engage security team for forensic analysis.
   - File necessary compliance/breach notifications.
   - Conduct a thorough post-incident review.

6. **Harden:**
   - Enable database audit logging if not already active.
   - Review and tighten RBAC policies.
   - Enable network policies to limit pod-to-pod communication.
   - Consider migrating secrets to HashiCorp Vault or Sealed Secrets (as noted in `k8s/secrets.yaml`).

**RTO:** 2-4 hours (containment and rotation). Full forensics may take days.

---

## Testing Plan

Backups are only valuable if restores are verified. The following testing cadence ensures readiness.

### Monthly: Restore Verification

**Objective:** Confirm that the most recent backup can be successfully restored.

**Procedure:**

1. Spin up an isolated test namespace (`devplatform-dr-test`).
2. Deploy PostgreSQL and MinIO into the test namespace.
3. Download the latest daily PostgreSQL backup.
4. Execute `scripts/restore-postgres.sh --force <backup-file>` against the test database.
5. Verify:
   - All tables are present (`\dt` count matches production).
   - Row counts for critical tables are within expected ranges.
   - Sample queries return valid data.
   - Alembic reports `head` as the current revision.
6. Restore a sample of MinIO objects and verify integrity (checksum comparison).
7. Document results in the DR test log.
8. Tear down the test namespace.

**Success Criteria:**
- Restore completes without errors.
- Table count matches production.
- Row counts within 1% of production (accounting for new data since backup).
- Application health check passes against restored data.

### Quarterly: Full Disaster Recovery Drill

**Objective:** Simulate a complete infrastructure loss and validate the full rebuild procedure.

**Procedure:**

1. Schedule a maintenance window (or use a separate environment).
2. Execute the Full System Rebuild procedure (Section 4.4) from scratch.
3. Time the entire process.
4. Verify:
   - All services reach healthy state.
   - Application is fully functional.
   - Data integrity checks pass.
   - External integrations work (Anthropic API, Mapbox, etc.).
5. Document:
   - Total recovery time (compare against 4-hour RTO).
   - Any issues encountered and their resolution.
   - Recommendations for improvement.

**Success Criteria:**
- Full system operational within 4 hours.
- No data loss beyond RPO targets.
- All automated tests pass.

### Ad-Hoc: After Infrastructure Changes

After any significant change to database schema, storage configuration, or backup tooling:
- Run a one-off restore verification.
- Validate that backup scripts still function correctly.
- Update this document if procedures have changed.

---

## Monitoring and Alerting

### Backup Health Monitoring

| Metric | Source | Alert Threshold | Severity |
|--------|--------|----------------|----------|
| Last successful PostgreSQL backup age | S3 object timestamp | > 26 hours | **Critical** |
| PostgreSQL backup file size | S3 object metadata | < 50% of 7-day average | **Warning** |
| WAL archive lag | `pg_stat_archiver.last_archived_wal` | > 100 unarchived segments | **Critical** |
| MinIO mirror last sync age | Script log timestamp | > 8 hours | **Warning** |
| MinIO replication lag | `mc admin replicate status` | > 1000 pending objects | **Warning** |
| Redis RDB snapshot age | S3 object timestamp | > 20 minutes | **Warning** |
| Backup S3 bucket accessibility | `aws s3 ls` probe | Any failure | **Critical** |
| Backup script exit code | Script log / monitoring agent | Non-zero exit | **Critical** |

### Recommended Alerting Stack

- **Prometheus** with custom metrics exposed by backup scripts (push via Pushgateway).
- **Grafana** dashboard for backup health visualization.
- **Alertmanager** routing critical alerts to PagerDuty/Slack/email.

### Sample Prometheus Alerts

```yaml
groups:
  - name: backup-health
    rules:
      - alert: PostgresBackupStale
        expr: time() - backup_postgres_last_success_timestamp > 93600  # 26 hours
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL backup is stale"
          description: "No successful PostgreSQL backup in the last 26 hours."

      - alert: PostgresBackupSizeDrop
        expr: backup_postgres_last_size_bytes < (backup_postgres_avg_size_bytes_7d * 0.5)
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL backup size dropped significantly"
          description: "Latest backup is less than 50% of the 7-day average size."

      - alert: WalArchiveLag
        expr: pg_stat_archiver_failed_count > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL WAL archiving failures detected"
          description: "WAL archiving has failed {{ $value }} time(s)."

      - alert: MinioMirrorStale
        expr: time() - backup_minio_last_mirror_timestamp > 28800  # 8 hours
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "MinIO mirror sync is stale"
          description: "No successful MinIO mirror in the last 8 hours."

      - alert: RedisSnapshotStale
        expr: time() - backup_redis_last_rdb_timestamp > 1200  # 20 min
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis RDB snapshot is stale"
          description: "No Redis snapshot uploaded in the last 20 minutes."
```

### Log Aggregation

All backup scripts log to stdout with ISO 8601 timestamps. In Kubernetes, these logs are captured by the cluster log collector (Fluentd/Fluent Bit) and forwarded to the centralized logging system (Elasticsearch/Loki).

---

## Runbook Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| On-call Engineer | PagerDuty rotation | Auto-escalation after 15 min |
| Database Lead | [DB team channel] | Escalate for PITR / corruption |
| Platform Lead | [Platform team channel] | Escalate for infrastructure loss |
| Security Lead | [Security team channel] | Escalate for breach scenarios |

---

## Document Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-16 | Platform Engineering | Initial version |

---

*This document should be reviewed and updated quarterly, or after any significant infrastructure change. All team members with on-call responsibilities should be familiar with these procedures.*

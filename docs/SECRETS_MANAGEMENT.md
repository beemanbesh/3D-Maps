# Secrets Management

This document describes how secrets are managed across all environments for the
3D Development Platform. It covers local development, Docker, Kubernetes, and
cloud-native approaches.

---

## Table of Contents

1. [Overview](#overview)
2. [Inventory of Secrets](#inventory-of-secrets)
3. [Local Development](#local-development)
4. [Docker / Docker Compose](#docker--docker-compose)
5. [Kubernetes](#kubernetes)
6. [AWS Secrets Manager and Parameter Store](#aws-secrets-manager-and-parameter-store)
7. [Secret Rotation Procedures](#secret-rotation-procedures)
8. [Security Best Practices](#security-best-practices)

---

## Overview

The 3D Development Platform relies on several categories of secrets:

- **Database credentials** -- PostgreSQL user and password embedded in connection
  strings.
- **Object-storage credentials** -- S3-compatible (MinIO) access and secret keys.
- **API keys** -- Third-party service keys for Anthropic (Claude AI) and Mapbox.
- **JWT signing material** -- HMAC secret used to sign and verify access/refresh
  tokens.
- **Monitoring DSNs** -- Sentry ingest URLs that contain project-specific auth
  tokens.

Secrets MUST never be committed to version control. The `.gitignore` at the
repository root already excludes `.env`, `.env.local`, and `.env.production`.

---

## Inventory of Secrets

| Variable | Description | Required | Category | Rotation Frequency |
|---|---|---|---|---|
| `DATABASE_URL` | Async PostgreSQL connection string (contains password) | Yes | Database | 90 days |
| `DATABASE_URL_SYNC` | Synchronous PostgreSQL connection string (contains password) | Yes | Database | 90 days |
| `POSTGRES_PASSWORD` | Raw database password (used in Docker / k8s to compose URL) | Yes | Database | 90 days |
| `REDIS_URL` | Redis connection string (may include password in production) | Yes | Database | 90 days if auth enabled |
| `JWT_SECRET_KEY` | HMAC key for signing JWTs (HS256) | Yes | Security | 90 days |
| `JWT_ALGORITHM` | Algorithm for JWT signing (default: HS256) | No | Config | N/A |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime in minutes (default: 30) | No | Config | N/A |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token lifetime in days (default: 7) | No | Config | N/A |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (`sk-ant-...`) | Yes | API Key | On compromise or annually |
| `MAPBOX_ACCESS_TOKEN` | Mapbox GL JS token (`pk.…`) | Yes | API Key | On compromise or annually |
| `S3_ACCESS_KEY` | MinIO / S3 access key ID | Yes | Storage | 90 days |
| `S3_SECRET_KEY` | MinIO / S3 secret access key | Yes | Storage | 90 days |
| `S3_ENDPOINT_URL` | Object storage endpoint URL | No | Config | N/A |
| `S3_BUCKET_NAME` | Target bucket name | No | Config | N/A |
| `S3_REGION` | AWS region for S3 | No | Config | N/A |
| `MINIO_ROOT_USER` | MinIO admin username (Docker / k8s only) | Yes (infra) | Storage | 90 days |
| `MINIO_ROOT_PASSWORD` | MinIO admin password (Docker / k8s only) | Yes (infra) | Storage | 90 days |
| `SENTRY_DSN` | Backend Sentry ingest DSN | No | Monitoring | On key revocation |
| `SENTRY_DSN_FRONTEND` | Frontend Sentry ingest DSN | No | Monitoring | On key revocation |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No | Config | N/A |
| `APP_ENV` | Environment identifier (`development`, `staging`, `production`) | No | Config | N/A |
| `APP_DEBUG` | Debug mode toggle | No | Config | N/A |
| `LOG_LEVEL` | Logging verbosity | No | Config | N/A |
| `MAX_UPLOAD_SIZE_MB` | Upload size limit | No | Config | N/A |
| `PROCESSING_WORKERS` | Celery concurrency setting | No | Config | N/A |

---

## Local Development

### Setup

1. Copy the template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in real values. At minimum set:
   - `JWT_SECRET_KEY` -- generate with `openssl rand -hex 32`
   - `ANTHROPIC_API_KEY` -- your personal dev key
   - `MAPBOX_ACCESS_TOKEN` -- your personal dev token

3. The default database and MinIO credentials in `.env.example` match
   `docker-compose.yml` and work out-of-the-box for local development.

### Validation

Run the environment validation script before starting services:

```bash
./scripts/validate-env.sh
```

This will flag missing required variables, insecure defaults, and formatting
issues.

### Important Rules

- NEVER commit `.env` files. They are git-ignored by default.
- NEVER share your personal API keys through chat, email, or issue trackers.
- Use short-lived, scoped tokens when available (e.g., Mapbox temporary tokens).

---

## Docker / Docker Compose

### Development (docker-compose.yml)

The base `docker-compose.yml` hardcodes default development credentials for
convenience. The backend service also loads `.env` via `env_file`. This is
acceptable for local development only.

### Staging (docker-compose.staging.yml)

The staging override replaces hardcoded values with environment variable
references:

```yaml
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
```

Supply secrets via a `.env` file or export them in your shell before running:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

### Docker Swarm Secrets

For Docker Swarm deployments, use native Docker secrets:

```bash
# Create secrets
echo "my-strong-password" | docker secret create postgres_password -
echo "my-jwt-key"         | docker secret create jwt_secret_key -
openssl rand -hex 32      | docker secret create s3_secret_key -
```

Reference them in `docker-compose.yml` with the `secrets` top-level key:

```yaml
services:
  backend:
    secrets:
      - jwt_secret_key
      - postgres_password
      - s3_secret_key
    environment:
      JWT_SECRET_KEY_FILE: /run/secrets/jwt_secret_key

secrets:
  jwt_secret_key:
    external: true
  postgres_password:
    external: true
  s3_secret_key:
    external: true
```

The application can read from `/run/secrets/<name>` or you can use a wrapper
entrypoint that exports file-based secrets as environment variables.

---

## Kubernetes

### Native Kubernetes Secrets

The project ships a template at `k8s/secrets.yaml` with base64-encoded
placeholder values. To use it:

```bash
# Encode your real values
echo -n 'real-password' | base64

# Edit k8s/secrets.yaml, replace placeholder values, then apply
kubectl apply -f k8s/secrets.yaml
```

Secrets are injected into pods via `secretKeyRef` in the deployment manifests
(see `k8s/backend.yaml`).

**Warning:** Native k8s Secrets are base64-encoded, NOT encrypted. Anyone with
RBAC read access to the namespace can decode them.

### Sealed Secrets (Bitnami)

For git-safe secret storage, encrypt secrets with the Sealed Secrets controller:

```bash
# Install the controller
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets -n kube-system

# Seal a secret
kubeseal --format yaml < k8s/secrets.yaml > k8s/sealed-secrets.yaml
```

Commit `k8s/sealed-secrets.yaml` to version control. The controller decrypts it
in-cluster and creates a standard Secret resource.

### External Secrets Operator

For production, use the External Secrets Operator to sync secrets from a cloud
provider (AWS Secrets Manager, HashiCorp Vault, etc.) into Kubernetes Secrets
automatically.

The configuration is provided at `k8s/external-secrets.yaml`. See the
[AWS Secrets Manager section](#aws-secrets-manager-and-parameter-store) below
for the cloud-side setup.

---

## AWS Secrets Manager and Parameter Store

### Architecture

```
AWS Secrets Manager           Kubernetes Cluster
+-------------------------+   +----------------------------+
| devplatform/prod/db     |-->| External Secrets Operator  |
| devplatform/prod/jwt    |   |   |                        |
| devplatform/prod/s3     |   |   v                        |
| devplatform/prod/api    |   | k8s Secret:                |
| devplatform/prod/sentry |   |   devplatform-secrets      |
+-------------------------+   +----------------------------+
```

### Creating Secrets in AWS

```bash
# Database credentials
aws secretsmanager create-secret \
  --name devplatform/prod/db \
  --secret-string '{"username":"devuser","password":"STRONG_PASSWORD_HERE"}'

# JWT secret key
aws secretsmanager create-secret \
  --name devplatform/prod/jwt \
  --secret-string '{"secret_key":"GENERATED_HEX_KEY"}'

# S3 / MinIO credentials
aws secretsmanager create-secret \
  --name devplatform/prod/s3 \
  --secret-string '{"access_key":"ACCESS_KEY","secret_key":"SECRET_KEY","minio_root_user":"ADMIN","minio_root_password":"ADMIN_PASS"}'

# API keys
aws secretsmanager create-secret \
  --name devplatform/prod/api-keys \
  --secret-string '{"anthropic_api_key":"sk-ant-...","mapbox_access_token":"pk...."}'

# Monitoring
aws secretsmanager create-secret \
  --name devplatform/prod/sentry \
  --secret-string '{"backend_dsn":"https://...@sentry.io/...","frontend_dsn":"https://...@sentry.io/..."}'
```

### AWS Parameter Store (for non-sensitive config)

Use Parameter Store for configuration values that are not secret but should not
be hardcoded:

```bash
aws ssm put-parameter \
  --name /devplatform/prod/s3_bucket_name \
  --value dev-platform-uploads \
  --type String

aws ssm put-parameter \
  --name /devplatform/prod/s3_region \
  --value us-east-1 \
  --type String
```

### Automatic Rotation

Enable automatic rotation in AWS Secrets Manager:

```bash
aws secretsmanager rotate-secret \
  --secret-id devplatform/prod/db \
  --rotation-rules '{"AutomaticallyAfterDays": 90}'
```

The External Secrets Operator polls for changes (default: every 1 hour as
configured in `k8s/external-secrets.yaml`) and updates the Kubernetes Secret
automatically.

---

## Secret Rotation Procedures

### Automated Rotation (Local / CI)

Use the rotation script for local or CI-managed secrets:

```bash
./scripts/rotate-secrets.sh
```

This will:
1. Generate a new JWT secret key.
2. Generate a new database password.
3. Generate new MinIO / S3 credentials.
4. Back up the current `.env` file.
5. Update `.env` with the new values.
6. Log the rotation event with a timestamp.
7. Prompt you to restart services.

### Manual Rotation Checklist

For production environments where secrets are stored in AWS Secrets Manager or
Kubernetes:

1. **Generate new secret values:**
   ```bash
   # JWT secret
   openssl rand -hex 32

   # Database password
   openssl rand -base64 24

   # S3 credentials
   openssl rand -base64 16  # access key
   openssl rand -base64 32  # secret key
   ```

2. **Update the secret store:**
   - AWS: `aws secretsmanager update-secret --secret-id <id> --secret-string '<json>'`
   - Kubernetes native: edit and re-apply `k8s/secrets.yaml`
   - Sealed Secrets: re-seal and commit

3. **Restart affected services** to pick up new values:
   ```bash
   # Kubernetes
   kubectl rollout restart deployment/backend -n devplatform
   kubectl rollout restart deployment/celery -n devplatform

   # Docker Compose
   docker compose restart backend celery-worker
   ```

4. **Verify services are healthy:**
   ```bash
   kubectl get pods -n devplatform
   curl -f http://localhost:8000/api/v1/health
   ```

5. **Revoke old credentials** where applicable (database users, API keys).

6. **Document the rotation** in your operations log.

### JWT Secret Key Rotation (Special Considerations)

When rotating the JWT secret key, all existing access and refresh tokens become
invalid immediately. Plan accordingly:

- Schedule rotation during a maintenance window or low-traffic period.
- If zero-downtime rotation is required, implement dual-key verification in the
  application (accept tokens signed by both the old and new key for a grace
  period).
- Communicate the rotation to users if session interruption is expected.

---

## Security Best Practices

### Never Commit Secrets

- The `.gitignore` excludes `.env`, `.env.local`, and `.env.production`.
- Run `git diff --cached` before every commit to verify no secrets are staged.
- Consider a pre-commit hook with tools like `detect-secrets` or `gitleaks`:
  ```bash
  pip install detect-secrets
  detect-secrets scan --baseline .secrets.baseline
  ```

### Use Short-Lived Tokens

- Set `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` to 30 or less in production.
- Use refresh tokens (`JWT_REFRESH_TOKEN_EXPIRE_DAYS: 7`) rather than
  long-lived access tokens.
- For Mapbox, use temporary tokens scoped to specific URLs when possible.

### Principle of Least Privilege

- Create dedicated database users with minimal required permissions
  (SELECT/INSERT/UPDATE/DELETE on application tables only -- no SUPERUSER).
- Use scoped S3 IAM policies that restrict access to the specific bucket.
- Use read-only Anthropic API keys if the SDK supports them.
- In Kubernetes, restrict Secret access via RBAC:
  ```yaml
  apiVersion: rbac.authorization.k8s.io/v1
  kind: Role
  metadata:
    name: secret-reader
    namespace: devplatform
  rules:
    - apiGroups: [""]
      resources: ["secrets"]
      resourceNames: ["devplatform-secrets"]
      verbs: ["get"]
  ```

### Encryption at Rest

- Enable etcd encryption for Kubernetes Secrets:
  ```yaml
  apiVersion: apiserver.config.k8s.io/v1
  kind: EncryptionConfiguration
  resources:
    - resources: ["secrets"]
      providers:
        - aescbc:
            keys:
              - name: key1
                secret: <base64-encoded-key>
        - identity: {}
  ```
- AWS Secrets Manager encrypts with KMS by default.

### Monitoring and Alerting

- Enable AWS CloudTrail logging for Secrets Manager API calls.
- Monitor for `GetSecretValue` calls from unexpected principals.
- Set up alerts for failed authentication attempts in the application logs.
- Track secret age and alert when rotation is overdue.

### Environment Isolation

- Use separate secrets for each environment (development, staging, production).
- Never reuse production secrets in non-production environments.
- Use naming conventions that include the environment:
  - AWS: `devplatform/prod/db`, `devplatform/staging/db`
  - Kubernetes: namespace isolation (`devplatform-prod`, `devplatform-staging`)

### CI/CD Pipeline Security

- Store secrets in your CI/CD platform's secret management (GitHub Actions
  secrets, GitLab CI variables, etc.).
- Never echo or print secrets in build logs.
- Use OIDC-based authentication for cloud access where supported (e.g., GitHub
  Actions OIDC with AWS IAM roles).
- Pin action versions by SHA to prevent supply-chain attacks.

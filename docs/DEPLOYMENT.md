# Deployment Guide

## Development (Docker Compose)

### Prerequisites
- Docker 24+ with Docker Compose v2
- 8GB+ RAM (recommended for all services)

### Services
| Service | Port | Description |
|---------|------|-------------|
| Frontend | 5173 | Vite dev server (React) |
| Backend | 8000 | FastAPI API server |
| Celery Worker | — | Background task processing |
| PostgreSQL | 5432 | Database (PostGIS) |
| Redis | 6379 | Cache + Celery broker |
| MinIO | 9000/9001 | S3-compatible object storage |

### Quick Start
```bash
cp .env.example .env
# Configure ANTHROPIC_API_KEY and MAPBOX_ACCESS_TOKEN in .env

docker compose up -d

# Verify services
curl http://localhost:8000/health
curl http://localhost:8000/metrics
```

### Environment Variables

#### Required
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude AI interpretation |
| `MAPBOX_ACCESS_TOKEN` | Mapbox token for geocoding and map tiles |

#### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://devuser:devpassword@db:5432/dev_platform` | Async database URL |
| `DATABASE_URL_SYNC` | `postgresql://devuser:devpassword@db:5432/dev_platform` | Sync database URL (Celery) |
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL |
| `S3_ENDPOINT_URL` | `http://minio:9000` | S3/MinIO endpoint |
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key |
| `S3_BUCKET_NAME` | `dev-platform-uploads` | S3 bucket name |
| `JWT_SECRET_KEY` | `change-this-in-production` | JWT signing secret |
| `SENTRY_DSN` | — | Sentry DSN for backend error tracking |
| `SENTRY_DSN_FRONTEND` | — | Sentry DSN for frontend error tracking |

## Production Considerations

### Database
- Use a managed PostgreSQL service (AWS RDS, GCP Cloud SQL, Azure Database)
- Enable PostGIS extension
- Set up automated backups
- Use connection pooling (PgBouncer)

### Object Storage
- Replace MinIO with AWS S3, GCP Cloud Storage, or Azure Blob Storage
- Configure CORS for GLB model serving
- Set up a CDN (CloudFront/CloudFlare) for static assets and GLB files

### Redis
- Use managed Redis (AWS ElastiCache, GCP Memorystore)
- Configure persistence for Celery task results

### Security
- Generate a strong random `JWT_SECRET_KEY`
- Enable HTTPS with valid SSL certificates
- Restrict CORS origins to your domain
- Set `APP_ENV=production` and `APP_DEBUG=false`
- Use a secrets manager (HashiCorp Vault, AWS Secrets Manager)

### Scaling
- **Backend API:** Horizontal scaling behind a load balancer (multiple uvicorn workers or containers)
- **Celery Workers:** Scale independently based on processing queue depth
- **Frontend:** Build static assets (`npm run build`) and serve via CDN/nginx

### Monitoring
- Configure Sentry DSN for both frontend and backend
- Monitor `/metrics` endpoint for API response times and queue depth
- Set up alerts for:
  - API error rate > 1%
  - P95 response time > 2s
  - Celery queue depth > 10
  - Disk usage > 80%

### Build for Production
```bash
# Frontend production build
cd frontend && npm run build

# Backend — no build step needed, just deploy the Python code
# Use gunicorn with uvicorn workers:
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

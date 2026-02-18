"""
3D Interactive Development Visualization Platform - API Server
"""

import logging
import time
from collections import deque
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings

settings = get_settings()

# Configure logging
logging.basicConfig(level=getattr(logging, settings.log_level))
logger = logging.getLogger(__name__)

# Initialize Sentry if DSN is configured
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release=f"3d-platform-backend@{settings.app_version}",
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
        send_default_pii=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    logger.info("Starting 3D Development Platform API...")
    # Startup: initialize resources, verify connections
    yield
    # Shutdown: cleanup resources
    logger.info("Shutting down 3D Development Platform API...")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
## 3D Interactive Development Visualization Platform API

Transform architectural documents (PDFs, images, CAD files) into interactive 3D building visualizations.

### Key Features
- **Document Processing**: Upload PDFs, images, DXF, spreadsheets, GeoJSON — AI extracts building data
- **3D Generation**: Automatic GLB model generation with LOD variants
- **Project Management**: CRUD for projects, buildings, documents, and annotations
- **Real-time Collaboration**: WebSocket-based presence and edit broadcasting
- **Sharing**: Email invitations and public share links with viewer/editor permissions

### Authentication
Most endpoints require a JWT Bearer token. Obtain tokens via `POST /api/v1/auth/login`.
Include the token in the `Authorization: Bearer <token>` header.
""",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# --- Request metrics tracking ---
_request_times: deque[float] = deque(maxlen=1000)
_request_count = 0
_start_time = time.time()


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        global _request_count
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start
        _request_times.append(duration)
        _request_count += 1
        response.headers["X-Response-Time"] = f"{duration:.4f}"
        if duration > 1.0:
            logger.warning(f"Slow request: {request.method} {request.url.path} took {duration:.2f}s")
        return response


app.add_middleware(MetricsMiddleware)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1")

# Include WebSocket routes (no prefix — clean /ws/... URLs)
from app.api.v1.collaboration import router as ws_router  # noqa: E402
app.include_router(ws_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.app_version}


@app.get("/metrics")
async def metrics():
    """Basic API metrics endpoint."""
    times = list(_request_times)
    avg_ms = (sum(times) / len(times) * 1000) if times else 0
    p95_ms = sorted(times)[int(len(times) * 0.95)] * 1000 if len(times) > 1 else 0

    # Celery queue depth
    queue_info = {"active": 0, "reserved": 0, "scheduled": 0, "available": False}
    try:
        from app.tasks.worker import celery_app
        inspector = celery_app.control.inspect(timeout=1.0)
        active = inspector.active() or {}
        reserved = inspector.reserved() or {}
        scheduled = inspector.scheduled() or {}
        queue_info = {
            "active": sum(len(v) for v in active.values()),
            "reserved": sum(len(v) for v in reserved.values()),
            "scheduled": sum(len(v) for v in scheduled.values()),
            "available": True,
        }
    except Exception:
        pass

    return {
        "total_requests": _request_count,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "avg_response_ms": round(avg_ms, 2),
        "p95_response_ms": round(p95_ms, 2),
        "recent_samples": len(times),
        "queue": queue_info,
    }

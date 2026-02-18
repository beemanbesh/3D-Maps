# ADR-002: Celery + Redis for Asynchronous Document Processing

**Status:** Accepted
**Date:** 2025-12-01
**Decision Makers:** Engineering Team

## Context

Architectural documents (PDFs, images, CAD files) require multi-step processing: extraction, AI interpretation, 3D model generation, and GLB export. This pipeline can take 10-60 seconds per document and must not block the HTTP API.

### Options Considered

1. **Celery + Redis** — Python distributed task queue with Redis as broker
2. **FastAPI BackgroundTasks** — Built-in async background processing
3. **AWS SQS + Lambda** — Serverless event-driven processing
4. **Dramatiq** — Alternative Python task queue

## Decision

We chose **Celery with Redis** as the task queue for asynchronous document processing.

## Rationale

- **Proven at scale:** Celery is the most mature Python task queue with extensive documentation and production track record.
- **Redis dual-use:** Redis serves as both the Celery broker/result backend and a general-purpose cache, reducing infrastructure components.
- **Task chaining:** Celery's task primitives (delay, chain, group) allow us to orchestrate `process_document` -> `generate_3d_model` pipelines with retry logic.
- **Monitoring:** Built-in task inspection (`celery_app.control.inspect()`) powers our `/metrics` endpoint for queue depth monitoring.
- **Worker isolation:** Celery workers run in separate processes/containers, preventing CPU-intensive operations (OpenCV, trimesh) from affecting API latency.

### Why Not Others

- **FastAPI BackgroundTasks** runs in the same process — a long-running task would consume the async event loop and degrade API responsiveness.
- **AWS SQS + Lambda** would add cloud vendor lock-in and break our Docker Compose local development setup.
- **Dramatiq** has a smaller community and fewer integrations for monitoring.

## Consequences

### Positive

- Document processing is fully non-blocking — upload returns immediately with status "pending"
- Workers can be scaled horizontally for high document volume
- Task status is queryable via `AsyncResult` for real-time progress tracking
- Retry on failure is built in (configurable max_retries, backoff)

### Negative

- Additional infrastructure: Redis container must be running for any processing to work
- Celery workers use synchronous Python — async libraries (Claude API, httpx) need `asyncio.run()` wrappers
- Debugging distributed tasks is harder than in-process execution
- Worker cold start adds ~2s latency to first task after idle

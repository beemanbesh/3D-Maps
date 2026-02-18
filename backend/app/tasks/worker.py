"""
Celery worker configuration and task definitions.
"""

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "dev_platform",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,  # 10 minute hard limit
    task_soft_time_limit=300,  # 5 minute soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
)

# Import tasks so they register with Celery
import app.tasks.processing  # noqa: F401, E402

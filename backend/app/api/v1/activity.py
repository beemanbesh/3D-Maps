"""
Activity feed / change log API endpoints.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import ActivityLog, User

router = APIRouter()


@router.get("/projects/{project_id}/activity")
async def get_project_activity(
    project_id: uuid.UUID,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """Get recent activity for a project."""
    result = await db.execute(
        select(ActivityLog, User.email, User.full_name)
        .outerjoin(User, ActivityLog.user_id == User.id)
        .where(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "id": str(log.id),
            "action": log.action,
            "details": log.details,
            "user_email": email,
            "user_name": name,
            "created_at": log.created_at.isoformat(),
        }
        for log, email, name in rows
    ]


async def log_activity(
    db: AsyncSession,
    project_id: uuid.UUID,
    action: str,
    user_id: uuid.UUID | None = None,
    details: dict | None = None,
):
    """Helper to record an activity log entry."""
    entry = ActivityLog(
        project_id=project_id,
        user_id=user_id,
        action=action,
        details=details,
    )
    db.add(entry)

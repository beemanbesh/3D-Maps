"""
Project sharing API endpoints — invite by email and public links.
"""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user, require_auth
from app.models.models import Project, ProjectShare, User
from app.schemas.schemas import (
    ProjectResponse,
    PublicLinkResponse,
    ShareProjectRequest,
    ShareResponse,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project_as_owner(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Project:
    """Load a project and verify the user is the owner."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only the project owner can manage sharing")
    return project


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/projects/{project_id}/shares",
    response_model=ShareResponse,
    status_code=status.HTTP_201_CREATED,
)
async def share_project(
    project_id: uuid.UUID,
    body: ShareProjectRequest,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Share a project with another user by email."""
    project = await _get_project_as_owner(project_id, user, db)

    # Check if already shared with this email
    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.email == body.email,
            ProjectShare.is_public_link == False,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Update permission instead of duplicating
        existing.permission = body.permission
        await db.flush()
        await db.refresh(existing)
        return existing

    # Check if the invited email belongs to an existing user
    result = await db.execute(select(User).where(User.email == body.email))
    invited_user = result.scalar_one_or_none()

    share = ProjectShare(
        project_id=project_id,
        email=body.email,
        user_id=invited_user.id if invited_user else None,
        permission=body.permission,
        invite_token=secrets.token_urlsafe(32),
    )
    db.add(share)
    await db.flush()
    await db.refresh(share)
    return share


@router.get("/projects/{project_id}/shares", response_model=list[ShareResponse])
async def list_shares(
    project_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all shares for a project (owner only)."""
    await _get_project_as_owner(project_id, user, db)

    result = await db.execute(
        select(ProjectShare)
        .where(ProjectShare.project_id == project_id)
        .order_by(ProjectShare.created_at)
    )
    return result.scalars().all()


@router.delete("/projects/{project_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    project_id: uuid.UUID,
    share_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a project share."""
    await _get_project_as_owner(project_id, user, db)

    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.id == share_id,
            ProjectShare.project_id == project_id,
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    await db.delete(share)


@router.post(
    "/projects/{project_id}/shares/public-link",
    response_model=PublicLinkResponse,
)
async def create_public_link(
    project_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Generate a public share link for the project."""
    await _get_project_as_owner(project_id, user, db)

    # Check if a public link already exists
    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.is_public_link == True,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return PublicLinkResponse(
            token=existing.invite_token,
            url=f"/shared/{existing.invite_token}",
        )

    token = secrets.token_urlsafe(32)
    share = ProjectShare(
        project_id=project_id,
        permission="viewer",
        is_public_link=True,
        invite_token=token,
    )
    db.add(share)
    await db.flush()

    return PublicLinkResponse(token=token, url=f"/shared/{token}")


@router.delete("/projects/{project_id}/shares/public-link", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_public_link(
    project_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Revoke the public share link."""
    await _get_project_as_owner(project_id, user, db)

    result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.project_id == project_id,
            ProjectShare.is_public_link == True,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        await db.delete(existing)


@router.get("/shared/{token}", response_model=ProjectResponse)
async def get_shared_project(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Access a project via share token (public link or invite)."""
    result = await db.execute(
        select(ProjectShare).where(ProjectShare.invite_token == token)
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Invalid or expired share link")

    result = await db.execute(
        select(Project)
        .options(selectinload(Project.buildings), selectinload(Project.documents))
        .where(Project.id == share.project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project


@router.get("/shared-with-me", response_model=list[ShareResponse])
async def list_shared_with_me(
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all projects shared with the current user."""
    result = await db.execute(
        select(ProjectShare).where(
            or_(
                ProjectShare.user_id == user.id,
                ProjectShare.email == user.email,
            )
        ).order_by(ProjectShare.created_at.desc())
    )
    return result.scalars().all()

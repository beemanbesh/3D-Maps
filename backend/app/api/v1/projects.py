"""
Project management API endpoints.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user, require_auth, check_project_permission
from app.models.models import Project, ProjectShare, User
from app.schemas.schemas import (
    LocationResponse,
    ProjectCreate,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
)

router = APIRouter()


def _serialize_location(project: Project) -> dict | None:
    """Convert PostGIS Geography to a LocationResponse-compatible dict."""
    if project.location is None:
        return None
    try:
        point = to_shape(project.location)
        return {"longitude": point.x, "latitude": point.y}
    except Exception:
        return None


def _project_to_dict(project: Project, include_relations: bool = False) -> dict:
    """Convert a Project ORM object to a dict with serialized location."""
    data = {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "location": _serialize_location(project),
        "construction_phases": project.construction_phases,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "owner_id": project.owner_id,
    }
    if include_relations:
        data["buildings"] = project.buildings
        data["documents"] = project.documents
    return data


@router.post("/", response_model=ProjectListResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_in: ProjectCreate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create a new development project. Requires authentication."""

    project = Project(
        name=project_in.name,
        description=project_in.description,
        owner_id=user.id,
        construction_phases=(
            [p.model_dump(mode="json") for p in project_in.construction_phases]
            if project_in.construction_phases else None
        ),
    )
    if project_in.location:
        from geoalchemy2.elements import WKTElement
        point = f"POINT({project_in.location.longitude} {project_in.location.latitude})"
        project.location = WKTElement(point, srid=4326)

    db.add(project)
    await db.flush()
    await db.refresh(project)
    return _project_to_dict(project)


@router.get("/", response_model=list[ProjectListResponse])
async def list_projects(
    skip: int = 0,
    limit: int = 20,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List projects owned by or shared with the authenticated user."""
    # Get IDs of projects shared with this user
    shared_result = await db.execute(
        select(ProjectShare.project_id).where(
            (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email)
        )
    )
    shared_ids = [row[0] for row in shared_result.all()]

    from sqlalchemy import or_
    query = (
        select(Project)
        .where(or_(Project.owner_id == user.id, Project.id.in_(shared_ids)) if shared_ids else Project.owner_id == user.id)
        .order_by(Project.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    projects = result.scalars().all()
    return [_project_to_dict(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get project details including buildings and documents. Requires viewer permission."""
    await check_project_permission(project_id, user, db, required="viewer")

    result = await db.execute(
        select(Project)
        .options(selectinload(Project.buildings), selectinload(Project.documents))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_to_dict(project, include_relations=True)


@router.put("/{project_id}", response_model=ProjectListResponse)
async def update_project(
    project_id: uuid.UUID,
    project_in: ProjectUpdate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Update project details. Requires editor permission."""
    await check_project_permission(project_id, user, db, required="editor")

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = project_in.model_dump(exclude_unset=True, mode="json")
    for field, value in update_data.items():
        if field == "location" and value:
            from geoalchemy2.elements import WKTElement
            point = f"POINT({value['longitude']} {value['latitude']})"
            project.location = WKTElement(point, srid=4326)
        elif field != "location":
            setattr(project, field, value)

    await db.flush()
    await db.refresh(project)
    return _project_to_dict(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete a project and all associated data. Only the project owner can delete."""
    perm = await check_project_permission(project_id, user, db, required="editor")
    if perm != "owner":
        raise HTTPException(status_code=403, detail="Only the project owner can delete this project")

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)

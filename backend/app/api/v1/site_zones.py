"""
Site Zone management API endpoints.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.elements import WKTElement
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_auth
from app.models.models import Project, ProjectShare, SiteZone, User
from app.schemas.schemas import SiteZoneCreate, SiteZoneResponse, SiteZoneUpdate

router = APIRouter()


def _zone_to_response(zone: SiteZone) -> dict:
    """Convert a SiteZone ORM object to a response dict with coordinates."""
    coords: list[list[float]] = []
    if zone.geometry is not None:
        try:
            shape = to_shape(zone.geometry)
            coords = [[c[0], c[1]] for c in shape.exterior.coords[:-1]]  # Exclude closing point
        except Exception:
            pass

    return {
        "id": zone.id,
        "project_id": zone.project_id,
        "name": zone.name,
        "zone_type": zone.zone_type,
        "coordinates": coords,
        "color": zone.color,
        "properties": zone.properties,
        "sort_order": zone.sort_order,
        "created_at": zone.created_at,
        "updated_at": zone.updated_at,
    }


@router.get("/projects/{project_id}/zones", response_model=list[SiteZoneResponse])
async def list_zones(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """List all site zones in a project, ordered by sort_order."""
    result = await db.execute(
        select(SiteZone)
        .where(SiteZone.project_id == project_id)
        .order_by(SiteZone.sort_order, SiteZone.created_at)
    )
    zones = result.scalars().all()
    return [_zone_to_response(z) for z in zones]


@router.post(
    "/projects/{project_id}/zones",
    response_model=SiteZoneResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_zone(
    project_id: uuid.UUID,
    zone_in: SiteZoneCreate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create a site zone in a project."""
    # Verify project exists
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check editor permission
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to add zones to this project")

    # Convert coordinates to WKT POLYGON
    coords = zone_in.coordinates
    # De-duplicate nearly-identical consecutive vertices
    unique_coords: list[list[float]] = []
    for c in coords:
        if not unique_coords or abs(c[0] - unique_coords[-1][0]) > 1e-7 or abs(c[1] - unique_coords[-1][1]) > 1e-7:
            unique_coords.append(c)
    coords = unique_coords
    if len(coords) < 3:
        raise HTTPException(status_code=400, detail="Polygon must have at least 3 unique vertices")
    # Close the polygon if not already closed
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    coords_str = ", ".join(f"{c[0]} {c[1]}" for c in coords)

    zone = SiteZone(
        project_id=project_id,
        name=zone_in.name,
        zone_type=zone_in.zone_type,
        geometry=WKTElement(f"POLYGON(({coords_str}))", srid=4326),
        color=zone_in.color,
        properties=zone_in.properties,
        sort_order=zone_in.sort_order,
    )

    db.add(zone)
    await db.flush()
    await db.refresh(zone)

    return _zone_to_response(zone)


@router.put("/{zone_id}", response_model=SiteZoneResponse)
async def update_zone(
    zone_id: uuid.UUID,
    zone_in: SiteZoneUpdate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Update a site zone's properties or geometry."""
    result = await db.execute(select(SiteZone).where(SiteZone.id == zone_id))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == zone.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == zone.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to edit zones in this project")

    update_data = zone_in.model_dump(exclude_unset=True)

    # Handle coordinates → geometry conversion
    if "coordinates" in update_data:
        coords = update_data.pop("coordinates")
        if coords and len(coords) >= 3:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            coords_str = ", ".join(f"{c[0]} {c[1]}" for c in coords)
            zone.geometry = WKTElement(f"POLYGON(({coords_str}))", srid=4326)

    for field, value in update_data.items():
        setattr(zone, field, value)

    await db.flush()
    await db.refresh(zone)
    return _zone_to_response(zone)


@router.delete("/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(
    zone_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete a site zone."""
    result = await db.execute(select(SiteZone).where(SiteZone.id == zone_id))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == zone.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == zone.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to delete zones in this project")

    await db.delete(zone)

"""
Building management API endpoints.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import require_auth
from app.models.models import Building, Project, ProjectShare, User
from app.schemas.schemas import (
    BuildingCreate, BuildingResponse, BuildingUpdate,
    GenerateRequest, GenerateFromImageRequest, GenerationStatusResponse, AITemplate,
)

router = APIRouter()
settings = get_settings()


@router.get("/projects/{project_id}/buildings", response_model=list[BuildingResponse])
async def list_buildings(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """List all buildings in a project."""
    result = await db.execute(
        select(Building).where(Building.project_id == project_id).order_by(Building.created_at)
    )
    return result.scalars().all()


@router.post(
    "/projects/{project_id}/buildings",
    response_model=BuildingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_building(
    project_id: uuid.UUID,
    building_in: BuildingCreate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Manually add a building to a project."""
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
            raise HTTPException(status_code=403, detail="Not authorized to add buildings to this project")

    building = Building(
        project_id=project_id,
        name=building_in.name,
        height_meters=building_in.height_meters,
        floor_count=building_in.floor_count,
        floor_height_meters=building_in.floor_height_meters,
        roof_type=building_in.roof_type,
        construction_phase=building_in.construction_phase,
        specifications=building_in.specifications,
    )

    if building_in.footprint_coordinates:
        from geoalchemy2.elements import WKTElement
        coords = building_in.footprint_coordinates
        # Close the polygon if not already closed
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        coords_str = ", ".join(f"{c[0]} {c[1]}" for c in coords)
        building.footprint = WKTElement(f"POLYGON(({coords_str}))", srid=4326)

    db.add(building)
    await db.flush()
    await db.refresh(building)

    # Log activity
    from app.api.v1.activity import log_activity
    await log_activity(db, project_id, "building_created", user_id=user.id, details={"name": building.name})

    return building


@router.get("/{building_id}", response_model=BuildingResponse)
async def get_building(
    building_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get building details."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    return building


@router.put("/{building_id}", response_model=BuildingResponse)
async def update_building(
    building_id: uuid.UUID,
    building_in: BuildingUpdate,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Update building details."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == building.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == building.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to edit buildings in this project")

    for field, value in building_in.model_dump(exclude_unset=True).items():
        setattr(building, field, value)

    await db.flush()
    await db.refresh(building)
    return building


@router.delete("/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_building(
    building_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete a building."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == building.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == building.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to delete buildings in this project")

    await db.delete(building)


@router.get("/{building_id}/model")
async def get_building_model(
    building_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get the 3D model URL for a building."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    if not building.model_url:
        raise HTTPException(status_code=404, detail="3D model not yet generated")
    return {"model_url": building.model_url}


@router.get("/{building_id}/model/file")
async def get_building_model_file(
    building_id: uuid.UUID,
    lod: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Proxy the GLB model file from MinIO storage.

    Query params:
        lod: LOD level (0=full detail, 1=simplified, 2=textured box, 3=simple box)
    """
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    if not building.model_url:
        raise HTTPException(status_code=404, detail="3D model not yet generated")

    # Pick the right URL based on LOD level
    model_url = building.model_url
    if lod > 0 and building.lod_urls:
        lod_url = building.lod_urls.get(str(lod))
        if lod_url:
            model_url = lod_url
        else:
            # Fall back to closest available LOD
            available = sorted(int(k) for k in building.lod_urls.keys())
            closest = min(available, key=lambda x: abs(x - lod))
            model_url = building.lod_urls[str(closest)]

    import boto3
    from botocore.config import Config

    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4"),
    )

    # Extract the key from the model URL
    url_parts = model_url.split(f"/{settings.s3_bucket_name}/", 1)
    if len(url_parts) != 2:
        raise HTTPException(status_code=500, detail="Invalid model URL")
    file_key = url_parts[1]

    try:
        obj = s3_client.get_object(Bucket=settings.s3_bucket_name, Key=file_key)
        file_data = obj["Body"].read()
    except Exception:
        raise HTTPException(status_code=404, detail="Model file not found in storage")

    return Response(
        content=file_data,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": f'inline; filename="{building_id}_lod{lod}.glb"',
            "Access-Control-Allow-Origin": "*",
        },
    )


# =============================================================================
# AI 3D Generation Endpoints
# =============================================================================

AI_TEMPLATES = [
    # Commercial
    AITemplate(id="com-office", name="Modern Glass Office Building", category="commercial",
               prompt="Modern glass office building, 10 stories, curtain wall facade, realistic architectural style"),
    AITemplate(id="com-retail", name="Retail Storefront with Awning", category="commercial",
               prompt="Single-story retail storefront with fabric awning, large display windows, brick facade"),
    AITemplate(id="com-mixed", name="Mixed-Use Building", category="commercial",
               prompt="Mixed-use building with ground-floor retail and upper residential units, modern facade, 5 stories"),
    # Residential
    AITemplate(id="res-house", name="Two-Story Suburban House", category="residential",
               prompt="Two-story suburban house with attached garage, gabled roof, vinyl siding, front porch"),
    AITemplate(id="res-apartment", name="Modern Apartment Building", category="residential",
               prompt="Modern apartment building, 8 stories, balconies on each floor, flat roof, contemporary design"),
    AITemplate(id="res-townhouse", name="Townhouse Row", category="residential",
               prompt="Row of three attached townhouses, brick facade, bay windows, pitched roofs"),
    # Infrastructure
    AITemplate(id="inf-parking", name="Parking Garage Structure", category="infrastructure",
               prompt="Multi-level parking garage structure, 4 levels, concrete, open-air design with ramps"),
    AITemplate(id="inf-busstop", name="Bus Stop Shelter", category="infrastructure",
               prompt="Modern bus stop shelter with glass walls, metal roof, bench seating, LED lighting"),
    AITemplate(id="inf-bridge", name="Pedestrian Bridge", category="infrastructure",
               prompt="Modern pedestrian bridge with steel cable stays, glass railings, covered walkway"),
    # Landscaping
    AITemplate(id="land-gazebo", name="Park Gazebo", category="landscaping",
               prompt="Octagonal park gazebo with white painted wood, shingled roof, built-in benches"),
    AITemplate(id="land-playground", name="Playground Equipment", category="landscaping",
               prompt="Children's playground set with slides, swings, climbing frame, colorful design"),
    AITemplate(id="land-fountain", name="Garden Fountain", category="landscaping",
               prompt="Circular stone garden fountain with three tiers, water feature, classical style"),
]


@router.post("/{building_id}/generate", response_model=GenerationStatusResponse)
async def generate_from_text(
    building_id: uuid.UUID,
    req: GenerateRequest,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Start AI 3D model generation from a text prompt."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Check editor permission
    proj_result = await db.execute(select(Project).where(Project.id == building.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == building.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized")

    # Update building with generation info
    building.generation_status = "generating"
    building.generation_prompt = req.prompt
    await db.flush()

    # Queue Celery task
    from app.tasks.processing import generate_3d_model_ai
    generate_3d_model_ai.delay(str(building_id), req.prompt, "text")

    return GenerationStatusResponse(
        status="generating",
        progress=0,
        meshy_task_id=building.meshy_task_id,
    )


@router.post("/{building_id}/generate-from-image", response_model=GenerationStatusResponse)
async def generate_from_image(
    building_id: uuid.UUID,
    req: GenerateFromImageRequest,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Start AI 3D model generation from an image."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Check editor permission
    proj_result = await db.execute(select(Project).where(Project.id == building.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == building.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized")

    building.generation_status = "generating"
    building.generation_prompt = f"[image] {req.image_url}"
    await db.flush()

    from app.tasks.processing import generate_3d_model_ai
    generate_3d_model_ai.delay(str(building_id), "", "image", req.image_url)

    return GenerationStatusResponse(
        status="generating",
        progress=0,
        meshy_task_id=building.meshy_task_id,
    )


@router.get("/{building_id}/generation-status", response_model=GenerationStatusResponse)
async def get_generation_status(
    building_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get the current AI generation status for a building."""
    result = await db.execute(select(Building).where(Building.id == building_id))
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    # Try to get progress from Celery task
    progress = None
    if building.generation_status == "generating" and building.meshy_task_id:
        progress = 50  # Approximate progress when we know it's running

    return GenerationStatusResponse(
        status=building.generation_status or "idle",
        progress=progress,
        model_url=building.model_url if building.generation_status == "completed" else None,
        meshy_task_id=building.meshy_task_id,
    )


@router.get("/ai/templates", response_model=list[AITemplate])
async def get_ai_templates():
    """Get the list of pre-built AI generation templates."""
    return AI_TEMPLATES

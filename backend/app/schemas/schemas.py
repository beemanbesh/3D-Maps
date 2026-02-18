"""
Pydantic schemas for API request/response validation.

These schemas define the contract for all REST API endpoints,
including input validation, serialization, and OpenAPI documentation.
"""

import uuid
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# =============================================================================
# Auth Schemas
# =============================================================================

class UserCreate(BaseModel):
    """Register a new user account."""
    email: EmailStr = Field(description="User's email address (must be unique)")
    password: str = Field(min_length=8, description="Password, minimum 8 characters")
    full_name: Optional[str] = Field(None, description="User's display name")


class LoginRequest(BaseModel):
    """Credentials for user authentication."""
    email: EmailStr = Field(description="Registered email address")
    password: str = Field(description="Account password")


class UserResponse(BaseModel):
    """Public user profile information."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = Field(description="Unique user identifier")
    email: str = Field(description="Email address")
    full_name: Optional[str] = Field(description="Display name")
    role: str = Field(description="User role: viewer, editor, or admin")
    is_active: bool = Field(description="Whether the account is active")
    created_at: datetime = Field(description="Account creation timestamp")


class TokenResponse(BaseModel):
    """JWT authentication tokens returned after login."""
    access_token: str = Field(description="Short-lived access token (30 min)")
    refresh_token: str = Field(description="Long-lived refresh token (7 days)")
    token_type: str = "bearer"
    user: UserResponse


class RefreshRequest(BaseModel):
    """Request to exchange a refresh token for a new access token."""
    refresh_token: str = Field(description="Valid refresh token")


# =============================================================================
# Location Schemas
# =============================================================================

class LocationInput(BaseModel):
    """Geographic location with optional address."""
    latitude: float = Field(ge=-90, le=90, description="Latitude in decimal degrees (-90 to 90)")
    longitude: float = Field(ge=-180, le=180, description="Longitude in decimal degrees (-180 to 180)")
    address: Optional[str] = Field(None, description="Human-readable address (geocoded)")


class LocationResponse(BaseModel):
    """Geographic location returned in API responses."""
    latitude: float = Field(description="Latitude in decimal degrees")
    longitude: float = Field(description="Longitude in decimal degrees")
    address: Optional[str] = Field(None, description="Human-readable address")


# =============================================================================
# Project Schemas
# =============================================================================

class ConstructionPhaseInput(BaseModel):
    """Define a construction phase for timeline visualization."""
    phase_number: int = Field(ge=1, description="Phase sequence number (1-based)")
    name: str = Field(max_length=100, description="Phase name, e.g. 'Foundation' or 'Phase 2'")
    start_date: Optional[date] = Field(None, description="Phase start date")
    end_date: Optional[date] = Field(None, description="Phase end date")
    color: Optional[str] = Field(None, description="Hex color for 3D viewer, e.g. '#3b82f6'")


class ProjectCreate(BaseModel):
    """Create a new development project."""
    name: str = Field(max_length=255, description="Project name")
    description: Optional[str] = Field(None, description="Project description")
    location: Optional[LocationInput] = Field(None, description="Project site location")
    construction_phases: Optional[list[ConstructionPhaseInput]] = Field(None, description="Ordered list of construction phases")


class ProjectUpdate(BaseModel):
    """Update an existing project. All fields are optional."""
    name: Optional[str] = Field(None, max_length=255, description="Updated project name")
    description: Optional[str] = Field(None, description="Updated description")
    location: Optional[LocationInput] = Field(None, description="Updated location")
    status: Optional[str] = Field(None, description="Project status: draft, processing, ready, archived")
    construction_phases: Optional[list[ConstructionPhaseInput]] = Field(None, description="Updated construction phases")


class ProjectResponse(BaseModel):
    """Full project details including buildings and documents."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = Field(description="Unique project identifier")
    name: str = Field(description="Project name")
    description: Optional[str] = Field(description="Project description")
    status: str = Field(description="Current status: draft, processing, ready, archived")
    location: Optional[LocationResponse] = Field(None, description="Project site location")
    construction_phases: Optional[list[dict[str, Any]]] = Field(None, description="Construction phase definitions")
    created_at: datetime = Field(description="Creation timestamp")
    updated_at: datetime = Field(description="Last update timestamp")
    owner_id: uuid.UUID = Field(description="Owner user ID")
    buildings: list["BuildingResponse"] = Field(default=[], description="Buildings in this project")
    documents: list["DocumentResponse"] = Field(default=[], description="Uploaded documents")


class ProjectListResponse(BaseModel):
    """Summarized project for list views."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = Field(description="Unique project identifier")
    name: str = Field(description="Project name")
    description: Optional[str] = Field(description="Project description")
    status: str = Field(description="Current status")
    location: Optional[LocationResponse] = Field(None, description="Project site location")
    created_at: datetime = Field(description="Creation timestamp")
    updated_at: datetime = Field(description="Last update timestamp")


# =============================================================================
# Building Schemas
# =============================================================================

class BuildingCreate(BaseModel):
    """Create a building within a project."""
    name: Optional[str] = Field(None, description="Building name, e.g. 'Tower A'")
    height_meters: Optional[float] = Field(None, gt=0, description="Total building height in meters")
    floor_count: Optional[int] = Field(None, gt=0, description="Number of floors/stories")
    floor_height_meters: Optional[float] = Field(None, gt=0, description="Height per floor in meters")
    roof_type: Optional[str] = Field(None, description="Roof type: flat, gabled, or hipped")
    construction_phase: Optional[int] = Field(None, description="Construction phase number this building belongs to")
    footprint_coordinates: Optional[list[list[float]]] = Field(None, description="Building footprint as [[x,y], ...] polygon coordinates")
    specifications: Optional[dict[str, Any]] = Field(None, description="Additional specs: facade_material, total_area_sqm, etc.")


class BuildingUpdate(BaseModel):
    """Update building properties. All fields are optional."""
    name: Optional[str] = Field(None, description="Updated building name")
    height_meters: Optional[float] = Field(None, gt=0, description="Updated height in meters")
    floor_count: Optional[int] = Field(None, gt=0, description="Updated floor count")
    floor_height_meters: Optional[float] = Field(None, gt=0, description="Updated floor height")
    roof_type: Optional[str] = Field(None, description="Updated roof type: flat, gabled, or hipped")
    construction_phase: Optional[int] = Field(None, description="Updated construction phase")
    specifications: Optional[dict[str, Any]] = Field(None, description="Updated specifications")


class BuildingResponse(BaseModel):
    """Building details including 3D model URLs."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = Field(description="Unique building identifier")
    project_id: uuid.UUID = Field(description="Parent project ID")
    name: Optional[str] = Field(description="Building name")
    height_meters: Optional[float] = Field(description="Total height in meters")
    floor_count: Optional[int] = Field(description="Number of floors")
    floor_height_meters: Optional[float] = Field(description="Height per floor in meters")
    roof_type: Optional[str] = Field(description="Roof type: flat, gabled, or hipped")
    construction_phase: Optional[int] = Field(description="Construction phase number")
    model_url: Optional[str] = Field(description="URL to the generated GLB 3D model")
    lod_urls: Optional[dict[str, str]] = Field(None, description="LOD variant URLs: {'0': full, '1': simplified, ...}")
    specifications: Optional[dict[str, Any]] = Field(description="Additional specifications (materials, area, AI confidence, etc.)")
    generation_status: Optional[str] = Field(None, description="AI generation status: idle, generating, completed, failed")
    generation_prompt: Optional[str] = Field(None, description="Text prompt used for AI generation")
    meshy_task_id: Optional[str] = Field(None, description="Meshy.ai task ID for tracking")
    created_at: datetime = Field(description="Creation timestamp")


# =============================================================================
# Document Schemas
# =============================================================================

class DocumentResponse(BaseModel):
    """Uploaded document with processing status."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = Field(description="Unique document identifier")
    project_id: uuid.UUID = Field(description="Parent project ID")
    filename: str = Field(description="Original filename")
    file_type: str = Field(description="File extension: pdf, jpg, png, dxf, xlsx, csv, geojson")
    file_size_bytes: int = Field(description="File size in bytes")
    processing_status: str = Field(description="Processing status: pending, processing, completed, failed")
    uploaded_at: datetime = Field(description="Upload timestamp")
    processed_at: Optional[datetime] = Field(description="Processing completion timestamp")


class ProcessingStatusResponse(BaseModel):
    """Real-time status of a Celery processing task."""
    job_id: str = Field(description="Celery task ID")
    status: str = Field(description="Task state: PENDING, PROCESSING, GENERATING, SUCCESS, FAILURE")
    progress: Optional[float] = Field(None, description="Progress percentage (0.0 to 1.0)")
    message: Optional[str] = Field(None, description="Current processing step description")
    result: Optional[dict[str, Any]] = Field(None, description="Task result when completed")


# =============================================================================
# Project Sharing Schemas
# =============================================================================

class ShareProjectRequest(BaseModel):
    email: EmailStr
    permission: str = Field("viewer", pattern="^(viewer|editor)$")


class ShareResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: Optional[uuid.UUID]
    email: Optional[str]
    permission: str
    is_public_link: bool
    invite_token: Optional[str] = None
    created_at: datetime


class PublicLinkResponse(BaseModel):
    token: str
    url: str


# =============================================================================
# Annotation Schemas
# =============================================================================

class AnnotationCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    building_id: Optional[uuid.UUID] = None
    position_x: float
    position_y: float
    position_z: float


class AnnotationUpdate(BaseModel):
    text: Optional[str] = Field(None, min_length=1, max_length=2000)
    resolved: Optional[bool] = None


class AnnotationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    building_id: Optional[uuid.UUID]
    author_id: uuid.UUID
    text: str
    position_x: float
    position_y: float
    position_z: float
    resolved: bool
    created_at: datetime


# =============================================================================
# Site Zone Schemas
# =============================================================================

class SiteZoneCreate(BaseModel):
    """Create a site zone within a project."""
    name: Optional[str] = Field(None, description="Zone label")
    zone_type: str = Field(description="Zone type: building, residential, road, green_space, parking, water, development_area")
    coordinates: list[list[float]] = Field(description="Polygon vertices as [[lng, lat], ...]")
    color: str = Field(default="#9b59b6", description="Hex color for the zone")
    properties: Optional[dict[str, Any]] = Field(None, description="Type-specific properties (height, floors, tree_density, etc.)")
    sort_order: int = Field(default=0, description="Display order")


class SiteZoneUpdate(BaseModel):
    """Update a site zone. All fields are optional."""
    name: Optional[str] = Field(None, description="Updated zone label")
    zone_type: Optional[str] = Field(None, description="Updated zone type")
    coordinates: Optional[list[list[float]]] = Field(None, description="Updated polygon vertices")
    color: Optional[str] = Field(None, description="Updated hex color")
    properties: Optional[dict[str, Any]] = Field(None, description="Updated type-specific properties")
    sort_order: Optional[int] = Field(None, description="Updated display order")


class SiteZoneResponse(BaseModel):
    """Site zone details with polygon coordinates."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    name: Optional[str]
    zone_type: str
    coordinates: list[list[float]] = Field(default=[], description="Polygon vertices as [[lng, lat], ...]")
    color: str
    properties: Optional[dict[str, Any]]
    sort_order: int
    created_at: datetime
    updated_at: datetime


# =============================================================================
# 3D Generation Schemas
# =============================================================================

class BuildingData(BaseModel):
    """Normalized building data for 3D generation."""
    id: str
    footprint: list[list[float]]  # [[x,y], [x,y], ...]
    height: float
    floors: int
    floor_height: float = 3.0
    roof_type: str = "flat"
    materials: dict[str, str] = Field(default_factory=lambda: {"facade": "concrete", "roof": "flat"})
    features: dict[str, Any] = Field(default_factory=dict)


class ProjectData(BaseModel):
    """Full normalized project data for 3D scene generation."""
    project_name: str
    location: LocationInput
    buildings: list[BuildingData]
    site_features: list[dict[str, Any]] = Field(default_factory=list)


# =============================================================================
# AI Generation Schemas
# =============================================================================

class GenerateRequest(BaseModel):
    """Request to generate a 3D model from a text prompt."""
    prompt: str = Field(min_length=3, max_length=500, description="Text description of the 3D model to generate")
    art_style: str = Field(default="realistic", description="Art style: realistic, cartoon, low-poly, sculpture")
    negative_prompt: Optional[str] = Field(None, max_length=500, description="What to avoid in generation")


class GenerateFromImageRequest(BaseModel):
    """Request to generate a 3D model from an image."""
    image_url: str = Field(description="URL of the source image")


class GenerationStatusResponse(BaseModel):
    """Status of an AI 3D generation task."""
    status: str = Field(description="Generation status: idle, generating, completed, failed")
    progress: Optional[float] = Field(None, description="Progress percentage (0-100)")
    model_url: Optional[str] = Field(None, description="URL to the generated GLB model when completed")
    error: Optional[str] = Field(None, description="Error message if generation failed")
    meshy_task_id: Optional[str] = Field(None, description="Meshy task ID for external tracking")


class AITemplate(BaseModel):
    """Pre-built template for AI 3D model generation."""
    id: str = Field(description="Unique template identifier")
    name: str = Field(description="Display name")
    category: str = Field(description="Category: commercial, residential, infrastructure, landscaping")
    prompt: str = Field(description="Text prompt for generation")
    thumbnail_url: Optional[str] = Field(None, description="Preview thumbnail URL")

"""
Document upload and processing API endpoints.
"""

import logging
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import get_current_user, require_auth
from app.models.models import Document, Project, ProjectShare, User
from app.schemas.schemas import DocumentResponse, ProcessingStatusResponse
from app.tasks.worker import celery_app

router = APIRouter()
settings = get_settings()

ALLOWED_FILE_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tiff": "image/tiff",
    ".dwg": "application/acad",
    ".dxf": "application/dxf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".geojson": "application/geo+json",
}


@router.post(
    "/projects/{project_id}/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User | None = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document to a project for processing."""
    # Verify project exists
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check write permission
    if user and project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to upload to this project")

    # Validate file type
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Supported: {', '.join(ALLOWED_FILE_TYPES.keys())}",
        )

    # Validate file size
    contents = await file.read()
    if len(contents) > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.max_upload_size_mb}MB",
        )

    # Upload to S3 storage
    file_key = f"projects/{project_id}/documents/{uuid.uuid4()}{file_ext}"
    storage_url = await _upload_to_storage(file_key, contents, ALLOWED_FILE_TYPES[file_ext])

    # Create document record
    document = Document(
        project_id=project_id,
        filename=file.filename,
        file_type=file_ext.lstrip("."),
        file_size_bytes=len(contents),
        storage_url=storage_url,
        processing_status="pending",
    )
    db.add(document)
    await db.flush()
    await db.refresh(document)

    # Log activity
    from app.api.v1.activity import log_activity
    await log_activity(db, project_id, "document_uploaded", user_id=user.id if user else None, details={"filename": file.filename, "file_type": file_ext})

    # Trigger async processing
    from app.tasks.processing import process_document
    process_document.delay(str(document.id))

    return document


@router.post("/{document_id}/process", response_model=ProcessingStatusResponse)
async def trigger_processing(
    document_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Trigger or re-trigger document processing."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == document.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == document.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to process documents in this project")

    document.processing_status = "pending"
    await db.flush()

    # Queue processing task
    from app.tasks.processing import process_document
    task = process_document.delay(str(document.id))

    return ProcessingStatusResponse(
        job_id=task.id,
        status="queued",
        message=f"Document '{document.filename}' queued for processing",
    )


@router.get("/status/{job_id}", response_model=ProcessingStatusResponse)
async def get_processing_status(job_id: str):
    """Check the status of a document processing job."""
    result = celery_app.AsyncResult(job_id)

    # Map Celery states to our status values
    state = result.state
    meta = result.info if isinstance(result.info, dict) else {}

    if state == "PENDING":
        return ProcessingStatusResponse(
            job_id=job_id,
            status="queued",
            progress=0.0,
            message="Task is waiting in queue",
        )
    elif state == "PROCESSING":
        return ProcessingStatusResponse(
            job_id=job_id,
            status="processing",
            progress=meta.get("progress", 0.0),
            message=f"Step: {meta.get('step', 'unknown')}",
        )
    elif state == "GENERATING":
        return ProcessingStatusResponse(
            job_id=job_id,
            status="generating",
            progress=meta.get("progress", 0.0),
            message=f"Step: {meta.get('step', 'unknown')}",
        )
    elif state == "SUCCESS":
        return ProcessingStatusResponse(
            job_id=job_id,
            status="completed",
            progress=1.0,
            message="Processing complete",
            result=result.result if isinstance(result.result, dict) else None,
        )
    elif state == "FAILURE":
        return ProcessingStatusResponse(
            job_id=job_id,
            status="failed",
            progress=0.0,
            message=str(result.info) if result.info else "Processing failed",
        )
    else:
        return ProcessingStatusResponse(
            job_id=job_id,
            status=state.lower(),
            progress=meta.get("progress", 0.0),
            message=f"State: {state}",
        )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete a document and its file from storage."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Check editor permission on parent project
    proj_result = await db.execute(select(Project).where(Project.id == document.project_id))
    project = proj_result.scalar_one_or_none()
    if project.owner_id != user.id:
        share_result = await db.execute(
            select(ProjectShare).where(
                ProjectShare.project_id == document.project_id,
                (ProjectShare.user_id == user.id) | (ProjectShare.email == user.email),
                ProjectShare.permission == "editor",
            )
        )
        if not share_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not authorized to delete documents in this project")

    # Delete file from S3
    try:
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
        url_parts = document.storage_url.split(f"/{settings.s3_bucket_name}/", 1)
        if len(url_parts) == 2:
            s3_client.delete_object(Bucket=settings.s3_bucket_name, Key=url_parts[1])
    except Exception as e:
        logger.warning(f"Failed to delete file from storage: {e}")

    await db.delete(document)
    await db.flush()


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Serve the uploaded file by proxying from MinIO storage."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

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

    # Extract the key from the storage URL
    # URL format: http://minio:9000/bucket-name/key
    url_parts = document.storage_url.split(f"/{settings.s3_bucket_name}/", 1)
    if len(url_parts) != 2:
        raise HTTPException(status_code=500, detail="Invalid storage URL")
    file_key = url_parts[1]

    try:
        obj = s3_client.get_object(Bucket=settings.s3_bucket_name, Key=file_key)
        file_data = obj["Body"].read()
        content_type = obj.get("ContentType", "application/octet-stream")
    except Exception:
        raise HTTPException(status_code=404, detail="File not found in storage")

    return Response(content=file_data, media_type=content_type)


async def _upload_to_storage(key: str, data: bytes, content_type: str) -> str:
    """Upload file to S3-compatible storage."""
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

    # Ensure bucket exists
    try:
        s3_client.head_bucket(Bucket=settings.s3_bucket_name)
    except Exception:
        s3_client.create_bucket(Bucket=settings.s3_bucket_name)

    s3_client.put_object(
        Bucket=settings.s3_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

    return f"{settings.s3_endpoint_url}/{settings.s3_bucket_name}/{key}"

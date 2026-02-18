"""
Shared test fixtures for the 3D Development Platform backend.

Uses httpx.AsyncClient with FastAPI's TestClient pattern, overriding
the database dependency to use a fresh async SQLite database per test.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.main import app


# ---------------------------------------------------------------------------
# Fake DB session that bypasses the real PostgreSQL dependency
# ---------------------------------------------------------------------------

class FakeUser:
    """Minimal User stand-in for tests that need auth."""
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", uuid.uuid4())
        self.email = kwargs.get("email", "test@example.com")
        self.hashed_password = kwargs.get("hashed_password", hash_password("testpass123"))
        self.full_name = kwargs.get("full_name", "Test User")
        self.role = kwargs.get("role", "editor")
        self.is_active = kwargs.get("is_active", True)
        self.created_at = kwargs.get("created_at", datetime.now(timezone.utc))


class FakeProject:
    """Minimal Project stand-in for tests."""
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", uuid.uuid4())
        self.name = kwargs.get("name", "Test Project")
        self.description = kwargs.get("description", None)
        self.status = kwargs.get("status", "draft")
        self.owner_id = kwargs.get("owner_id", uuid.uuid4())
        self.location = None
        self.construction_phases = kwargs.get("construction_phases", None)
        self.created_at = kwargs.get("created_at", datetime.now(timezone.utc))
        self.updated_at = kwargs.get("updated_at", datetime.now(timezone.utc))
        self.buildings = kwargs.get("buildings", [])
        self.documents = kwargs.get("documents", [])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def test_user():
    """A default test user."""
    return FakeUser()


@pytest.fixture
def auth_headers(test_user):
    """Authorization headers with a valid access token for test_user."""
    token = create_access_token(str(test_user.id), test_user.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_db():
    """A mock AsyncSession that tests can configure per-test."""
    session = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.close = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    session.delete = AsyncMock()
    return session


@pytest.fixture
async def client(mock_db):
    """
    HTTPX async client wired to the FastAPI app with the DB dependency
    overridden to return mock_db.
    """
    async def override_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

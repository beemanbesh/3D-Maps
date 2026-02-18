"""
Tests for authentication API endpoints.

Uses mock DB to avoid needing a real PostgreSQL instance.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.security import create_access_token, create_refresh_token, hash_password
from tests.conftest import FakeUser


@pytest.mark.anyio
async def test_register_success(client, mock_db):
    # Mock: no existing user found
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)

    # Mock flush/refresh to set user attributes
    user_id = uuid.uuid4()

    async def fake_refresh(user):
        user.id = user_id
        user.is_active = True
        user.created_at = "2025-01-01T00:00:00Z"
        user.role = "editor"

    mock_db.refresh = AsyncMock(side_effect=fake_refresh)

    response = await client.post("/api/v1/auth/register", json={
        "email": "new@example.com",
        "password": "securepassword",
        "full_name": "New User",
    })

    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "new@example.com"
    assert data["full_name"] == "New User"


@pytest.mark.anyio
async def test_register_duplicate_email(client, mock_db):
    existing = FakeUser(email="taken@example.com")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/register", json={
        "email": "taken@example.com",
        "password": "securepassword",
    })

    assert response.status_code == 409
    assert "already registered" in response.json()["detail"]


@pytest.mark.anyio
async def test_register_short_password(client):
    response = await client.post("/api/v1/auth/register", json={
        "email": "a@b.com",
        "password": "short",
    })
    assert response.status_code == 422


@pytest.mark.anyio
async def test_login_success(client, mock_db):
    user = FakeUser(
        email="user@example.com",
        hashed_password=hash_password("correctpass"),
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/login", json={
        "email": "user@example.com",
        "password": "correctpass",
    })

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "user@example.com"


@pytest.mark.anyio
async def test_login_wrong_password(client, mock_db):
    user = FakeUser(hashed_password=hash_password("rightpass"))
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/login", json={
        "email": "user@example.com",
        "password": "wrongpass",
    })

    assert response.status_code == 401


@pytest.mark.anyio
async def test_login_nonexistent_user(client, mock_db):
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/login", json={
        "email": "nobody@example.com",
        "password": "any",
    })

    assert response.status_code == 401


@pytest.mark.anyio
async def test_login_inactive_user(client, mock_db):
    user = FakeUser(
        hashed_password=hash_password("pass12345"),
        is_active=False,
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/login", json={
        "email": "user@example.com",
        "password": "pass12345",
    })

    assert response.status_code == 403


@pytest.mark.anyio
async def test_me_authenticated(client, mock_db, test_user, auth_headers):
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = test_user
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.get("/api/v1/auth/me", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["email"] == test_user.email


@pytest.mark.anyio
async def test_me_unauthenticated(client):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_refresh_token_success(client, mock_db, test_user):
    refresh = create_refresh_token(str(test_user.id))

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = test_user
    mock_db.execute = AsyncMock(return_value=mock_result)

    response = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": refresh,
    })

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.anyio
async def test_refresh_with_access_token_fails(client, mock_db, test_user):
    access = create_access_token(str(test_user.id))

    response = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": access,
    })

    assert response.status_code == 401

"""
Tests for health check and basic app setup.
"""

import pytest


@pytest.mark.anyio
async def test_health_check(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


@pytest.mark.anyio
async def test_docs_available(client):
    response = await client.get("/docs")
    assert response.status_code == 200


@pytest.mark.anyio
async def test_nonexistent_route_returns_404(client):
    response = await client.get("/api/v1/nonexistent")
    assert response.status_code in (404, 405)

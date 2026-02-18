"""
Context data API endpoints — fetch surrounding buildings from OpenStreetMap.
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


@router.get("/buildings")
async def get_context_buildings(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius: int = Query(500, ge=100, le=2000),
):
    """Fetch building footprints from OSM Overpass API around a lat/lon.

    Returns simplified building data for 3D context rendering.
    """
    # Overpass QL query for buildings within radius
    query = f"""
    [out:json][timeout:15];
    (
      way["building"](around:{radius},{lat},{lon});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(OVERPASS_URL, data={"data": query})
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Overpass API timed out")
    except Exception as e:
        logger.error(f"Overpass API error: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch OSM data")

    # Parse Overpass response into building footprints
    nodes = {}
    buildings = []

    for element in data.get("elements", []):
        if element["type"] == "node":
            nodes[element["id"]] = {"lat": element["lat"], "lon": element["lon"]}

    for element in data.get("elements", []):
        if element["type"] != "way":
            continue

        tags = element.get("tags", {})
        if "building" not in tags:
            continue

        # Resolve node IDs to coordinates
        coords = []
        for nid in element.get("nodes", []):
            node = nodes.get(nid)
            if node:
                coords.append([node["lon"], node["lat"]])

        if len(coords) < 3:
            continue

        # Extract height from OSM tags
        height = _parse_height(tags)
        levels = _parse_int(tags.get("building:levels"))
        if not height and levels:
            height = levels * 3.0
        elif not height:
            height = 9.0  # Default 3-story building

        buildings.append({
            "osm_id": element["id"],
            "name": tags.get("name"),
            "height": height,
            "levels": levels,
            "building_type": tags.get("building"),
            "footprint": coords,
        })

    return {"buildings": buildings, "count": len(buildings)}


@router.get("/roads")
async def get_context_roads(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius: int = Query(500, ge=100, le=2000),
):
    """Fetch road geometries from OSM Overpass API around a lat/lon.

    Returns road polylines for 3D ground-plane rendering.
    """
    query = f"""
    [out:json][timeout:15];
    (
      way["highway"](around:{radius},{lat},{lon});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(OVERPASS_URL, data={"data": query})
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Overpass API timed out")
    except Exception as e:
        logger.error(f"Overpass API error: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch OSM data")

    nodes = {}
    roads = []

    for element in data.get("elements", []):
        if element["type"] == "node":
            nodes[element["id"]] = {"lat": element["lat"], "lon": element["lon"]}

    for element in data.get("elements", []):
        if element["type"] != "way":
            continue

        tags = element.get("tags", {})
        highway = tags.get("highway")
        if not highway:
            continue

        coords = []
        for nid in element.get("nodes", []):
            node = nodes.get(nid)
            if node:
                coords.append([node["lon"], node["lat"]])

        if len(coords) < 2:
            continue

        # Road width based on highway type
        width = _road_width(highway)

        roads.append({
            "osm_id": element["id"],
            "name": tags.get("name"),
            "highway_type": highway,
            "width": width,
            "coords": coords,
        })

    return {"roads": roads, "count": len(roads)}


ROAD_WIDTHS = {
    "motorway": 14.0,
    "trunk": 12.0,
    "primary": 10.0,
    "secondary": 8.0,
    "tertiary": 7.0,
    "residential": 6.0,
    "service": 4.0,
    "footway": 2.0,
    "cycleway": 2.5,
    "path": 1.5,
    "pedestrian": 4.0,
    "unclassified": 5.0,
}


def _road_width(highway_type: str) -> float:
    """Estimate road width from highway type."""
    return ROAD_WIDTHS.get(highway_type, 5.0)


def _parse_height(tags: dict) -> float | None:
    """Parse building height from OSM tags."""
    raw = tags.get("height") or tags.get("building:height")
    if not raw:
        return None
    # Remove units suffix (e.g. "12 m", "12m")
    cleaned = raw.replace("m", "").replace("M", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None

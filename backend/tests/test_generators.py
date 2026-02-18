"""
Tests for 3D building generation, GLB export, and normalization logic.
"""

import numpy as np
import pytest
import trimesh


class TestBuildingGenerator:
    """Tests for BuildingGenerator class."""

    def _make_generator(self):
        from app.generation.geometry.building_generator import BuildingGenerator
        return BuildingGenerator()

    def _simple_footprint(self):
        return np.array([
            [0, 0], [20, 0], [20, 15], [0, 15], [0, 0]
        ], dtype=float)

    def test_extrude_footprint_creates_mesh(self):
        gen = self._make_generator()
        mesh = gen._extrude_footprint(self._simple_footprint(), 10.0)
        assert mesh is not None
        assert isinstance(mesh, trimesh.Trimesh)
        assert len(mesh.faces) > 0
        assert len(mesh.vertices) > 0

    def test_extrude_footprint_rejects_degenerate(self):
        gen = self._make_generator()
        # Only 2 points — not a valid polygon
        degenerate = np.array([[0, 0], [10, 0]], dtype=float)
        result = gen._extrude_footprint(degenerate, 10.0)
        assert result is None

    def test_floor_plate_at_elevation(self):
        gen = self._make_generator()
        plate = gen._create_floor_plate(self._simple_footprint(), 3.0)
        assert plate is not None
        # Plate should be at roughly z=3.0
        assert plate.bounds[0, 2] >= 2.9

    def test_gabled_roof(self):
        gen = self._make_generator()
        roof = gen._gabled_roof(self._simple_footprint(), 10.0)
        assert roof is not None
        assert isinstance(roof, trimesh.Trimesh)
        assert len(roof.faces) == 6  # 6 triangular faces

    def test_hipped_roof(self):
        gen = self._make_generator()
        roof = gen._hipped_roof(self._simple_footprint(), 10.0)
        assert roof is not None
        assert len(roof.faces) == 4  # 4 triangular faces (pyramid)

    def test_flat_roof_returns_none(self):
        gen = self._make_generator()
        result = gen._generate_roof(self._simple_footprint(), 10.0, "flat")
        assert result is None

    def test_generate_windows(self):
        gen = self._make_generator()
        windows = gen._generate_windows(self._simple_footprint(), 3, 3.33, True)
        assert len(windows) > 0
        for w in windows:
            assert isinstance(w, trimesh.Trimesh)

    def test_generate_door(self):
        gen = self._make_generator()
        door = gen._generate_door(self._simple_footprint(), 3.33)
        assert door is not None
        assert isinstance(door, trimesh.Trimesh)

    def test_generate_balconies(self):
        gen = self._make_generator()
        balconies = gen._generate_balconies(self._simple_footprint(), 3, 3.33)
        # 2 upper floors × 2 meshes (slab + railing) = 4
        assert len(balconies) == 4

    def test_generate_building_scene(self):
        gen = self._make_generator()
        data = {
            "footprint": [[0, 0], [20, 0], [20, 15], [0, 15], [0, 0]],
            "height": 10.0,
            "floors": 3,
            "floor_height": 3.33,
            "roof_type": "gabled",
            "features": {"windows": True, "balconies": True},
        }
        scene = gen.generate_building(data)
        assert isinstance(scene, trimesh.Scene)
        names = list(scene.geometry.keys())
        assert "building_body" in names
        assert "roof" in names
        assert any(n.startswith("window_") for n in names)
        assert any(n.startswith("balcony_") for n in names)


class TestGLBExporter:
    """Tests for GLB export."""

    def test_export_to_bytes(self):
        from app.generation.geometry.building_generator import GLBExporter
        scene = trimesh.Scene()
        box = trimesh.creation.box(extents=[2, 3, 4])
        scene.add_geometry(box)
        data = GLBExporter.export_to_bytes(scene)
        assert isinstance(data, bytes)
        assert len(data) > 100
        # GLB magic bytes: "glTF"
        assert data[:4] == b"glTF"


class TestNormalization:
    """Tests for _normalize_extraction_data function."""

    def _make_mock_extraction(self, coordinates=None, text=""):
        class MockResult:
            def __init__(self, coords, txt):
                self._coords = coords or []
                self.text_content = txt
                self.images = []
            def to_dict(self):
                return {"coordinates": self._coords, "text_content": self.text_content}
        return MockResult(coordinates, text)

    def test_ai_buildings_normalized(self):
        from app.tasks.processing import _normalize_extraction_data
        extraction = self._make_mock_extraction()
        interpretation = {
            "buildings": [
                {
                    "name": "Tower A",
                    "height_meters": 30,
                    "floor_count": 10,
                    "width": 25,
                    "depth": 20,
                    "roof_type": "flat",
                    "_confidence": 0.85,
                }
            ],
            "confidence": 0.85,
        }
        result = _normalize_extraction_data(extraction, interpretation)
        assert len(result) == 1
        assert result[0]["name"] == "Tower A"
        assert result[0]["height_meters"] == 30
        assert result[0]["specifications"]["ai_confidence"] == 0.85

    def test_low_confidence_filtered(self):
        from app.tasks.processing import _normalize_extraction_data, CONFIDENCE_THRESHOLD
        extraction = self._make_mock_extraction()
        interpretation = {
            "buildings": [
                {"name": "Bad", "height_meters": 5, "_confidence": 0.1},
                {"name": "Good", "height_meters": 15, "_confidence": 0.8},
            ],
            "confidence": 0.5,
        }
        result = _normalize_extraction_data(extraction, interpretation)
        # Only the "Good" building should survive
        assert len(result) == 1
        assert result[0]["name"] == "Good"

    def test_fallback_default_building(self):
        from app.tasks.processing import _normalize_extraction_data
        extraction = self._make_mock_extraction()
        result = _normalize_extraction_data(extraction, {})
        assert len(result) == 1
        assert result[0]["name"] == "Building A"
        assert result[0]["height_meters"] == 10.0

    def test_floor_plan_interpretation_normalized(self):
        from app.tasks.processing import _normalize_extraction_data
        extraction = self._make_mock_extraction()
        interpretation = {
            "building_dimensions": {
                "width_meters": 30,
                "depth_meters": 20,
                "estimated_area_sqm": 600,
            },
            "floor_count": 5,
            "total_height_meters": 15,
            "roof_type": "gabled",
            "confidence": 0.7,
        }
        result = _normalize_extraction_data(extraction, interpretation)
        assert len(result) == 1
        assert result[0]["roof_type"] == "gabled"
        assert result[0]["floor_count"] == 5

    def test_coordinates_extraction_fallback(self):
        from app.tasks.processing import _normalize_extraction_data
        coords = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        extraction = self._make_mock_extraction(coordinates=coords)
        result = _normalize_extraction_data(extraction, {})
        assert len(result) == 1
        assert result[0]["footprint"] == coords[0]


class TestLODGenerator:
    """Tests for LOD generation."""

    def test_generate_lods(self):
        from app.generation.geometry.building_generator import LODGenerator
        mesh = trimesh.creation.box(extents=[10, 10, 10])
        # Subdivide to get more faces
        for _ in range(2):
            mesh = mesh.subdivide()
        lods = LODGenerator.generate_lods(mesh)
        assert 0 in lods
        assert len(lods) >= 2
        # Lower LOD levels should have fewer or equal faces
        for level in sorted(lods.keys()):
            if level > 0:
                assert len(lods[level].faces) <= len(lods[0].faces)

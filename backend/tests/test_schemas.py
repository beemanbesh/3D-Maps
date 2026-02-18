"""
Tests for Pydantic schema validation.
"""

import pytest
from pydantic import ValidationError

from app.schemas.schemas import (
    BuildingCreate,
    ConstructionPhaseInput,
    LocationInput,
    LoginRequest,
    ProjectCreate,
    UserCreate,
)


class TestUserCreate:
    def test_valid_user(self):
        user = UserCreate(email="a@b.com", password="12345678")
        assert user.email == "a@b.com"

    def test_short_password_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(email="a@b.com", password="short")

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(email="not-an-email", password="12345678")

    def test_full_name_optional(self):
        user = UserCreate(email="a@b.com", password="12345678")
        assert user.full_name is None

    def test_full_name_provided(self):
        user = UserCreate(email="a@b.com", password="12345678", full_name="Test")
        assert user.full_name == "Test"


class TestLoginRequest:
    def test_valid_login(self):
        login = LoginRequest(email="a@b.com", password="any")
        assert login.password == "any"


class TestProjectCreate:
    def test_minimal_project(self):
        p = ProjectCreate(name="My Project")
        assert p.name == "My Project"
        assert p.description is None
        assert p.location is None

    def test_project_with_location(self):
        p = ProjectCreate(
            name="Geo Project",
            location=LocationInput(latitude=51.5, longitude=-0.12),
        )
        assert p.location.latitude == 51.5

    def test_project_with_phases(self):
        p = ProjectCreate(
            name="Phased",
            construction_phases=[
                ConstructionPhaseInput(phase_number=1, name="Foundation"),
                ConstructionPhaseInput(phase_number=2, name="Structure"),
            ],
        )
        assert len(p.construction_phases) == 2

    def test_name_too_long_rejected(self):
        with pytest.raises(ValidationError):
            ProjectCreate(name="x" * 256)


class TestLocationInput:
    def test_valid_coords(self):
        loc = LocationInput(latitude=40.7, longitude=-74.0)
        assert loc.latitude == 40.7

    def test_latitude_out_of_range(self):
        with pytest.raises(ValidationError):
            LocationInput(latitude=91.0, longitude=0.0)

    def test_longitude_out_of_range(self):
        with pytest.raises(ValidationError):
            LocationInput(latitude=0.0, longitude=181.0)


class TestBuildingCreate:
    def test_minimal_building(self):
        b = BuildingCreate()
        assert b.name is None
        assert b.height_meters is None

    def test_building_with_details(self):
        b = BuildingCreate(
            name="Tower A",
            height_meters=50.0,
            floor_count=15,
            roof_type="flat",
        )
        assert b.floor_count == 15

    def test_negative_height_rejected(self):
        with pytest.raises(ValidationError):
            BuildingCreate(height_meters=-1.0)

    def test_zero_floor_count_rejected(self):
        with pytest.raises(ValidationError):
            BuildingCreate(floor_count=0)


class TestConstructionPhaseInput:
    def test_valid_phase(self):
        p = ConstructionPhaseInput(phase_number=1, name="Foundation", color="#ff0000")
        assert p.phase_number == 1
        assert p.color == "#ff0000"

    def test_phase_number_zero_rejected(self):
        with pytest.raises(ValidationError):
            ConstructionPhaseInput(phase_number=0, name="Bad")

    def test_name_too_long_rejected(self):
        with pytest.raises(ValidationError):
            ConstructionPhaseInput(phase_number=1, name="x" * 101)

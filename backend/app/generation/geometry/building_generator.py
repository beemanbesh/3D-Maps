"""
3D Building Geometry Generator.
Creates 3D meshes from normalized building data using trimesh.
"""

import logging
from typing import Any, Optional

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

logger = logging.getLogger(__name__)

# ---- PBR Material Library ----
MATERIALS = {
    "concrete": PBRMaterial(
        baseColorFactor=[0.78, 0.75, 0.71, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.85,
        name="concrete",
    ),
    "glass": PBRMaterial(
        baseColorFactor=[0.55, 0.75, 0.88, 0.55],
        metallicFactor=0.9,
        roughnessFactor=0.05,
        name="glass",
    ),
    "brick": PBRMaterial(
        baseColorFactor=[0.72, 0.45, 0.35, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.9,
        name="brick",
    ),
    "metal": PBRMaterial(
        baseColorFactor=[0.6, 0.6, 0.62, 1.0],
        metallicFactor=0.85,
        roughnessFactor=0.35,
        name="metal",
    ),
    "wood": PBRMaterial(
        baseColorFactor=[0.65, 0.50, 0.35, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.7,
        name="wood",
    ),
    "roof_tile": PBRMaterial(
        baseColorFactor=[0.55, 0.28, 0.16, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.75,
        name="roof_tile",
    ),
    "floor_slab": PBRMaterial(
        baseColorFactor=[0.55, 0.52, 0.48, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.9,
        name="floor_slab",
    ),
    "green_roof": PBRMaterial(
        baseColorFactor=[0.35, 0.55, 0.25, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.95,
        name="green_roof",
    ),
}


def _apply_material(mesh: trimesh.Trimesh, material_name: str) -> None:
    """Apply a PBR material to a trimesh mesh."""
    mat = MATERIALS.get(material_name, MATERIALS["concrete"])
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)


class BuildingGenerator:
    """Generates 3D building geometry from normalized data."""

    def generate_building(self, building_data: dict[str, Any]) -> trimesh.Scene:
        """
        Generate a complete building model from normalized data.

        Args:
            building_data: Dict with keys: footprint, height, floors, floor_height,
                          roof_type, materials, features

        Returns:
            trimesh.Scene containing the building geometry
        """
        scene = trimesh.Scene()

        footprint = np.array(building_data["footprint"])
        height = building_data.get("height", 10.0)
        floors = building_data.get("floors", 3)
        floor_height = building_data.get("floor_height", height / floors)
        roof_type = building_data.get("roof_type", "flat")

        # Determine facade material from building data
        materials_cfg = building_data.get("materials", {})
        facade_mat = materials_cfg.get("facade", "concrete")
        roof_mat = "roof_tile" if roof_type != "flat" else "concrete"

        # Generate main building volume
        body = self._extrude_footprint(footprint, height)
        if body:
            _apply_material(body, facade_mat)
            scene.add_geometry(body, geom_name="building_body")

        # Generate floor plates
        for i in range(1, floors):
            floor_plate = self._create_floor_plate(footprint, i * floor_height)
            if floor_plate:
                _apply_material(floor_plate, "floor_slab")
                scene.add_geometry(floor_plate, geom_name=f"floor_{i}")

        # Generate roof
        roof = self._generate_roof(footprint, height, roof_type)
        if roof:
            _apply_material(roof, roof_mat)
            scene.add_geometry(roof, geom_name="roof")

        # Generate windows (procedural placement)
        features = building_data.get("features", {})
        if features.get("windows"):
            windows = self._generate_windows(footprint, floors, floor_height, features["windows"])
            for i, window in enumerate(windows):
                _apply_material(window, "glass")
                scene.add_geometry(window, geom_name=f"window_{i}")

        # Generate front door
        door = self._generate_door(footprint, floor_height)
        if door:
            _apply_material(door, "wood")
            scene.add_geometry(door, geom_name="door")

        # Generate balconies on upper floors
        if features.get("balconies", False) and floors > 1:
            balconies = self._generate_balconies(footprint, floors, floor_height)
            for i, balcony in enumerate(balconies):
                _apply_material(balcony, "concrete")
                scene.add_geometry(balcony, geom_name=f"balcony_{i}")

        # Generate cornice at roofline
        cornice = self._generate_cornice(footprint, height)
        if cornice:
            _apply_material(cornice, "concrete")
            scene.add_geometry(cornice, geom_name="cornice")

        return scene

    def _extrude_footprint(self, footprint: np.ndarray, height: float) -> Optional[trimesh.Trimesh]:
        """Extrude a 2D footprint polygon to create a 3D volume."""
        try:
            # Ensure the footprint is a valid 2D polygon
            if len(footprint) < 3:
                logger.error("Footprint must have at least 3 points")
                return None

            # Close polygon if not closed
            if not np.array_equal(footprint[0], footprint[-1]):
                footprint = np.vstack([footprint, footprint[0]])

            # Create 2D path and extrude
            from shapely.geometry import Polygon
            poly = Polygon(footprint[:, :2])

            if not poly.is_valid:
                poly = poly.buffer(0)  # Fix self-intersections

            # Create extrusion using trimesh
            mesh = trimesh.creation.extrude_polygon(poly, height)
            return mesh

        except Exception as e:
            logger.error(f"Footprint extrusion failed: {e}")
            return None

    def _create_floor_plate(self, footprint: np.ndarray, elevation: float) -> Optional[trimesh.Trimesh]:
        """Create a thin floor plate at a given elevation."""
        try:
            from shapely.geometry import Polygon
            poly = Polygon(footprint[:, :2])
            if not poly.is_valid:
                poly = poly.buffer(0)

            plate = trimesh.creation.extrude_polygon(poly, 0.2)  # 20cm thick floor
            plate.apply_translation([0, 0, elevation])
            return plate

        except Exception as e:
            logger.error(f"Floor plate creation failed: {e}")
            return None

    def _generate_roof(
        self, footprint: np.ndarray, building_height: float, roof_type: str
    ) -> Optional[trimesh.Trimesh]:
        """Generate roof geometry based on type."""
        try:
            if roof_type == "flat":
                return None  # Top of extrusion serves as flat roof

            elif roof_type == "gabled":
                return self._gabled_roof(footprint, building_height)

            elif roof_type == "hipped":
                return self._hipped_roof(footprint, building_height)

            else:
                logger.warning(f"Unknown roof type: {roof_type}, using flat")
                return None

        except Exception as e:
            logger.error(f"Roof generation failed: {e}")
            return None

    def _gabled_roof(self, footprint: np.ndarray, base_height: float) -> Optional[trimesh.Trimesh]:
        """Create a simple gabled roof."""
        try:
            # Calculate bounding box
            min_pt = footprint[:, :2].min(axis=0)
            max_pt = footprint[:, :2].max(axis=0)
            center_x = (min_pt[0] + max_pt[0]) / 2
            width = max_pt[0] - min_pt[0]
            depth = max_pt[1] - min_pt[1]
            ridge_height = width * 0.3  # 30% of width

            # Create ridge vertices
            vertices = np.array([
                [min_pt[0], min_pt[1], base_height],
                [max_pt[0], min_pt[1], base_height],
                [max_pt[0], max_pt[1], base_height],
                [min_pt[0], max_pt[1], base_height],
                [center_x, min_pt[1], base_height + ridge_height],
                [center_x, max_pt[1], base_height + ridge_height],
            ])

            faces = np.array([
                [0, 1, 4],  # Front left slope
                [1, 2, 5],  # Right slope front
                [1, 5, 4],  # Right slope back
                [2, 3, 5],  # Back right slope
                [3, 0, 4],  # Left slope front
                [3, 4, 5],  # Left slope back
            ])

            return trimesh.Trimesh(vertices=vertices, faces=faces)

        except Exception as e:
            logger.error(f"Gabled roof failed: {e}")
            return None

    def _hipped_roof(self, footprint: np.ndarray, base_height: float) -> Optional[trimesh.Trimesh]:
        """Create a simple hipped (pyramid) roof."""
        try:
            min_pt = footprint[:, :2].min(axis=0)
            max_pt = footprint[:, :2].max(axis=0)
            center = (min_pt + max_pt) / 2
            width = max_pt[0] - min_pt[0]
            ridge_height = width * 0.25

            vertices = np.array([
                [min_pt[0], min_pt[1], base_height],
                [max_pt[0], min_pt[1], base_height],
                [max_pt[0], max_pt[1], base_height],
                [min_pt[0], max_pt[1], base_height],
                [center[0], center[1], base_height + ridge_height],
            ])

            faces = np.array([
                [0, 1, 4],
                [1, 2, 4],
                [2, 3, 4],
                [3, 0, 4],
            ])

            return trimesh.Trimesh(vertices=vertices, faces=faces)

        except Exception as e:
            logger.error(f"Hipped roof failed: {e}")
            return None

    def _generate_door(
        self, footprint: np.ndarray, floor_height: float
    ) -> Optional[trimesh.Trimesh]:
        """Generate a door on the longest ground-floor facade edge."""
        try:
            pts = footprint[:, :2]
            # Find the longest edge (front facade)
            best_idx = 0
            best_len = 0.0
            for i in range(len(pts) - 1):
                edge_len = np.linalg.norm(pts[i + 1] - pts[i])
                if edge_len > best_len:
                    best_len = edge_len
                    best_idx = i

            edge_start = pts[best_idx]
            edge_end = pts[best_idx + 1]
            edge_vec = edge_end - edge_start
            edge_dir = edge_vec / np.linalg.norm(edge_vec)
            normal = np.array([-edge_dir[1], edge_dir[0]])

            # Door dimensions
            door_width = 1.0
            door_height = 2.2
            door_depth = 0.12

            # Place door at center of the edge
            mid = (edge_start + edge_end) / 2

            door = trimesh.creation.box(extents=[door_width, door_depth, door_height])
            angle = np.arctan2(edge_dir[1], edge_dir[0])
            rot = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
            door.apply_transform(rot)
            door.apply_translation([
                mid[0] + normal[0] * 0.06,
                mid[1] + normal[1] * 0.06,
                door_height / 2,
            ])
            return door

        except Exception as e:
            logger.error(f"Door generation failed: {e}")
            return None

    def _generate_windows(
        self,
        footprint: np.ndarray,
        floors: int,
        floor_height: float,
        window_spec: Any,
    ) -> list[trimesh.Trimesh]:
        """Generate procedural window geometry on building facades."""
        windows = []
        try:
            # Get facade edges from footprint
            pts = footprint[:, :2]
            for i in range(len(pts) - 1):
                edge_start = pts[i]
                edge_end = pts[i + 1]
                edge_vec = edge_end - edge_start
                edge_len = np.linalg.norm(edge_vec)

                if edge_len < 2.0:
                    continue

                edge_dir = edge_vec / edge_len
                normal = np.array([-edge_dir[1], edge_dir[0]])

                # Window parameters
                win_width = 1.2
                win_height = 1.5
                win_depth = 0.1
                spacing = 3.0

                # Calculate number of windows along this edge
                n_windows = max(1, int((edge_len - 1.0) / spacing))

                for floor_idx in range(floors):
                    for win_idx in range(n_windows):
                        # Position along edge
                        t = (win_idx + 1) / (n_windows + 1)
                        pos_2d = edge_start + t * edge_vec

                        # Create window box
                        z_pos = (floor_idx * floor_height) + floor_height * 0.4

                        window = trimesh.creation.box(
                            extents=[win_width, win_depth, win_height]
                        )

                        # Transform to position
                        angle = np.arctan2(edge_dir[1], edge_dir[0])
                        rot = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
                        window.apply_transform(rot)
                        window.apply_translation([
                            pos_2d[0] + normal[0] * 0.05,
                            pos_2d[1] + normal[1] * 0.05,
                            z_pos,
                        ])

                        windows.append(window)

        except Exception as e:
            logger.error(f"Window generation failed: {e}")

        return windows

    def _generate_balconies(
        self,
        footprint: np.ndarray,
        floors: int,
        floor_height: float,
    ) -> list[trimesh.Trimesh]:
        """Generate balcony platforms on the longest facade edge for upper floors."""
        balconies = []
        try:
            pts = footprint[:, :2]
            # Find the longest edge (front facade)
            best_idx = 0
            best_len = 0.0
            for i in range(len(pts) - 1):
                edge_len = np.linalg.norm(pts[i + 1] - pts[i])
                if edge_len > best_len:
                    best_len = edge_len
                    best_idx = i

            edge_start = pts[best_idx]
            edge_end = pts[best_idx + 1]
            edge_vec = edge_end - edge_start
            edge_dir = edge_vec / np.linalg.norm(edge_vec)
            normal = np.array([-edge_dir[1], edge_dir[0]])

            balcony_width = min(2.5, best_len * 0.3)
            balcony_depth = 1.2
            balcony_thickness = 0.15

            # Place balconies on floors 2+ (skip ground floor)
            for floor_idx in range(1, floors):
                z_pos = floor_idx * floor_height
                mid = (edge_start + edge_end) / 2

                # Balcony slab
                slab = trimesh.creation.box(
                    extents=[balcony_width, balcony_depth, balcony_thickness]
                )
                angle = np.arctan2(edge_dir[1], edge_dir[0])
                rot = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
                slab.apply_transform(rot)
                slab.apply_translation([
                    mid[0] + normal[0] * (balcony_depth / 2),
                    mid[1] + normal[1] * (balcony_depth / 2),
                    z_pos,
                ])
                balconies.append(slab)

                # Railing (thin box at the outer edge)
                railing = trimesh.creation.box(
                    extents=[balcony_width, 0.05, 1.0]
                )
                railing.apply_transform(rot)
                railing.apply_translation([
                    mid[0] + normal[0] * balcony_depth,
                    mid[1] + normal[1] * balcony_depth,
                    z_pos + 0.5,
                ])
                balconies.append(railing)

        except Exception as e:
            logger.error(f"Balcony generation failed: {e}")

        return balconies

    def _generate_cornice(
        self, footprint: np.ndarray, building_height: float
    ) -> Optional[trimesh.Trimesh]:
        """Generate a cornice (decorative ledge) around the top perimeter of the building."""
        try:
            pts = footprint[:, :2]
            cornice_height = 0.3
            cornice_overhang = 0.15
            meshes = []

            for i in range(len(pts) - 1):
                edge_start = pts[i]
                edge_end = pts[i + 1]
                edge_vec = edge_end - edge_start
                edge_len = np.linalg.norm(edge_vec)
                if edge_len < 0.5:
                    continue

                edge_dir = edge_vec / edge_len
                normal = np.array([-edge_dir[1], edge_dir[0]])
                mid = (edge_start + edge_end) / 2

                # Cornice box along this edge
                cornice = trimesh.creation.box(
                    extents=[edge_len + cornice_overhang * 2, cornice_overhang * 2, cornice_height]
                )
                angle = np.arctan2(edge_dir[1], edge_dir[0])
                rot = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
                cornice.apply_transform(rot)
                cornice.apply_translation([
                    mid[0] + normal[0] * cornice_overhang,
                    mid[1] + normal[1] * cornice_overhang,
                    building_height + cornice_height / 2,
                ])
                meshes.append(cornice)

            if meshes:
                return trimesh.util.concatenate(meshes)
            return None

        except Exception as e:
            logger.error(f"Cornice generation failed: {e}")
            return None


class GLBExporter:
    """Export trimesh scenes to GLB format for web delivery."""

    @staticmethod
    def export_scene(scene: trimesh.Scene, output_path: str) -> str:
        """Export a trimesh scene to GLB file."""
        try:
            glb_data = scene.export(file_type="glb")
            with open(output_path, "wb") as f:
                f.write(glb_data)
            logger.info(f"GLB exported: {output_path} ({len(glb_data)} bytes)")
            return output_path
        except Exception as e:
            logger.error(f"GLB export failed: {e}")
            raise

    @staticmethod
    def export_to_bytes(scene: trimesh.Scene) -> bytes:
        """Export a trimesh scene to GLB bytes for upload."""
        return scene.export(file_type="glb")


class LODGenerator:
    """Generate Level of Detail variants of building meshes."""

    LOD_CONFIGS = {
        0: {"face_ratio": 1.0, "description": "Full detail"},
        1: {"face_ratio": 0.25, "description": "Simplified"},
        2: {"face_ratio": 0.05, "description": "Textured box"},
        3: {"face_ratio": 0.01, "description": "Simple box"},
    }

    @staticmethod
    def generate_lods(mesh: trimesh.Trimesh) -> dict[int, trimesh.Trimesh]:
        """Generate LOD variants of a mesh."""
        lods = {0: mesh.copy()}

        original_faces = len(mesh.faces)
        for level, config in LODGenerator.LOD_CONFIGS.items():
            if level == 0:
                continue

            target_faces = max(4, int(original_faces * config["face_ratio"]))
            try:
                simplified = mesh.simplify_quadric_decimation(target_faces)
                lods[level] = simplified
                logger.info(
                    f"LOD {level}: {len(simplified.faces)} faces "
                    f"(from {original_faces}, target {target_faces})"
                )
            except Exception as e:
                logger.warning(f"LOD {level} generation failed: {e}, using bounding box")
                lods[level] = mesh.bounding_box

        return lods

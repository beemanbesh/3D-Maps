import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SiteZone } from '@/types';

// =============================================================================
// Public API
// =============================================================================

interface SiteZonesGroupProps {
  zones: SiteZone[];
  projectLat?: number;
  projectLng?: number;
}

export function SiteZonesGroup({ zones, projectLat, projectLng }: SiteZonesGroupProps) {
  if (!projectLat || !projectLng || zones.length === 0) return null;

  const origin = { lat: projectLat, lon: projectLng };

  return (
    <group name="site-zones">
      {zones.map((zone) => (
        <SiteZoneMesh key={zone.id} zone={zone} origin={origin} />
      ))}
    </group>
  );
}

// =============================================================================
// Coordinate helpers
// =============================================================================

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLon(lat: number) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Convert lng/lat polygon to local meters (Three.js XZ plane). */
function toLocalPoints(
  coords: number[][],
  origin: { lat: number; lon: number },
): THREE.Vector2[] {
  const mLon = metersPerDegLon(origin.lat);
  const rawPts = coords.map((p) => {
    const x = (p[0] - origin.lon) * mLon;
    const z = (p[1] - origin.lat) * METERS_PER_DEG_LAT;
    // Shape y maps to 3D z = -y after rotateX(-PI/2), so y=z gives 3D z=-z (north=-Z)
    return new THREE.Vector2(x, z);
  });

  // De-duplicate nearly-identical points
  const pts: THREE.Vector2[] = [];
  for (const p of rawPts) {
    if (pts.length === 0 || p.distanceTo(pts[pts.length - 1]) > 0.01) {
      pts.push(p);
    }
  }
  return pts;
}

// =============================================================================
// Seeded PRNG (deterministic)
// =============================================================================

function makeRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// =============================================================================
// Geometry: point-in-polygon
// =============================================================================

function pointInPolygon(x: number, y: number, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// =============================================================================
// Polygon edge utilities
// =============================================================================

interface WallSegment {
  // All coordinates are in 3D world space (XZ ground plane)
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  length: number;
  dirX: number;      // unit direction along wall (3D X)
  dirZ: number;      // unit direction along wall (3D Z)
  normalX: number;   // outward-facing normal (3D X)
  normalZ: number;   // outward-facing normal (3D Z)
  midX: number;
  midZ: number;
  angle: number;     // Y rotation to face outward
}

/**
 * Compute wall segments in 3D world coordinates from 2D shape points.
 * ExtrudeGeometry + rotateX(-PI/2) maps shape (x, y) → world (x, _, -y).
 * We convert here so all downstream code (windows, doors, cornices) uses
 * correct 3D positions directly.
 */
function computeWallSegments(pts2D: THREE.Vector2[]): WallSegment[] {
  // Convert shape space to 3D ground plane: (x, y) → (x, -y)
  const pts = pts2D.map((p) => ({ x: p.x, z: -p.y }));

  // Compute centroid to determine outward normal direction
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= pts.length;
  cz /= pts.length;

  const walls: WallSegment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.5) continue;

    const dirX = dx / length;
    const dirZ = dz / length;

    // Candidate normal: perpendicular to wall direction in XZ plane
    let nx = -dirZ;
    let nz = dirX;

    // Ensure normal points OUTWARD (away from centroid)
    const midX = (p1.x + p2.x) / 2;
    const midZ = (p1.z + p2.z) / 2;
    const toCenterX = cx - midX;
    const toCenterZ = cz - midZ;
    if (nx * toCenterX + nz * toCenterZ > 0) {
      nx = -nx;
      nz = -nz;
    }

    const angle = Math.atan2(nx, nz);

    walls.push({
      startX: p1.x, startZ: p1.z,
      endX: p2.x, endZ: p2.z,
      length, dirX, dirZ, normalX: nx, normalZ: nz,
      midX, midZ, angle,
    });
  }
  return walls;
}

function getDefaultHeight(zoneType: string): number {
  switch (zoneType) {
    case 'building':
      return 30;
    case 'residential':
      return 12;
    default:
      return 0;
  }
}

// =============================================================================
// Zone router
// =============================================================================

function SiteZoneMesh({
  zone,
  origin,
}: {
  zone: SiteZone;
  origin: { lat: number; lon: number };
}) {
  const pts = useMemo(() => toLocalPoints(zone.coordinates, origin), [zone.coordinates, origin]);

  if (pts.length < 3) return null;

  switch (zone.zone_type) {
    case 'building':
    case 'residential':
      return <DetailedBuildingZone zone={zone} points2D={pts} />;
    case 'road':
      return <RoadZone zone={zone} points2D={pts} />;
    case 'green_space':
      return <GreenSpaceZone zone={zone} points2D={pts} />;
    case 'parking':
      return <ParkingZone zone={zone} points2D={pts} />;
    case 'water':
      return <WaterZone zone={zone} points2D={pts} />;
    default:
      return <FallbackZone zone={zone} points2D={pts} />;
  }
}

// =============================================================================
// 1. BUILDING / RESIDENTIAL ZONE — Detailed facades
// =============================================================================

function DetailedBuildingZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const height = zone.properties?.height ?? getDefaultHeight(zone.zone_type);
  const floors = zone.properties?.floors ?? Math.max(1, Math.round(height / 3));
  const floorHeight = zone.properties?.floor_height ?? height / floors;
  const isResidential = zone.zone_type === 'residential';
  const color = zone.color;

  const { mainGeometry, roofGeometry } = useMemo(() => {
    try {
      const shape = new THREE.Shape(points2D);
      const mainGeom = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: height,
        bevelEnabled: false,
      });
      mainGeom.rotateX(-Math.PI / 2);

      const roofGeom = new THREE.ShapeGeometry(shape);
      roofGeom.rotateX(-Math.PI / 2);
      roofGeom.translate(0, height, 0);

      return { mainGeometry: mainGeom, roofGeometry: roofGeom };
    } catch {
      return { mainGeometry: null, roofGeometry: null };
    }
  }, [points2D, height]);

  const walls = useMemo(() => computeWallSegments(points2D), [points2D]);

  const roofColor = useMemo(() => {
    const c = new THREE.Color(color);
    c.multiplyScalar(0.75);
    return '#' + c.getHexString();
  }, [color]);

  // Find longest wall for door + balconies
  const longestWallIdx = useMemo(() => {
    let maxLen = 0;
    let idx = 0;
    walls.forEach((w, i) => {
      if (w.length > maxLen) {
        maxLen = w.length;
        idx = i;
      }
    });
    return idx;
  }, [walls]);

  if (!mainGeometry) return null;

  return (
    <group>
      {/* Main extruded body */}
      <mesh geometry={mainGeometry} receiveShadow castShadow>
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.05} />
      </mesh>

      {/* Roof cap */}
      <mesh geometry={roofGeometry} receiveShadow>
        <meshStandardMaterial color={roofColor} roughness={0.6} metalness={0.05} />
      </mesh>

      {/* Windows on every wall segment */}
      <PolygonWindows walls={walls} height={height} floors={floors} floorHeight={floorHeight} />

      {/* Front door on longest wall */}
      {walls.length > 0 && (
        <PolygonDoor wall={walls[longestWallIdx]} />
      )}

      {/* Floor divider lines */}
      <PolygonFloorDividers walls={walls} height={height} floors={floors} floorHeight={floorHeight} color={color} />

      {/* Cornice at roofline */}
      <PolygonCornice walls={walls} height={height} />

      {/* Balconies for residential on longest wall, upper floors */}
      {isResidential && walls.length > 0 && (
        <PolygonBalconies
          wall={walls[longestWallIdx]}
          height={height}
          floors={floors}
          floorHeight={floorHeight}
        />
      )}
    </group>
  );
}

// =============================================================================
// Windows along polygon edges
// =============================================================================

function PolygonWindows({
  walls,
  height,
  floors,
  floorHeight,
}: {
  walls: WallSegment[];
  height: number;
  floors: number;
  floorHeight: number;
}) {
  const winWidth = 1.2;
  const winHeight = 1.4;
  const spacing = 3.5;
  const edgeMargin = 1.5;

  const windowData = useMemo(() => {
    const result: { pos: [number, number, number]; rotY: number }[] = [];

    for (const wall of walls) {
      const usableLength = wall.length - edgeMargin * 2;
      if (usableLength < 1.5) continue;

      const numWins = Math.max(1, Math.floor(usableLength / spacing));
      const actualSpacing = usableLength / numWins;

      for (let floor = 0; floor < floors; floor++) {
        const y = floor * floorHeight + floorHeight * 0.45;

        for (let w = 0; w < numWins; w++) {
          const t = edgeMargin + (w + 0.5) * actualSpacing;
          const wx = wall.startX + wall.dirX * t + wall.normalX * 0.02;
          const wz = wall.startZ + wall.dirZ * t + wall.normalZ * 0.02;

          result.push({
            pos: [wx, y, wz],
            rotY: wall.angle,
          });
        }
      }
    }
    return result;
  }, [walls, height, floors, floorHeight]);

  return (
    <>
      {windowData.map((win, i) => (
        <mesh key={i} position={win.pos} rotation={[0, win.rotY, 0]}>
          <planeGeometry args={[winWidth, winHeight]} />
          <meshStandardMaterial
            color="#87ceeb"
            roughness={0.1}
            metalness={0.8}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
}

// =============================================================================
// Front door on a wall segment
// =============================================================================

function PolygonDoor({ wall }: { wall: WallSegment }) {
  const doorWidth = 1.2;
  const doorHeight = 2.2;
  const frameWidth = 1.35;
  const frameHeight = 2.35;

  // Place door at the center of the wall, at ground level
  const x = wall.midX + wall.normalX * 0.02;
  const z = wall.midZ + wall.normalZ * 0.02;
  const y = doorHeight / 2;

  return (
    <group>
      {/* Door frame (behind door) */}
      <mesh position={[x, y, z]} rotation={[0, wall.angle, 0]}>
        <planeGeometry args={[frameWidth, frameHeight]} />
        <meshStandardMaterial color="#3d2815" roughness={0.8} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* Door panel */}
      <mesh
        position={[x + wall.normalX * 0.005, y, z + wall.normalZ * 0.005]}
        rotation={[0, wall.angle, 0]}
      >
        <planeGeometry args={[doorWidth, doorHeight]} />
        <meshStandardMaterial color="#5c3a1e" roughness={0.7} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Floor divider lines along every wall
// =============================================================================

function PolygonFloorDividers({
  walls,
  height,
  floors,
  floorHeight,
  color,
}: {
  walls: WallSegment[];
  height: number;
  floors: number;
  floorHeight: number;
  color: string;
}) {
  const dividerColor = useMemo(() => {
    const c = new THREE.Color(color);
    c.multiplyScalar(0.65);
    return '#' + c.getHexString();
  }, [color]);

  const dividers = useMemo(() => {
    const result: { pos: [number, number, number]; rotY: number; width: number }[] = [];
    for (let f = 1; f < floors; f++) {
      const y = f * floorHeight;
      for (const wall of walls) {
        result.push({
          pos: [wall.midX + wall.normalX * 0.03, y, wall.midZ + wall.normalZ * 0.03],
          rotY: wall.angle,
          width: wall.length + 0.1,
        });
      }
    }
    return result;
  }, [walls, floors, floorHeight]);

  return (
    <>
      {dividers.map((d, i) => (
        <mesh key={i} position={d.pos} rotation={[0, d.rotY, 0]}>
          <planeGeometry args={[d.width, 0.08]} />
          <meshStandardMaterial color={dividerColor} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

// =============================================================================
// Cornice ledge around roofline perimeter
// =============================================================================

function PolygonCornice({
  walls,
  height,
}: {
  walls: WallSegment[];
  height: number;
}) {
  return (
    <>
      {walls.map((wall, i) => (
        <mesh
          key={i}
          position={[
            wall.midX + wall.normalX * 0.15,
            height + 0.15,
            wall.midZ + wall.normalZ * 0.15,
          ]}
          rotation={[0, wall.angle, 0]}
        >
          <boxGeometry args={[wall.length + 0.3, 0.3, 0.3]} />
          <meshStandardMaterial color="#c0b8ac" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

// =============================================================================
// Balconies on a wall (residential, upper floors)
// =============================================================================

function PolygonBalconies({
  wall,
  height,
  floors,
  floorHeight,
}: {
  wall: WallSegment;
  height: number;
  floors: number;
  floorHeight: number;
}) {
  const balconyWidth = Math.min(2.5, wall.length * 0.3);
  const balconyDepth = 1.2;

  const balconies = useMemo(() => {
    const result: { pos: [number, number, number]; rotY: number }[] = [];
    for (let f = 1; f < floors; f++) {
      const y = f * floorHeight;
      result.push({
        pos: [
          wall.midX + wall.normalX * (balconyDepth / 2 + 0.01),
          y,
          wall.midZ + wall.normalZ * (balconyDepth / 2 + 0.01),
        ],
        rotY: wall.angle,
      });
    }
    return result;
  }, [wall, floors, floorHeight, balconyDepth]);

  return (
    <>
      {balconies.map((b, i) => (
        <group key={i} position={b.pos} rotation={[0, b.rotY, 0]}>
          {/* Slab */}
          <mesh castShadow>
            <boxGeometry args={[balconyWidth, 0.15, balconyDepth]} />
            <meshStandardMaterial color="#b0a898" roughness={0.85} />
          </mesh>
          {/* Railing */}
          <mesh position={[0, 0.5, balconyDepth / 2]}>
            <boxGeometry args={[balconyWidth, 1.0, 0.05]} />
            <meshStandardMaterial color="#888888" roughness={0.6} metalness={0.3} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// =============================================================================
// 2. ROAD ZONE — Ribbon mesh + center line + sidewalks
// =============================================================================

function RoadZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const roadWidth = zone.properties?.width ?? 10;

  const { roadGeometry, centerLineGeometry, leftSidewalk, rightSidewalk } = useMemo(() => {
    const n = points2D.length;
    if (n < 4) return { roadGeometry: null, centerLineGeometry: null, leftSidewalk: null, rightSidewalk: null };

    // Reconstruct centerline from the buffered polygon:
    // polygon = [left0, left1, ..., leftM, rightM, ..., right0]
    // centerline[i] = midpoint(vertices[i], vertices[n-1-i])
    // Shape (x, y) → 3D (x, -y), so negate the y midpoint for world z
    const half = Math.floor(n / 2);
    const centerPoints: { x: number; z: number }[] = [];
    for (let i = 0; i < half; i++) {
      const a = points2D[i];
      const b = points2D[n - 1 - i];
      centerPoints.push({
        x: (a.x + b.x) / 2,
        z: -((a.y + b.y) / 2),
      });
    }

    if (centerPoints.length < 2) return { roadGeometry: null, centerLineGeometry: null, leftSidewalk: null, rightSidewalk: null };

    const halfWidth = roadWidth / 2;
    const sidewalkWidth = 2.0;

    // Build ribbon geometry from centerline
    function buildRibbon(
      points: { x: number; z: number }[],
      hw: number,
      yPos: number,
    ): THREE.BufferGeometry | null {
      if (points.length < 2) return null;

      const vertices: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < points.length; i++) {
        let dx = 0, dz = 0;
        if (i < points.length - 1) {
          dx += points[i + 1].x - points[i].x;
          dz += points[i + 1].z - points[i].z;
        }
        if (i > 0) {
          dx += points[i].x - points[i - 1].x;
          dz += points[i].z - points[i - 1].z;
        }
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;

        vertices.push(
          points[i].x + nx * hw, yPos, points[i].z + nz * hw,
          points[i].x - nx * hw, yPos, points[i].z - nz * hw,
        );

        if (i < points.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    }

    // Build offset ribbon for sidewalks (innerDist and outerDist from centerline,
    // measured along the perpendicular normal — positive = left, negative = right)
    function buildOffsetRibbon(
      points: { x: number; z: number }[],
      innerDist: number,
      outerDist: number,
      yPos: number,
    ): THREE.BufferGeometry | null {
      if (points.length < 2) return null;

      const vertices: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < points.length; i++) {
        let dx = 0, dz = 0;
        if (i < points.length - 1) {
          dx += points[i + 1].x - points[i].x;
          dz += points[i + 1].z - points[i].z;
        }
        if (i > 0) {
          dx += points[i].x - points[i - 1].x;
          dz += points[i].z - points[i - 1].z;
        }
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;

        vertices.push(
          points[i].x + nx * innerDist, yPos, points[i].z + nz * innerDist,
          points[i].x + nx * outerDist, yPos, points[i].z + nz * outerDist,
        );

        if (i < points.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    }

    const roadGeom = buildRibbon(centerPoints, halfWidth, 0.05);

    // Center line points
    const linePoints = centerPoints.map((p) => new THREE.Vector3(p.x, 0.08, p.z));
    const centerLineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);

    // Sidewalks: left side (positive normal direction), right side (negative)
    const gap = 0.3; // gap between road edge and sidewalk (curb)
    const leftInner = halfWidth + gap;
    const leftOuter = halfWidth + gap + sidewalkWidth;
    const rightInner = -(halfWidth + gap);
    const rightOuter = -(halfWidth + gap + sidewalkWidth);

    const leftSW = buildOffsetRibbon(centerPoints, leftInner, leftOuter, 0.1);
    const rightSW = buildOffsetRibbon(centerPoints, rightInner, rightOuter, 0.1);

    return {
      roadGeometry: roadGeom,
      centerLineGeometry: centerLineGeom,
      leftSidewalk: leftSW,
      rightSidewalk: rightSW,
    };
  }, [points2D, roadWidth]);

  if (!roadGeometry) return null;

  return (
    <group>
      {/* Road surface */}
      <mesh geometry={roadGeometry} receiveShadow>
        <meshStandardMaterial color="#3a3a3a" roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Center line stripe */}
      {centerLineGeometry && (
        <line geometry={centerLineGeometry}>
          <lineBasicMaterial color="#e0e0e0" transparent opacity={0.7} />
        </line>
      )}

      {/* Left sidewalk */}
      {leftSidewalk && (
        <mesh geometry={leftSidewalk} receiveShadow>
          <meshStandardMaterial color="#a0a0a0" roughness={0.85} metalness={0.0} />
        </mesh>
      )}

      {/* Right sidewalk */}
      {rightSidewalk && (
        <mesh geometry={rightSidewalk} receiveShadow>
          <meshStandardMaterial color="#a0a0a0" roughness={0.85} metalness={0.0} />
        </mesh>
      )}

      {/* Curb lines — thin raised strips between road and sidewalks */}
      <RoadCurbs points2D={points2D} roadWidth={roadWidth} />
    </group>
  );
}

/** Thin curb strips along road edges */
function RoadCurbs({
  points2D,
  roadWidth,
}: {
  points2D: THREE.Vector2[];
  roadWidth: number;
}) {
  const curbGeometries = useMemo(() => {
    const n = points2D.length;
    if (n < 4) return { left: null, right: null };

    const half = Math.floor(n / 2);
    const centerPoints: { x: number; z: number }[] = [];
    for (let i = 0; i < half; i++) {
      const a = points2D[i];
      const b = points2D[n - 1 - i];
      centerPoints.push({ x: (a.x + b.x) / 2, z: -((a.y + b.y) / 2) });
    }

    if (centerPoints.length < 2) return { left: null, right: null };

    const halfWidth = roadWidth / 2;
    const curbHalfW = 0.1;

    function buildCurbLine(sign: number): THREE.BufferGeometry | null {
      const verts: number[] = [];
      const idx: number[] = [];

      for (let i = 0; i < centerPoints.length; i++) {
        let dx = 0, dz = 0;
        if (i < centerPoints.length - 1) { dx += centerPoints[i + 1].x - centerPoints[i].x; dz += centerPoints[i + 1].z - centerPoints[i].z; }
        if (i > 0) { dx += centerPoints[i].x - centerPoints[i - 1].x; dz += centerPoints[i].z - centerPoints[i - 1].z; }
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;

        const cx = centerPoints[i].x + nx * sign * (halfWidth + 0.15);
        const cz = centerPoints[i].z + nz * sign * (halfWidth + 0.15);

        verts.push(
          cx + nx * curbHalfW, 0.15, cz + nz * curbHalfW,
          cx - nx * curbHalfW, 0.15, cz - nz * curbHalfW,
        );

        if (i < centerPoints.length - 1) {
          const base = i * 2;
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geom.setIndex(idx);
      geom.computeVertexNormals();
      return geom;
    }

    return { left: buildCurbLine(1), right: buildCurbLine(-1) };
  }, [points2D, roadWidth]);

  return (
    <>
      {curbGeometries.left && (
        <mesh geometry={curbGeometries.left}>
          <meshStandardMaterial color="#888888" roughness={0.8} />
        </mesh>
      )}
      {curbGeometries.right && (
        <mesh geometry={curbGeometries.right}>
          <meshStandardMaterial color="#888888" roughness={0.8} />
        </mesh>
      )}
    </>
  );
}

// =============================================================================
// 3. GREEN SPACE ZONE — Mixed trees + benches + light poles
// =============================================================================

function GreenSpaceZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const density = zone.properties?.tree_density ?? 0.3;

  const groundGeometry = useMemo(() => {
    try {
      const shape = new THREE.Shape(points2D);
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      return geom;
    } catch {
      return null;
    }
  }, [points2D]);

  if (!groundGeometry) return null;

  return (
    <group position={[0, 0.04, 0]}>
      {/* Green ground surface */}
      <mesh geometry={groundGeometry} receiveShadow>
        <meshStandardMaterial color="#4a8c3f" roughness={0.95} metalness={0.0} />
      </mesh>

      {/* Mixed trees */}
      <GreenSpaceTrees points2D={points2D} density={density} />

      {/* Park benches */}
      <ParkBenches points2D={points2D} density={density} />

      {/* Light poles along perimeter */}
      <PerimeterLightPoles points2D={points2D} />
    </group>
  );
}

function GreenSpaceTrees({
  points2D,
  density,
}: {
  points2D: THREE.Vector2[];
  density: number;
}) {
  const trees = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points2D) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;
    const count = Math.floor(area * density * 0.01);

    const rand = makeRand(points2D.length * 1000 + Math.abs(Math.round(minX * 100)));

    const result: {
      pos: [number, number, number];
      scale: number;
      type: 'conifer' | 'deciduous';
    }[] = [];

    for (let i = 0; i < Math.min(count, 200); i++) {
      const px = minX + rand() * width;
      const py = minY + rand() * height;

      if (pointInPolygon(px, py, points2D)) {
        // Shape (x, y) → 3D (x, 0, -y) to match rotated ShapeGeometry
        result.push({
          pos: [px, 0, -py],
          scale: 0.7 + rand() * 0.6,
          type: rand() > 0.4 ? 'deciduous' : 'conifer',
        });
      }
    }

    return result;
  }, [points2D, density]);

  return (
    <>
      {trees.map((t, i) => (
        <group key={i} position={t.pos} scale={t.scale}>
          {/* Trunk */}
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.2, 3, 6]} />
            <meshStandardMaterial color="#6b4423" roughness={0.9} />
          </mesh>
          {/* Canopy */}
          {t.type === 'conifer' ? (
            <mesh position={[0, 4, 0]} castShadow>
              <coneGeometry args={[1.5, 4, 6]} />
              <meshStandardMaterial color="#2d5a27" roughness={0.8} />
            </mesh>
          ) : (
            <mesh position={[0, 4.5, 0]} castShadow>
              <sphereGeometry args={[2, 8, 6]} />
              <meshStandardMaterial color="#3a7d32" roughness={0.8} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

function ParkBenches({
  points2D,
  density,
}: {
  points2D: THREE.Vector2[];
  density: number;
}) {
  const benches = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points2D) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;
    const count = Math.max(1, Math.floor(area * density * 0.002));

    const rand = makeRand(points2D.length * 2000 + Math.abs(Math.round(minX * 50)));

    const result: { pos: [number, number, number]; rot: number }[] = [];

    for (let i = 0; i < Math.min(count, 30); i++) {
      const px = minX + rand() * width;
      const py = minY + rand() * height;

      if (pointInPolygon(px, py, points2D)) {
        // Shape (x, y) → 3D (x, 0, -y) to match rotated ShapeGeometry
        result.push({
          pos: [px, 0, -py],
          rot: rand() * Math.PI * 2,
        });
      }
    }

    return result;
  }, [points2D, density]);

  return (
    <>
      {benches.map((b, i) => (
        <Bench key={i} position={b.pos} rotation={b.rot} />
      ))}
    </>
  );
}

function PerimeterLightPoles({ points2D }: { points2D: THREE.Vector2[] }) {
  const poles = useMemo(() => {
    const walls = computeWallSegments(points2D);
    const result: [number, number, number][] = [];
    const minSpacing = 15; // minimum 15m between poles

    for (const wall of walls) {
      const numPoles = Math.max(1, Math.floor(wall.length / minSpacing));
      for (let i = 0; i < numPoles; i++) {
        const t = (i + 0.5) / numPoles;
        const x = wall.startX + wall.dirX * wall.length * t;
        const z = wall.startZ + wall.dirZ * wall.length * t;
        result.push([x, 0, z]);
      }
    }

    return result;
  }, [points2D]);

  return (
    <>
      {poles.map((pos, i) => (
        <LightPole key={i} position={pos} />
      ))}
    </>
  );
}

// =============================================================================
// 4. PARKING ZONE — Asphalt + markings + bollards
// =============================================================================

function ParkingZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const { groundGeometry, markings, bollardPositions } = useMemo(() => {
    let groundGeom: THREE.BufferGeometry | null = null;
    try {
      const shape = new THREE.Shape(points2D);
      groundGeom = new THREE.ShapeGeometry(shape);
      groundGeom.rotateX(-Math.PI / 2);
    } catch {
      // degenerate polygon
    }

    // Find longest edge to orient parking lines
    const walls = computeWallSegments(points2D);
    let longestWall = walls[0];
    for (const w of walls) {
      if (w.length > (longestWall?.length ?? 0)) longestWall = w;
    }

    const markingData: { pos: [number, number, number]; rotY: number; width: number; depth: number }[] = [];
    const bollards: [number, number, number][] = [];

    if (longestWall) {
      // Compute bounding box in 3D world coordinates
      // Shape (x, y) → 3D (x, -y) so negate the y component
      const pts3D = points2D.map((p) => ({ x: p.x, z: -p.y }));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of pts3D) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }

      const spaceWidth = 2.7;
      const spaceDepth = 5.5;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const parkWidth = maxX - minX;
      const parkDepth = maxZ - minZ;

      // Compute direction along longest wall for orientation
      const angle = Math.atan2(longestWall.dirZ, longestWall.dirX);

      // Place parking lines in a grid aligned to the longest edge
      const numSpaces = Math.floor(Math.max(parkWidth, parkDepth) / spaceWidth);
      const numRows = Math.max(1, Math.floor(Math.min(parkWidth, parkDepth) / (spaceDepth + 1)));

      for (let row = 0; row < numRows; row++) {
        for (let s = 0; s <= numSpaces; s++) {
          const localX = -numSpaces * spaceWidth / 2 + s * spaceWidth;
          const localZ = -numRows * (spaceDepth + 1) / 2 + row * (spaceDepth + 1);

          // Transform to world space using wall orientation
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const wx = centerX + localX * cosA - localZ * sinA;
          const wz = centerZ + localX * sinA + localZ * cosA;

          // Convert 3D back to shape space for point-in-polygon test: (x, -z)
          if (pointInPolygon(wx, -wz, points2D)) {
            markingData.push({
              pos: [wx, 0.04, wz],
              rotY: angle,
              width: 0.1,
              depth: spaceDepth,
            });
          }
        }
      }

      // Front lines for rows
      for (let row = 0; row < numRows; row++) {
        const localZ = -numRows * (spaceDepth + 1) / 2 + row * (spaceDepth + 1) - spaceDepth / 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const wx = centerX - localZ * sinA;
        const wz = centerZ + localZ * cosA;

        markingData.push({
          pos: [wx, 0.04, wz],
          rotY: angle,
          width: numSpaces * spaceWidth,
          depth: 0.1,
        });
      }
    }

    // Bollards along perimeter
    for (const wall of walls) {
      const numBollards = Math.max(1, Math.floor(wall.length / 5));
      for (let i = 0; i < numBollards; i++) {
        const t = (i + 0.5) / numBollards;
        const x = wall.startX + wall.dirX * wall.length * t;
        const z = wall.startZ + wall.dirZ * wall.length * t;
        bollards.push([x, 0, z]);
      }
    }

    return { groundGeometry: groundGeom, markings: markingData, bollardPositions: bollards };
  }, [points2D]);

  if (!groundGeometry) return null;

  return (
    <group position={[0, 0.03, 0]}>
      {/* Asphalt surface */}
      <mesh geometry={groundGeometry} receiveShadow>
        <meshStandardMaterial color="#3a3a3a" roughness={0.95} metalness={0.0} />
      </mesh>

      {/* Parking space markings */}
      {markings.map((m, i) => (
        <mesh key={`mark-${i}`} position={m.pos} rotation={[-Math.PI / 2, 0, m.rotY]}>
          <planeGeometry args={[m.width, m.depth]} />
          <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Perimeter bollards */}
      {bollardPositions.map((pos, i) => (
        <Bollard key={`bollard-${i}`} position={pos} />
      ))}
    </group>
  );
}

// =============================================================================
// 5. WATER ZONE — Reflective surface with gentle waves
// =============================================================================

function WaterZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    try {
      const shape = new THREE.Shape(points2D);
      const geom = new THREE.ShapeGeometry(shape, 8);
      geom.rotateX(-Math.PI / 2);
      return geom;
    } catch {
      return null;
    }
  }, [points2D]);

  // Gentle wave animation
  useFrame(({ clock }) => {
    if (!meshRef.current || !geometry) return;
    const posAttr = meshRef.current.geometry.getAttribute('position');
    if (!posAttr) return;

    const time = clock.getElapsedTime();
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const wave = Math.sin(x * 0.5 + time * 1.2) * 0.08 + Math.cos(z * 0.3 + time * 0.8) * 0.05;
      posAttr.setY(i, 0.01 + wave);
    }
    posAttr.needsUpdate = true;
  });

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} position={[0, 0.01, 0]} receiveShadow>
      <meshPhysicalMaterial
        color="#1a6b8a"
        roughness={0.05}
        metalness={0.1}
        transmission={0.4}
        ior={1.33}
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// =============================================================================
// 6. FALLBACK ZONE — Generic flat surface
// =============================================================================

function FallbackZone({
  zone,
  points2D,
}: {
  zone: SiteZone;
  points2D: THREE.Vector2[];
}) {
  const geometry = useMemo(() => {
    try {
      const shape = new THREE.Shape(points2D);
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      return geom;
    } catch {
      return null;
    }
  }, [points2D]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0.02, 0]} receiveShadow>
      <meshStandardMaterial
        color={zone.color}
        roughness={0.7}
        metalness={0.05}
        transparent
        opacity={0.75}
      />
    </mesh>
  );
}

// =============================================================================
// Shared street furniture components
// =============================================================================

function Bench({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[1.2, 0.06, 0.4]} />
        <meshStandardMaterial color="#8B6914" roughness={0.7} />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, 0.7, -0.18]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 0.35, 0.04]} />
        <meshStandardMaterial color="#8B6914" roughness={0.7} />
      </mesh>
      {/* Legs */}
      {[-0.45, 0.45].map((lx) => (
        <mesh key={lx} position={[lx, 0.22, 0]} castShadow>
          <boxGeometry args={[0.05, 0.44, 0.4]} />
          <meshStandardMaterial color="#4a4a4a" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function LightPole({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Pole */}
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 5, 6]} />
        <meshStandardMaterial color="#6a6a6a" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Lamp fixture */}
      <mesh position={[0, 5.1, 0]}>
        <sphereGeometry args={[0.2, 8, 6]} />
        <meshStandardMaterial
          color="#fff8e0"
          emissive="#fff8e0"
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Arm */}
      <mesh position={[0.15, 4.8, 0]} rotation={[0, 0, -0.4]}>
        <cylinderGeometry args={[0.02, 0.02, 0.6, 4]} />
        <meshStandardMaterial color="#6a6a6a" roughness={0.3} metalness={0.8} />
      </mesh>
    </group>
  );
}

function Bollard({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={[position[0], 0.35, position[2]]} castShadow>
      <cylinderGeometry args={[0.08, 0.08, 0.7, 8]} />
      <meshStandardMaterial color="#555555" roughness={0.4} metalness={0.7} />
    </mesh>
  );
}

import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Environment,
  Sky,
  PerspectiveCamera,
  Html,
  useGLTF,
} from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useViewerStore, type Measurement, type CameraKeyframe } from '@/store';
import type { Building, Document, SiteZone } from '@/types';
import { SiteZonesGroup } from './SiteZonesGroup';
import type { ThreeEvent } from '@react-three/fiber';

/**
 * Calculate sun position based on time of day and date.
 * Uses simplified astronomical model with declination angle.
 * Returns [x, y, z] scaled to 100 units from origin.
 */
function calculateSunPosition(hour: number, date: Date, latitude = 40): [number, number, number] {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  // Solar declination (degrees) — varies ±23.45° over the year
  const declination = 23.45 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);

  // Hour angle: 0 at noon, negative morning, positive afternoon
  const hourAngle = (hour - 12) * 15; // degrees

  const latRad = (latitude * Math.PI) / 180;
  const decRad = (declination * Math.PI) / 180;
  const haRad = (hourAngle * Math.PI) / 180;

  // Solar elevation angle
  const sinElev = Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElev)));

  // Solar azimuth angle
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinElev) /
    (Math.cos(latRad) * Math.cos(elevation) + 0.0001);
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (hour > 12) azimuth = 2 * Math.PI - azimuth;

  // Convert to Cartesian (Y = up)
  const r = 100;
  const x = r * Math.cos(elevation) * Math.sin(azimuth);
  const y = r * Math.sin(elevation);
  const z = r * Math.cos(elevation) * Math.cos(azimuth);

  return [x, Math.max(5, y), z]; // Keep sun above horizon minimum
}

function SunLight({ settings, showMapBackground, latitude }: { settings: import('@/types').ViewerSettings; showMapBackground?: boolean; latitude?: number }) {
  const sunPos = useMemo(
    () => calculateSunPosition(settings.sunTime, settings.sunDate, latitude ?? 40),
    [settings.sunTime, settings.sunDate, latitude]
  );

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={sunPos}
        intensity={1.2}
        castShadow={settings.showShadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      {!showMapBackground && <Sky sunPosition={sunPos} />}
      <Environment preset="city" background={!showMapBackground} />
    </>
  );
}

/**
 * Reactively manages scene background transparency so the Mapbox map
 * behind the Canvas is visible when a map layer is active.
 */
function SceneBackgroundManager({ transparent }: { transparent: boolean }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (transparent) {
      gl.setClearColor(0x000000, 0);
      scene.background = null;
    } else {
      gl.setClearColor(0x000000, 1);
      // Let Environment/Sky set background when not transparent
    }
  }, [transparent, gl, scene]);
  return null;
}

/**
 * Shadow study overlay — renders a ground-plane heatmap showing cumulative
 * shadow coverage across multiple sun positions throughout the day.
 * Uses raycasting against building bounding boxes to approximate shadows.
 */
function ShadowStudyOverlay({
  buildings,
  positions,
  sunDate,
  latitude,
}: {
  buildings: Building[];
  positions: [number, number, number][];
  sunDate: Date;
  latitude?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);

  // Grid resolution for the shadow study
  const GRID_SIZE = 64;
  const AREA_SIZE = 200; // meters (covers -100 to 100)

  useEffect(() => {
    if (buildings.length === 0) return;

    // Build simplified building boxes for raycasting
    const boxes: { min: THREE.Vector3; max: THREE.Vector3 }[] = [];
    buildings.forEach((b, i) => {
      const pos = positions[i] || [0, 0, 0];
      const w = 20;
      const d = 15;
      const h = b.height_meters || 10;
      boxes.push({
        min: new THREE.Vector3(pos[0] - w / 2, 0, pos[2] - d / 2),
        max: new THREE.Vector3(pos[0] + w / 2, h, pos[2] + d / 2),
      });
    });

    // Sample sun positions across the day (7am to 7pm, every hour)
    const sunPositions: THREE.Vector3[] = [];
    for (let hour = 7; hour <= 19; hour++) {
      const sp = calculateSunPosition(hour, sunDate, latitude ?? 40);
      if (sp[1] > 1) { // Only count when sun is above horizon
        sunPositions.push(new THREE.Vector3(sp[0], sp[1], sp[2]).normalize());
      }
    }

    if (sunPositions.length === 0) return;

    // Compute shadow map
    const data = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
    const halfArea = AREA_SIZE / 2;
    const cellSize = AREA_SIZE / GRID_SIZE;

    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const worldX = -halfArea + (gx + 0.5) * cellSize;
        const worldZ = -halfArea + (gy + 0.5) * cellSize;
        const groundPoint = new THREE.Vector3(worldX, 0.1, worldZ);

        // Count how many sun positions cast a shadow on this point
        let shadowCount = 0;
        for (const sunDir of sunPositions) {
          // Cast ray from ground point toward the sun
          const rayOrigin = groundPoint.clone();
          const rayDir = sunDir.clone();

          // Check if any building box blocks this ray
          for (const box of boxes) {
            if (rayIntersectsBox(rayOrigin, rayDir, box.min, box.max)) {
              shadowCount++;
              break;
            }
          }
        }

        const shadowRatio = shadowCount / sunPositions.length;
        const idx = (gy * GRID_SIZE + gx) * 4;

        // Heatmap: blue (no shadow) -> yellow -> red (full shadow)
        if (shadowRatio < 0.33) {
          const t = shadowRatio / 0.33;
          data[idx] = Math.round(t * 255);        // R
          data[idx + 1] = Math.round(t * 200);    // G
          data[idx + 2] = Math.round((1 - t) * 100); // B
        } else if (shadowRatio < 0.66) {
          const t = (shadowRatio - 0.33) / 0.33;
          data[idx] = 255;                          // R
          data[idx + 1] = Math.round(200 * (1 - t)); // G
          data[idx + 2] = 0;                         // B
        } else {
          const t = (shadowRatio - 0.66) / 0.34;
          data[idx] = Math.round(255 * (1 - t * 0.3)); // R
          data[idx + 1] = 0;                            // G
          data[idx + 2] = Math.round(t * 60);           // B
        }
        data[idx + 3] = shadowRatio > 0.01 ? Math.round(80 + shadowRatio * 120) : 0; // Alpha
      }
    }

    const texture = new THREE.DataTexture(data, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    textureRef.current = texture;

    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      mat.map = texture;
      mat.needsUpdate = true;
    }

    return () => {
      texture.dispose();
    };
  }, [buildings, positions, sunDate, latitude, GRID_SIZE]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <planeGeometry args={[AREA_SIZE, AREA_SIZE]} />
      <meshBasicMaterial transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

/** Simple ray vs AABB intersection test */
function rayIntersectsBox(origin: THREE.Vector3, dir: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): boolean {
  let tmin = -Infinity;
  let tmax = Infinity;

  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? origin.x : i === 1 ? origin.y : origin.z;
    const d = i === 0 ? dir.x : i === 1 ? dir.y : dir.z;
    const bmin = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const bmax = i === 0 ? max.x : i === 1 ? max.y : max.z;

    if (Math.abs(d) < 1e-8) {
      if (o < bmin || o > bmax) return false;
    } else {
      let t1 = (bmin - o) / d;
      let t2 = (bmax - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return tmax > 0;
}

// LOD distance thresholds (units = scene meters)
const LOD_THRESHOLDS = [
  { level: 0, maxDistance: 80 },   // Full detail when close
  { level: 1, maxDistance: 200 },  // Simplified at medium range
  { level: 2, maxDistance: 400 },  // Textured box at far range
  { level: 3, maxDistance: Infinity }, // Simple box beyond
];

export interface ContextBuildingData {
  osm_id: number;
  height: number;
  building_type?: string;
  footprint: number[][]; // [[lon, lat], ...]
}

export interface ContextRoadData {
  osm_id: number;
  name?: string;
  highway_type: string;
  width: number;
  coords: number[][]; // [[lon, lat], ...]
}

export interface AnnotationData {
  id: string;
  text: string;
  position_x: number;
  position_y: number;
  position_z: number;
  resolved: boolean;
  author_id: string;
  created_at: string;
}

interface SceneViewerProps {
  buildings: Building[];
  documents?: Document[];
  contextBuildings?: ContextBuildingData[];
  contextRoads?: ContextRoadData[];
  onBuildingClick?: (id: string) => void;
  onBuildingHover?: (id: string | null) => void;
  showMapBackground?: boolean;
  latitude?: number;
  longitude?: number;
  annotations?: AnnotationData[];
  onAnnotationClick?: (position: [number, number, number]) => void;
  onResolveAnnotation?: (id: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** Callback to broadcast camera position to collaborators */
  onCameraMove?: (position: [number, number, number], target: [number, number, number]) => void;
  /** Target camera from a followed user (position + target), updated externally */
  followCamera?: { position: [number, number, number]; target: [number, number, number] } | null;
  /** Site zones drawn on the site planner map */
  siteZones?: SiteZone[];
}

// Warm color palette for buildings
const BUILDING_COLORS = [
  '#d4a574', // sandstone
  '#c9b99a', // warm beige
  '#a8927d', // taupe
  '#b8c4b8', // sage green
  '#c4b5a0', // khaki
  '#dbc8b0', // cream
  '#b0a090', // warm gray
  '#c8b8a0', // wheat
];

// Material-to-color mapping for facade materials
const MATERIAL_COLORS: Record<string, string> = {
  concrete: '#c7bfb5',
  glass: '#8cbbd6',
  brick: '#b8724a',
  metal: '#9a9a9e',
  wood: '#a67d50',
  green_roof: '#4a8c3f',
};

// =============================================================================
// Procedural Texture Generation — tileable CanvasTexture for facade materials
// =============================================================================

const textureCache = new Map<string, THREE.CanvasTexture>();

function getProceduralTexture(materialType: string, tileRepeat: [number, number] = [4, 4]): THREE.CanvasTexture {
  const cacheKey = `${materialType}-${tileRepeat[0]}-${tileRepeat[1]}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  switch (materialType) {
    case 'brick':
      drawBrickPattern(ctx, size);
      break;
    case 'concrete':
      drawConcretePattern(ctx, size);
      break;
    case 'glass':
      drawGlassPattern(ctx, size);
      break;
    case 'metal':
      drawMetalPattern(ctx, size);
      break;
    case 'wood':
      drawWoodPattern(ctx, size);
      break;
    case 'green_roof':
      drawGreenRoofPattern(ctx, size);
      break;
    default:
      ctx.fillStyle = '#c0b8ac';
      ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(tileRepeat[0], tileRepeat[1]);
  texture.needsUpdate = true;
  textureCache.set(cacheKey, texture);
  return texture;
}

function drawBrickPattern(ctx: CanvasRenderingContext2D, size: number) {
  const brickH = size / 8;
  const brickW = size / 4;
  const mortarSize = 3;

  // Mortar background
  ctx.fillStyle = '#a09080';
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < 8; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col <= 4; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      // Vary brick color slightly
      const r = 168 + Math.floor(Math.random() * 30 - 15);
      const g = 96 + Math.floor(Math.random() * 20 - 10);
      const b = 60 + Math.floor(Math.random() * 20 - 10);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        x + mortarSize,
        y + mortarSize,
        brickW - mortarSize * 2,
        brickH - mortarSize * 2,
      );
    }
  }
}

function drawConcretePattern(ctx: CanvasRenderingContext2D, size: number) {
  // Base color
  ctx.fillStyle = '#c4bab0';
  ctx.fillRect(0, 0, size, size);

  // Add noise speckles
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const brightness = 160 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${brightness},${brightness - 8},${brightness - 16},0.3)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Subtle panel lines
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  const panelSize = size / 4;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * panelSize, 0);
    ctx.lineTo(i * panelSize, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * panelSize);
    ctx.lineTo(size, i * panelSize);
    ctx.stroke();
  }
}

function drawGlassPattern(ctx: CanvasRenderingContext2D, size: number) {
  // Reflective blue-gray background
  ctx.fillStyle = '#7aaccc';
  ctx.fillRect(0, 0, size, size);

  // Glass panel grid
  const panelW = size / 4;
  const panelH = size / 4;
  const frameSize = 4;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      // Slightly varying tint for each panel
      const tint = 140 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgba(${tint + 10},${tint + 40},${tint + 60},0.8)`;
      ctx.fillRect(
        col * panelW + frameSize,
        row * panelH + frameSize,
        panelW - frameSize * 2,
        panelH - frameSize * 2,
      );
      // Highlight streak
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(
        col * panelW + frameSize + 2,
        row * panelH + frameSize + 2,
        (panelW - frameSize * 2) * 0.3,
        panelH - frameSize * 2 - 4,
      );
    }
  }

  // Frames
  ctx.strokeStyle = '#4a6a7a';
  ctx.lineWidth = frameSize;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * panelW, 0);
    ctx.lineTo(i * panelW, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * panelH);
    ctx.lineTo(size, i * panelH);
    ctx.stroke();
  }
}

function drawMetalPattern(ctx: CanvasRenderingContext2D, size: number) {
  // Brushed metal base
  ctx.fillStyle = '#9a9a9e';
  ctx.fillRect(0, 0, size, size);

  // Horizontal brush lines
  for (let y = 0; y < size; y++) {
    const brightness = 140 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${brightness},${brightness},${brightness + 5},0.15)`;
    ctx.fillRect(0, y, size, 1);
  }

  // Panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 2;
  const panelH = size / 3;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * panelH);
    ctx.lineTo(size, i * panelH);
    ctx.stroke();
  }

  // Rivet dots
  ctx.fillStyle = 'rgba(120,120,125,0.5)';
  for (let i = 0; i < 3; i++) {
    const y = i * panelH + 6;
    for (let x = 20; x < size; x += 40) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWoodPattern(ctx: CanvasRenderingContext2D, size: number) {
  // Wood base
  ctx.fillStyle = '#a0783c';
  ctx.fillRect(0, 0, size, size);

  // Grain lines — wavy horizontal lines
  for (let y = 0; y < size; y += 3) {
    const brightness = 130 + Math.floor(Math.random() * 50);
    ctx.strokeStyle = `rgba(${brightness},${brightness - 30},${brightness - 60},0.25)`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    let xOff = 0;
    for (let x = 0; x <= size; x += 4) {
      xOff += (Math.random() - 0.5) * 0.5;
      if (x === 0) ctx.moveTo(x, y + xOff);
      else ctx.lineTo(x, y + xOff);
    }
    ctx.stroke();
  }

  // Knots
  for (let i = 0; i < 3; i++) {
    const kx = 30 + Math.random() * (size - 60);
    const ky = 30 + Math.random() * (size - 60);
    ctx.fillStyle = 'rgba(80,50,20,0.3)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 8 + Math.random() * 6, 4 + Math.random() * 4, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Plank dividers
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 2;
  const plankW = size / 4;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * plankW, 0);
    ctx.lineTo(i * plankW, size);
    ctx.stroke();
  }
}

function drawGreenRoofPattern(ctx: CanvasRenderingContext2D, size: number) {
  // Soil/substrate background
  ctx.fillStyle = '#5a7a3a';
  ctx.fillRect(0, 0, size, size);

  // Dense vegetation noise — many small green blobs
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.floor(Math.random() * 50);
    const g = 100 + Math.floor(Math.random() * 80);
    const b = 20 + Math.floor(Math.random() * 40);
    const radius = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Larger leaf clusters
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const g = 110 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(40,${g},30,0.4)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + Math.random() * 5, 2 + Math.random() * 3, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Small flowers
  const flowerColors = ['rgba(220,200,60,0.5)', 'rgba(200,100,150,0.4)', 'rgba(180,180,220,0.4)'];
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle height variation — darker patches for depth
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 10 + Math.random() * 15;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(30,60,20,0.2)');
    gradient.addColorStop(1, 'rgba(30,60,20,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Main 3D scene viewer component.
 * Renders buildings using React Three Fiber with orbit controls,
 * environment lighting, and shadow support.
 */
export function SceneViewer({ buildings, documents, contextBuildings, contextRoads, onBuildingClick, onBuildingHover, showMapBackground, latitude, longitude, annotations, onAnnotationClick, onResolveAnnotation, onDeleteAnnotation, onCameraMove, followCamera, siteZones }: SceneViewerProps) {
  const { settings, isAnnotating } = useViewerStore();

  // Compute grid positions for buildings so they don't stack
  const positions = computeBuildingPositions(buildings);

  // Filter image documents for display
  const imageDocuments = (documents || []).filter((d) =>
    ['jpg', 'jpeg', 'png'].includes(d.file_type)
  );

  // Track the GL renderer so we can force-dispose on unmount (prevents WebGL context leaks during HMR)
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => {
    return () => {
      if (glRef.current) {
        glRef.current.dispose();
        glRef.current.forceContextLoss();
        glRef.current = null;
      }
    };
  }, []);

  return (
    <Canvas
      shadows={settings.showShadows}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      className="h-full w-full"
      tabIndex={0}
      style={showMapBackground ? { background: 'transparent' } : undefined}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        glRef.current = gl;
      }}
    >
      <PerspectiveCamera makeDefault position={[50, 50, 50]} fov={60} />
      <SceneBackgroundManager transparent={!!showMapBackground} />

      {/* Lighting — sun position from time + date */}
      <SunLight settings={settings} showMapBackground={showMapBackground} latitude={latitude} />

      {/* Ground — hide grid when map is active */}
      {settings.showGrid && !showMapBackground && (
        <Grid
          infiniteGrid
          cellSize={5}
          sectionSize={50}
          fadeDistance={500}
          cellColor="#e5e7eb"
          sectionColor="#9ca3af"
        />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[1000, 1000]} />
        <shadowMaterial opacity={0.15} />
      </mesh>

      {/* Uploaded reference images on the ground */}
      {imageDocuments.map((doc, i) => (
        <ReferenceImage key={doc.id} document={doc} index={i} totalImages={imageDocuments.length} />
      ))}

      {/* Buildings — hidden when map is active (site zones render natively in Mapbox) */}
      {!showMapBackground && (
      <Suspense
        fallback={
          <Html center>
            <div className="rounded-lg bg-white px-4 py-2 shadow-lg">Loading models...</div>
          </Html>
        }
      >
        {buildings.map((building, index) => (
          <BuildingMesh
            key={building.id}
            building={building}
            position={positions[index]}
            colorIndex={index}
            onClick={() => onBuildingClick?.(building.id)}
            onPointerOver={() => onBuildingHover?.(building.id)}
            onPointerOut={() => onBuildingHover?.(null)}
          />
        ))}
      </Suspense>
      )}

      {/* Context buildings from OSM — hidden when map is active (map shows real buildings) */}
      {settings.showExistingBuildings && !showMapBackground && contextBuildings && contextBuildings.length > 0 && (
        <ContextBuildingsGroup buildings={contextBuildings} projectLat={latitude} projectLng={longitude} />
      )}

      {/* Roads from OSM — hidden when map is active (map shows real roads) */}
      {settings.showRoads && !showMapBackground && contextRoads && contextRoads.length > 0 && (
        <RoadsGroup roads={contextRoads} projectLat={latitude} projectLng={longitude} />
      )}

      {/* Site zones from planner — hidden when map is active (rendered natively in Mapbox) */}
      {siteZones && siteZones.length > 0 && !showMapBackground && (
        <SiteZonesGroup zones={siteZones} projectLat={latitude} projectLng={longitude} />
      )}

      {/* Landscaping — trees and green spaces (hidden when map is active) */}
      {settings.showLandscaping && !showMapBackground && buildings.length > 0 && (
        <>
          <LandscapingGroup buildingCount={buildings.length} />
          <SiteFurnitureGroup buildingCount={buildings.length} />
        </>
      )}

      {/* Shadow study overlay */}
      {settings.showShadows && settings.showShadowStudy && (
        <ShadowStudyOverlay
          buildings={buildings}
          positions={positions}
          sunDate={settings.sunDate}
          latitude={latitude}
        />
      )}

      {/* Measurement tool */}
      {settings.showMeasurements && <MeasurementTool />}

      {/* Performance monitor */}
      {settings.showPerformance && <PerformanceMonitor />}

      {/* Camera path recording & playback */}
      <CameraPathSystem />

      {/* Scene export handler */}
      <SceneExporter />

      {/* Mini-map */}
      <MiniMap />

      {/* Annotation click plane (when annotating mode active) */}
      {isAnnotating && onAnnotationClick && (
        <AnnotationClickPlane onAnnotationClick={onAnnotationClick} />
      )}

      {/* Annotation markers */}
      {annotations && annotations.length > 0 && (
        <AnnotationMarkers
          annotations={annotations}
          onResolve={onResolveAnnotation}
          onDelete={onDeleteAnnotation}
        />
      )}

      {/* Controls */}
      <CameraControls />

      {/* Camera broadcasting for collaboration + map sync */}
      {onCameraMove && <CameraBroadcaster onCameraMove={onCameraMove} syncMap={showMapBackground} />}

      {/* Camera follow mode — lerps camera to followed user's position */}
      {followCamera && <CameraFollower target={followCamera} />}
    </Canvas>
  );
}

/**
 * Compute non-overlapping grid positions for buildings.
 */
function computeBuildingPositions(buildings: Building[]): [number, number, number][] {
  const spacing = 30;
  const cols = Math.max(1, Math.ceil(Math.sqrt(buildings.length)));
  return buildings.map((b, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const height = b.height_meters || 10;
    return [col * spacing, height / 2, row * spacing];
  });
}

/** Broadcasts local camera position to collaborators at ~10fps and syncs Mapbox map */
function CameraBroadcaster({ onCameraMove, syncMap }: { onCameraMove: (pos: [number, number, number], target: [number, number, number]) => void; syncMap?: boolean }) {
  const { camera, size } = useThree();
  const lastSend = useRef(0);
  const lastPos = useRef(new THREE.Vector3());
  const lastQuat = useRef(new THREE.Quaternion());
  const prevSyncMap = useRef(syncMap);

  // When syncMap turns on, force an immediate sync even if camera hasn't moved
  useEffect(() => {
    if (syncMap && !prevSyncMap.current) {
      // Reset lastPos to force a sync on next frame
      lastPos.current.set(Infinity, Infinity, Infinity);
    }
    prevSyncMap.current = syncMap;
  }, [syncMap]);

  useFrame(() => {
    // Check if camera position or rotation changed
    const posMoved = camera.position.distanceToSquared(lastPos.current) > 0.0001;
    const rotChanged = !camera.quaternion.equals(lastQuat.current);
    if (!posMoved && !rotChanged) return;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // Sync Mapbox map camera every frame for tight alignment
    if (syncMap) {
      const camY = Math.max(1, camera.position.y);

      // Compute ground intersection: ray from camera along look direction hitting y=0
      let groundX: number;
      let groundZ: number;
      let distToGround: number;

      if (dir.y < -0.001) {
        // Camera looking downward — intersect y=0 plane
        const t = -camera.position.y / dir.y;
        const clampedT = Math.min(t, 2000); // Clamp max distance to prevent extremes at shallow angles
        groundX = camera.position.x + dir.x * clampedT;
        groundZ = camera.position.z + dir.z * clampedT;
        distToGround = Math.sqrt(
          (camera.position.x - groundX) ** 2 +
          camY ** 2 +
          (camera.position.z - groundZ) ** 2,
        );
      } else {
        // Camera looking upward or horizontal — fallback: project straight down
        groundX = camera.position.x;
        groundZ = camera.position.z;
        distToGround = camY;
      }

      // Pitch: angle between look direction and horizontal plane
      const elevationAngle = Math.asin(Math.max(-1, Math.min(1, dir.y))) * (180 / Math.PI);
      const pitch = Math.max(0, Math.min(85, 90 + elevationAngle));

      // Bearing: clockwise from north (negative Z direction)
      const bearing = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;

      // Meters per pixel based on Three.js camera
      const fov = (camera as THREE.PerspectiveCamera).fov || 60;
      const fovRad = (fov * Math.PI) / 180;
      const metersPerPixel = (2 * distToGround * Math.tan(fovRad / 2)) / size.height;

      window.dispatchEvent(new CustomEvent('mapbox-sync-camera', {
        detail: { groundX, groundZ, camY, metersPerPixel, bearing, pitch },
      }));
    }

    // Throttle collaboration broadcasts to ~10fps
    const now = performance.now();
    if (now - lastSend.current < 100) return;
    lastSend.current = now;
    lastPos.current.copy(camera.position);
    lastQuat.current.copy(camera.quaternion);

    const target: [number, number, number] = [
      camera.position.x + dir.x * 50,
      camera.position.y + dir.y * 50,
      camera.position.z + dir.z * 50,
    ];
    onCameraMove(
      [camera.position.x, camera.position.y, camera.position.z],
      target,
    );
  });

  return null;
}

/** Smoothly lerps the local camera to follow a remote user's camera */
function CameraFollower({ target }: { target: { position: [number, number, number]; target: [number, number, number] } }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(...target.position));
  const targetLook = useRef(new THREE.Vector3(...target.target));

  useEffect(() => {
    targetPos.current.set(...target.position);
    targetLook.current.set(...target.target);
  }, [target]);

  useFrame((_, delta) => {
    const lerpFactor = Math.min(1, delta * 5); // Smooth ~200ms lag
    camera.position.lerp(targetPos.current, lerpFactor);
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    currentLook.multiplyScalar(50).add(camera.position);
    currentLook.lerp(targetLook.current, lerpFactor);
    camera.lookAt(currentLook);
  });

  return null;
}

/**
 * Camera controls with three modes:
 * - Orbit: OrbitControls + WASD movement (default architectural view)
 * - FirstPerson (Walk): Eye-level, WASD walk on ground, mouse look via pointer lock
 * - FlyThrough (Fly): Free 6DOF movement, mouse look via pointer lock
 */
function CameraControls() {
  const { settings } = useViewerStore();
  const mode = settings.cameraMode;

  if (mode === 'firstPerson') return <FirstPersonControls />;
  if (mode === 'flyThrough') return <FlyThroughControls />;
  return <OrbitCameraControls />;
}

/** Orbit mode: OrbitControls + WASD pan + camera preset transitions */
function OrbitCameraControls() {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const keysPressed = useRef<Set<string>>(new Set());
  const { settings, cameraTarget, clearCameraTarget } = useViewerStore();
  const speed = 0.8 * settings.moveSpeed;

  // Smooth transition state
  const transitionRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    t: number;
  } | null>(null);

  // Trigger transition when cameraTarget changes
  useEffect(() => {
    if (!cameraTarget || !controlsRef.current) return;
    transitionRef.current = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(...cameraTarget.position),
      startTarget: controlsRef.current.target.clone(),
      endTarget: new THREE.Vector3(...cameraTarget.target),
      t: 0,
    };
    clearCameraTarget();
  }, [cameraTarget, camera, clearCameraTarget]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    keysPressed.current.add(e.key.toLowerCase());
  }, []);
  const onKeyUp = useCallback((e: KeyboardEvent) => {
    keysPressed.current.delete(e.key.toLowerCase());
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  useFrame((_, delta) => {
    // Handle smooth camera transition
    if (transitionRef.current) {
      const tr = transitionRef.current;
      tr.t = Math.min(1, tr.t + delta * 2); // ~0.5 seconds
      const ease = 1 - Math.pow(1 - tr.t, 3); // ease-out cubic
      camera.position.lerpVectors(tr.startPos, tr.endPos, ease);
      if (controlsRef.current) {
        controlsRef.current.target.lerpVectors(tr.startTarget, tr.endTarget, ease);
      }
      if (tr.t >= 1) transitionRef.current = null;
      return;
    }

    // WASD movement
    const keys = keysPressed.current;
    if (keys.size === 0) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();

    if (keys.has('w') || keys.has('arrowup')) move.add(forward);
    if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
    if (keys.has('d') || keys.has('arrowright')) move.add(right);
    if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
    if (keys.has('q') || keys.has(' ')) move.y += 1;
    if (keys.has('e') || keys.has('shift')) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
      if (controlsRef.current) {
        controlsRef.current.target.add(move);
        controlsRef.current.target.y = Math.max(0, controlsRef.current.target.y);
      }
      camera.position.y = Math.max(2, camera.position.y);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      maxPolarAngle={Math.PI / 2.1}
      minDistance={5}
      maxDistance={500}
    />
  );
}

/** Raycast-based collision check. Returns true if path is blocked. */
function useCollisionCheck() {
  const { scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const collisionDistance = 1.5; // meters — clearance buffer

  return useCallback((origin: THREE.Vector3, direction: THREE.Vector3): boolean => {
    if (direction.lengthSq() === 0) return false;
    raycaster.current.set(origin, direction.clone().normalize());
    raycaster.current.far = collisionDistance;
    const hits = raycaster.current.intersectObjects(scene.children, true);
    // Ignore non-mesh objects, ground plane, and invisible objects
    return hits.some(
      (h) =>
        (h.object as THREE.Mesh).isMesh &&
        h.object.visible &&
        h.object.name !== 'ground' &&
        h.distance < collisionDistance
    );
  }, [scene]);
}

/** First-person walk mode: eye-level, ground-locked, mouse look via pointer lock */
function FirstPersonControls() {
  const { camera, gl } = useThree();
  const keysPressed = useRef<Set<string>>(new Set());
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const checkCollision = useCollisionCheck();
  const { settings } = useViewerStore();
  const walkHeight = 1.7; // eye level in meters
  const baseSpeed = 0.3 * settings.moveSpeed;

  useEffect(() => {
    // Set camera to walking height
    camera.position.y = walkHeight;

    const onKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * 0.002;
      euler.current.x -= e.movementY * 0.002;
      euler.current.x = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    const onClick = () => {
      gl.domElement.requestPointerLock();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    gl.domElement.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      gl.domElement.removeEventListener('click', onClick);
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    };
  }, [camera, gl]);

  useFrame(() => {
    const keys = keysPressed.current;
    if (keys.size === 0) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) move.add(forward);
    if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
    if (keys.has('d') || keys.has('arrowright')) move.add(right);
    if (keys.has('a') || keys.has('arrowleft')) move.sub(right);

    if (move.lengthSq() > 0) {
      const speed = keys.has('shift') ? baseSpeed * 2.5 : baseSpeed;
      move.normalize().multiplyScalar(speed);
      // Collision check before moving
      if (!checkCollision(camera.position, move)) {
        camera.position.add(move);
      }
      camera.position.y = walkHeight; // Lock to ground level
    }
  });

  return null; // No OrbitControls in first-person mode
}

/** Fly-through mode: free 6DOF movement, mouse look via pointer lock */
function FlyThroughControls() {
  const { camera, gl } = useThree();
  const keysPressed = useRef<Set<string>>(new Set());
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const checkCollision = useCollisionCheck();
  const { settings } = useViewerStore();
  const baseSpeed = 0.6 * settings.moveSpeed;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * 0.002;
      euler.current.x -= e.movementY * 0.002;
      euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    const onClick = () => {
      gl.domElement.requestPointerLock();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    gl.domElement.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      gl.domElement.removeEventListener('click', onClick);
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    };
  }, [camera, gl]);

  useFrame(() => {
    const keys = keysPressed.current;
    if (keys.size === 0) return;

    // In fly mode, forward includes Y component (true flight direction)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) move.add(forward);
    if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
    if (keys.has('d') || keys.has('arrowright')) move.add(right);
    if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
    if (keys.has('q') || keys.has(' ')) move.y += 1;
    if (keys.has('e')) move.y -= 1;
    const sprint = keys.has('shift') ? 2.5 : 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(baseSpeed * sprint);
      if (!checkCollision(camera.position, move)) {
        camera.position.add(move);
      }
      camera.position.y = Math.max(0.5, camera.position.y);
    }
  });

  return null; // No OrbitControls in fly mode
}

// =============================================================================
// Performance Monitor (FPS + render stats)
// =============================================================================

function PerformanceMonitor() {
  const { gl } = useThree();
  const [stats, setStats] = useState({ fps: 0, triangles: 0, drawCalls: 0 });
  const frames = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    const elapsed = now - lastTime.current;

    // Update every 500ms
    if (elapsed >= 500) {
      const fps = Math.round((frames.current / elapsed) * 1000);
      const info = gl.info.render;
      setStats({
        fps,
        triangles: info.triangles,
        drawCalls: info.calls,
      });
      frames.current = 0;
      lastTime.current = now;
    }
  });

  // Performance budgets
  const FPS_BUDGET = 30;
  const TRIANGLE_BUDGET = 500_000;
  const DRAW_CALL_BUDGET = 200;

  const fpsColor = stats.fps >= 50 ? '#22c55e' : stats.fps >= FPS_BUDGET ? '#eab308' : '#ef4444';
  const fpsWarning = stats.fps > 0 && stats.fps < FPS_BUDGET;
  const triWarning = stats.triangles > TRIANGLE_BUDGET;
  const drawWarning = stats.drawCalls > DRAW_CALL_BUDGET;

  return (
    <Html
      position={[0, 0, 0]}
      style={{ position: 'fixed', top: 60, right: 12, pointerEvents: 'none' }}
      calculatePosition={() => [0, 0]}
    >
      <div className="rounded-md bg-gray-900/80 px-2.5 py-1.5 font-mono text-[11px] text-gray-300 backdrop-blur-sm">
        <div style={{ color: fpsColor }} className="font-bold">
          {stats.fps} FPS {fpsWarning && '⚠'}
        </div>
        <div style={{ color: triWarning ? '#ef4444' : undefined }}>
          {(stats.triangles / 1000).toFixed(1)}k tris {triWarning && '⚠'}
        </div>
        <div style={{ color: drawWarning ? '#ef4444' : undefined }}>
          {stats.drawCalls} draws {drawWarning && '⚠'}
        </div>
        {(fpsWarning || triWarning || drawWarning) && (
          <div className="mt-1 border-t border-gray-600 pt-1 text-[9px] text-amber-400">
            Budget: {FPS_BUDGET}+ FPS, {TRIANGLE_BUDGET / 1000}k tris, {DRAW_CALL_BUDGET} draws
          </div>
        )}
      </div>
    </Html>
  );
}

// =============================================================================
// Camera Path Recording & Playback
// =============================================================================

function CameraPathSystem() {
  const { camera } = useThree();
  const { isRecording, isPlaying, cameraPath, addKeyframe, stopPlayback } = useViewerStore();
  const recordTimer = useRef(0);
  const playbackTime = useRef(0);

  // Record keyframes every 0.1s while recording
  useFrame((_, delta) => {
    if (isRecording) {
      recordTimer.current += delta;
      if (recordTimer.current >= 0.1) {
        recordTimer.current = 0;
        const pos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
        // Approximate target from camera direction
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const target: [number, number, number] = [
          camera.position.x + dir.x * 50,
          camera.position.y + dir.y * 50,
          camera.position.z + dir.z * 50,
        ];
        addKeyframe(pos, target);
      }
      return;
    }

    if (isPlaying && cameraPath.length >= 2) {
      playbackTime.current += delta;

      // Normalize keyframe times (they're raw timestamps, convert to sequential)
      const totalDuration = cameraPath.length * 0.1; // 0.1s per keyframe
      const t = playbackTime.current;

      if (t >= totalDuration) {
        playbackTime.current = 0;
        stopPlayback();
        return;
      }

      // Find the two keyframes to interpolate between
      const frameIndex = t / 0.1;
      const i = Math.floor(frameIndex);
      const frac = frameIndex - i;

      if (i >= cameraPath.length - 1) {
        stopPlayback();
        playbackTime.current = 0;
        return;
      }

      const a = cameraPath[i];
      const b = cameraPath[i + 1];

      // Smooth interpolation (Catmull-Rom-like via cubic ease)
      const ease = frac * frac * (3 - 2 * frac); // smoothstep
      camera.position.set(
        a.position[0] + (b.position[0] - a.position[0]) * ease,
        a.position[1] + (b.position[1] - a.position[1]) * ease,
        a.position[2] + (b.position[2] - a.position[2]) * ease,
      );
      camera.lookAt(
        a.target[0] + (b.target[0] - a.target[0]) * ease,
        a.target[1] + (b.target[1] - a.target[1]) * ease,
        a.target[2] + (b.target[2] - a.target[2]) * ease,
      );
    }
  });

  // Reset playback time when starting playback
  useEffect(() => {
    if (isPlaying) {
      playbackTime.current = 0;
    }
  }, [isPlaying]);

  // Reset record timer when starting recording
  useEffect(() => {
    if (isRecording) {
      recordTimer.current = 0;
    }
  }, [isRecording]);

  return null;
}

// =============================================================================
// Mini-map (overhead orthographic view with camera indicator)
// =============================================================================

function MiniMap() {
  const { camera } = useThree();
  const [camPos, setCamPos] = useState<[number, number, number]>([0, 0, 0]);
  const [camDir, setCamDir] = useState(0);

  useFrame(() => {
    setCamPos([camera.position.x, camera.position.y, camera.position.z]);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    setCamDir(Math.atan2(dir.x, dir.z));
  });

  return (
    <Html
      position={[0, 0, 0]}
      style={{ position: 'fixed', bottom: 16, right: 16, pointerEvents: 'none' }}
      calculatePosition={() => [0, 0]}
    >
      <div className="rounded-lg border border-white/20 bg-gray-900/80 p-1 backdrop-blur-sm" style={{ width: 120, height: 120 }}>
        <svg viewBox="-100 -100 200 200" width="112" height="112">
          {/* Grid */}
          <line x1="-80" y1="0" x2="80" y2="0" stroke="#4b5563" strokeWidth="0.5" />
          <line x1="0" y1="-80" x2="0" y2="80" stroke="#4b5563" strokeWidth="0.5" />
          {/* Camera position (XZ projected, scaled) */}
          <g transform={`translate(${Math.max(-80, Math.min(80, camPos[0] * 0.8))}, ${Math.max(-80, Math.min(80, camPos[2] * 0.8))})`}>
            {/* Direction cone */}
            <g transform={`rotate(${(camDir * 180) / Math.PI})`}>
              <polygon points="0,-12 -5,0 5,0" fill="#3b82f6" opacity="0.6" />
            </g>
            {/* Camera dot */}
            <circle r="4" fill="#3b82f6" />
            <circle r="4" fill="none" stroke="#93c5fd" strokeWidth="1" />
          </g>
          {/* Center marker */}
          <rect x="-3" y="-3" width="6" height="6" fill="#6b7280" opacity="0.5" />
        </svg>
      </div>
    </Html>
  );
}

// =============================================================================
// Scene Export (GLB)
// =============================================================================

function SceneExporter() {
  const { scene } = useThree();

  useEffect(() => {
    const handleExport = () => {
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'scene.glb';
          link.click();
          URL.revokeObjectURL(url);
        },
        (error) => {
          console.error('Scene export failed:', error);
        },
        { binary: true },
      );
    };

    window.addEventListener('export-scene-glb', handleExport);
    return () => window.removeEventListener('export-scene-glb', handleExport);
  }, [scene]);

  return null;
}

// =============================================================================
// Context Buildings from OSM
// =============================================================================

// Building-type color mapping for context buildings
const CONTEXT_BUILDING_COLORS: Record<string, string> = {
  apartments: '#c9a882',
  commercial: '#8ca8b8',
  school: '#c8b87a',
  industrial: '#a09080',
  residential: '#b8a898',
  retail: '#a8b8a0',
  office: '#98a8b8',
  house: '#b8a898',
  detached: '#b8a898',
  terrace: '#b0a090',
  church: '#c8b87a',
  warehouse: '#a09080',
  garage: '#a0a0a0',
  yes: '#b0a898',
};

function ContextBuildingsGroup({ buildings, projectLat, projectLng }: { buildings: ContextBuildingData[]; projectLat?: number; projectLng?: number }) {
  // Use project location as origin so context data aligns with project coordinate system
  const originRef = useMemo(() => {
    if (projectLat != null && projectLng != null) {
      return { lat: projectLat, lon: projectLng };
    }
    // Fallback: use centroid of all buildings
    if (buildings.length === 0) return { lat: 0, lon: 0 };
    let totalLat = 0, totalLon = 0, count = 0;
    for (const b of buildings) {
      for (const p of b.footprint) {
        totalLon += p[0];
        totalLat += p[1];
        count++;
      }
    }
    return { lat: totalLat / count, lon: totalLon / count };
  }, [buildings, projectLat, projectLng]);

  return (
    <group>
      {buildings.map((b) => (
        <ContextBuildingMesh key={b.osm_id} building={b} origin={originRef} />
      ))}
    </group>
  );
}

function ContextBuildingMesh({
  building,
  origin,
}: {
  building: ContextBuildingData;
  origin: { lat: number; lon: number };
}) {
  const { wallGeometry, roofGeometry, edgesGeometry } = useMemo(() => {
    // Convert footprint from lon/lat to local meters relative to origin
    const metersPerDegLat = 111320;
    const metersPerDegLon = metersPerDegLat * Math.cos((origin.lat * Math.PI) / 180);

    const points2D = building.footprint.map((p) => {
      const x = (p[0] - origin.lon) * metersPerDegLon;
      const z = (p[1] - origin.lat) * metersPerDegLat;
      // Shape y maps to 3D z = -y after rotateX(-PI/2), so y=z gives north=-Z
      return new THREE.Vector2(x, z);
    });

    if (points2D.length < 3) return { wallGeometry: null, roofGeometry: null, edgesGeometry: null };

    // Create extruded shape for walls
    const shape = new THREE.Shape(points2D);
    const extrudeSettings = {
      steps: 1,
      depth: building.height,
      bevelEnabled: false,
    };

    const wallGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Rotate to make extrusion go upward (Y axis) instead of Z
    wallGeom.rotateX(-Math.PI / 2);

    // Create flat roof cap on top
    const roofShape = new THREE.ShapeGeometry(shape);
    roofShape.rotateX(-Math.PI / 2);
    roofShape.translate(0, building.height, 0);

    // Edge lines for definition
    const edges = new THREE.EdgesGeometry(wallGeom, 30);

    return { wallGeometry: wallGeom, roofGeometry: roofShape, edgesGeometry: edges };
  }, [building, origin]);

  const wallColor = CONTEXT_BUILDING_COLORS[building.building_type || ''] || '#b0a898';
  // Roof is slightly darker than walls
  const roofColor = useMemo(() => {
    const c = new THREE.Color(wallColor);
    c.multiplyScalar(0.85);
    return '#' + c.getHexString();
  }, [wallColor]);

  if (!wallGeometry) return null;

  return (
    <group position={[0, 0, 0]}>
      {/* Walls */}
      <mesh geometry={wallGeometry} receiveShadow castShadow>
        <meshStandardMaterial
          color={wallColor}
          roughness={0.85}
          metalness={0.05}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Roof cap */}
      {roofGeometry && (
        <mesh geometry={roofGeometry} receiveShadow>
          <meshStandardMaterial
            color={roofColor}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>
      )}
      {/* Edge lines */}
      {edgesGeometry && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color="#888888" transparent opacity={0.3} />
        </lineSegments>
      )}
    </group>
  );
}

// =============================================================================
// Roads — render road polylines from OSM as flat strips
// =============================================================================

function RoadsGroup({ roads, projectLat, projectLng }: { roads: ContextRoadData[]; projectLat?: number; projectLng?: number }) {
  // Use project location as origin so roads align with project coordinate system
  const originRef = useMemo(() => {
    if (projectLat != null && projectLng != null) {
      return { lat: projectLat, lon: projectLng };
    }
    // Fallback: use centroid of all road coordinates
    if (roads.length === 0) return { lat: 0, lon: 0 };
    let totalLat = 0, totalLon = 0, count = 0;
    for (const r of roads) {
      for (const p of r.coords) {
        totalLon += p[0];
        totalLat += p[1];
        count++;
      }
    }
    return { lat: totalLat / count, lon: totalLon / count };
  }, [roads, projectLat, projectLng]);

  return (
    <group>
      {roads.map((r) => (
        <RoadSegment key={r.osm_id} road={r} origin={originRef} />
      ))}
    </group>
  );
}

// Slightly lighter road colors for better ground contrast
const ROAD_COLORS: Record<string, string> = {
  motorway: '#585858',
  trunk: '#5e5e5e',
  primary: '#636363',
  secondary: '#686868',
  tertiary: '#6e6e6e',
  residential: '#757575',
  service: '#808080',
  footway: '#9a9a8a',
  cycleway: '#8a9a8a',
  path: '#9a9a80',
  pedestrian: '#8a8a7a',
};

// Major road types that get a center line
const MAJOR_ROAD_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary']);

function RoadSegment({ road, origin }: { road: ContextRoadData; origin: { lat: number; lon: number } }) {
  const { roadGeometry, centerLineGeometry } = useMemo(() => {
    const metersPerDegLat = 111320;
    const metersPerDegLon = metersPerDegLat * Math.cos((origin.lat * Math.PI) / 180);

    // Convert coords to local 2D points
    const points = road.coords.map((p) => ({
      x: (p[0] - origin.lon) * metersPerDegLon,
      z: -(p[1] - origin.lat) * metersPerDegLat,
    }));

    if (points.length < 2) return { roadGeometry: null, centerLineGeometry: null };

    const halfWidth = road.width / 2;
    const vertices: number[] = [];
    const indices: number[] = [];

    // Generate a flat ribbon by extruding each segment perpendicular to its direction
    for (let i = 0; i < points.length; i++) {
      // Compute direction at this point
      let dx = 0, dz = 0;
      if (i < points.length - 1) {
        dx += points[i + 1].x - points[i].x;
        dz += points[i + 1].z - points[i].z;
      }
      if (i > 0) {
        dx += points[i].x - points[i - 1].x;
        dz += points[i].z - points[i - 1].z;
      }
      // Perpendicular (in XZ plane)
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;

      // Left and right vertices (slightly above ground to avoid z-fighting)
      vertices.push(
        points[i].x + nx * halfWidth, 0.05, points[i].z + nz * halfWidth,
        points[i].x - nx * halfWidth, 0.05, points[i].z - nz * halfWidth,
      );

      if (i < points.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const roadGeom = new THREE.BufferGeometry();
    roadGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    roadGeom.setIndex(indices);
    roadGeom.computeVertexNormals();

    // Center line for major roads
    let centerLineGeom: THREE.BufferGeometry | null = null;
    if (MAJOR_ROAD_TYPES.has(road.highway_type)) {
      const linePoints = points.map((p) => new THREE.Vector3(p.x, 0.08, p.z));
      centerLineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    }

    return { roadGeometry: roadGeom, centerLineGeometry: centerLineGeom };
  }, [road, origin]);

  if (!roadGeometry) return null;

  const color = ROAD_COLORS[road.highway_type] || '#757575';

  return (
    <group position={[0, 0, 0]}>
      <mesh geometry={roadGeometry} receiveShadow>
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.0} />
      </mesh>
      {centerLineGeometry && (
        <line geometry={centerLineGeometry}>
          <lineBasicMaterial color="#e0e0e0" transparent opacity={0.6} />
        </line>
      )}
    </group>
  );
}

// =============================================================================
// Measurement Formatting
// =============================================================================

// =============================================================================
// Landscaping — procedural trees and green spaces
// =============================================================================

function LandscapingGroup({ buildingCount }: { buildingCount: number }) {
  const treeData = useMemo(() => {
    // Seeded pseudo-random for deterministic tree placement
    const seed = buildingCount * 137;
    const rand = (i: number) => {
      const x = Math.sin(seed + i * 9301 + 49297) * 49297;
      return x - Math.floor(x);
    };
    const trees: { x: number; z: number; scale: number; type: 'conifer' | 'deciduous' }[] = [];
    const count = Math.min(60, buildingCount * 12 + 8);
    for (let i = 0; i < count; i++) {
      const angle = rand(i) * Math.PI * 2;
      const dist = 25 + rand(i + 100) * 60;
      trees.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        scale: 0.6 + rand(i + 200) * 0.8,
        type: rand(i + 300) > 0.4 ? 'deciduous' : 'conifer',
      });
    }
    return trees;
  }, [buildingCount]);

  return (
    <group>
      {treeData.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.scale}>
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
      {/* Green space patches */}
      {[
        { x: -30, z: 20, w: 15, d: 10 },
        { x: 25, z: -25, w: 12, d: 8 },
        { x: -10, z: -35, w: 20, d: 6 },
      ].map((patch, i) => (
        <mesh key={`patch-${i}`} position={[patch.x, 0.02, patch.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[patch.w, patch.d]} />
          <meshStandardMaterial color="#4a8c3f" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Site furniture: benches, light poles, bollards, and a parking lot.
 * Uses seeded pseudo-random for deterministic placement.
 */
function SiteFurnitureGroup({ buildingCount }: { buildingCount: number }) {
  const items = useMemo(() => {
    const seed = buildingCount * 251;
    const rand = (i: number) => {
      const x = Math.sin(seed + i * 7919 + 31337) * 31337;
      return x - Math.floor(x);
    };

    const benches: { x: number; z: number; rot: number }[] = [];
    const lights: { x: number; z: number }[] = [];
    const bollards: { x: number; z: number }[] = [];

    // Place benches along paths
    const benchCount = Math.min(12, buildingCount * 3 + 2);
    for (let i = 0; i < benchCount; i++) {
      const angle = rand(i) * Math.PI * 2;
      const dist = 18 + rand(i + 50) * 45;
      benches.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        rot: angle + Math.PI / 2,
      });
    }

    // Place street lights at regular intervals
    const lightCount = Math.min(16, buildingCount * 4 + 4);
    for (let i = 0; i < lightCount; i++) {
      const angle = (i / lightCount) * Math.PI * 2;
      const dist = 30 + rand(i + 150) * 30;
      lights.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
      });
    }

    // Place bollards along edges
    const bollardCount = Math.min(20, buildingCount * 5);
    for (let i = 0; i < bollardCount; i++) {
      const angle = rand(i + 250) * Math.PI * 2;
      const dist = 15 + rand(i + 350) * 20;
      bollards.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
      });
    }

    return { benches, lights, bollards };
  }, [buildingCount]);

  // Parking lot position
  const parkingPos = useMemo(() => {
    const offset = buildingCount * 30 + 20;
    return { x: offset, z: -20 };
  }, [buildingCount]);

  return (
    <group>
      {/* Benches */}
      {items.benches.map((b, i) => (
        <group key={`bench-${i}`} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
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
      ))}

      {/* Light poles */}
      {items.lights.map((l, i) => (
        <group key={`light-${i}`} position={[l.x, 0, l.z]}>
          {/* Pole */}
          <mesh position={[0, 2.5, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.06, 5, 6]} />
            <meshStandardMaterial color="#6a6a6a" roughness={0.3} metalness={0.8} />
          </mesh>
          {/* Lamp fixture */}
          <mesh position={[0, 5.1, 0]}>
            <sphereGeometry args={[0.2, 8, 6]} />
            <meshStandardMaterial color="#fff8e0" emissive="#fff8e0" emissiveIntensity={0.3} />
          </mesh>
          {/* Arm */}
          <mesh position={[0.15, 4.8, 0]} rotation={[0, 0, -0.4]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 4]} />
            <meshStandardMaterial color="#6a6a6a" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      ))}

      {/* Bollards */}
      {items.bollards.map((b, i) => (
        <mesh key={`bollard-${i}`} position={[b.x, 0.35, b.z]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.7, 8]} />
          <meshStandardMaterial color="#555555" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}

      {/* Parking lot */}
      {buildingCount > 0 && (
        <ParkingLot position={[parkingPos.x, 0.03, parkingPos.z]} spaces={8} />
      )}
    </group>
  );
}

/** Simple parking lot with striped spaces */
function ParkingLot({ position, spaces }: { position: [number, number, number]; spaces: number }) {
  const spaceWidth = 2.7;
  const spaceDepth = 5.5;
  const totalWidth = spaces * spaceWidth + 1;

  return (
    <group position={position}>
      {/* Asphalt surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[totalWidth, spaceDepth + 2]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.95} />
      </mesh>

      {/* Parking space lines */}
      {Array.from({ length: spaces + 1 }).map((_, i) => {
        const x = -totalWidth / 2 + 0.5 + i * spaceWidth;
        return (
          <mesh key={i} position={[x, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.1, spaceDepth]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        );
      })}

      {/* Front line */}
      <mesh position={[0, 0.01, -spaceDepth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[totalWidth, 0.1]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

function formatLength(meters: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') {
    const feet = meters * 3.28084;
    return feet >= 100 ? `${feet.toFixed(1)} ft` : `${feet.toFixed(2)} ft`;
  }
  return meters >= 100 ? `${meters.toFixed(1)} m` : `${meters.toFixed(2)} m`;
}

function formatArea(sqMeters: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') {
    const sqFeet = sqMeters * 10.7639;
    return `${sqFeet.toFixed(1)} ft²`;
  }
  return `${sqMeters.toFixed(1)} m²`;
}

// =============================================================================
// Measurement Tool
// =============================================================================

function MeasurementTool() {
  const {
    measurements, pendingPoint, pendingPolygon, pendingAngle,
    measurementMode, measurementUnit,
    addMeasurementPoint, addAreaPoint, closeAreaMeasurement, addAnglePoint,
  } = useViewerStore();

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const point: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    if (measurementMode === 'distance') {
      addMeasurementPoint(point);
    } else if (measurementMode === 'area') {
      addAreaPoint(point);
    } else if (measurementMode === 'angle') {
      addAnglePoint(point);
    }
    // Height mode is handled by building click, not ground click
  }, [measurementMode, addMeasurementPoint, addAreaPoint, addAnglePoint]);

  // Close polygon on Enter or double-click
  const handleDoubleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (measurementMode === 'area' && pendingPolygon.length >= 3) {
      closeAreaMeasurement();
    }
  }, [measurementMode, pendingPolygon.length, closeAreaMeasurement]);

  // Keyboard handler for closing area with Enter
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && measurementMode === 'area' && pendingPolygon.length >= 3) {
        closeAreaMeasurement();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [measurementMode, pendingPolygon.length, closeAreaMeasurement]);

  return (
    <>
      {/* Invisible ground plane for click detection */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        visible={false}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial />
      </mesh>

      {/* Pending distance point marker */}
      {pendingPoint && measurementMode === 'distance' && (
        <mesh position={pendingPoint}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.5} />
        </mesh>
      )}

      {/* Pending polygon points + outline */}
      {pendingPolygon.length > 0 && (
        <PendingPolygonPreview points={pendingPolygon} />
      )}

      {/* Pending angle points */}
      {pendingAngle.length > 0 && (
        <PendingAnglePreview points={pendingAngle} />
      )}

      {/* Completed measurements */}
      {measurements.map((m) => {
        if (m.type === 'area') {
          return <MeasurementPolygon key={m.id} measurement={m} unit={measurementUnit} />;
        }
        if (m.type === 'height') {
          return <HeightMeasurementLine key={m.id} measurement={m} unit={measurementUnit} />;
        }
        if (m.type === 'angle') {
          return <AngleMeasurementDisplay key={m.id} measurement={m} />;
        }
        return <MeasurementLine key={m.id} measurement={m} unit={measurementUnit} />;
      })}
    </>
  );
}

function PendingPolygonPreview({ points }: { points: [number, number, number][] }) {
  const lineGeometry = useMemo(() => {
    if (points.length < 2) return null;
    const geom = new THREE.BufferGeometry();
    const allPoints = points.flatMap((p) => p);
    const positions = new Float32Array(allPoints);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [points]);

  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.3} />
        </mesh>
      ))}
      {lineGeometry && (
        <line geometry={lineGeometry}>
          <lineBasicMaterial color="#f59e0b" linewidth={2} />
        </line>
      )}
      {points.length >= 3 && (
        <Html position={[points[0][0], points[0][1] + 2, points[0][2]]} center>
          <div className="whitespace-nowrap rounded-md bg-amber-500 px-2 py-1 text-[10px] font-bold text-white shadow-lg">
            Enter or double-click to close
          </div>
        </Html>
      )}
    </>
  );
}

function MeasurementLine({ measurement, unit }: { measurement: Measurement; unit: 'metric' | 'imperial' }) {
  const [p1, p2] = measurement.points;
  const midpoint: [number, number, number] = [
    (p1[0] + p2[0]) / 2,
    (p1[1] + p2[1]) / 2 + 1.5,
    (p1[2] + p2[2]) / 2,
  ];

  const lineGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([...p1, ...p2]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [p1, p2]);

  return (
    <>
      <line geometry={lineGeometry}>
        <lineBasicMaterial color="#ef4444" linewidth={2} />
      </line>
      <mesh position={p1}>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      <mesh position={p2}>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      <Html position={midpoint} center>
        <div className="whitespace-nowrap rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white shadow-lg">
          {formatLength(measurement.distance, unit)}
        </div>
      </Html>
    </>
  );
}

function MeasurementPolygon({ measurement, unit }: { measurement: Measurement; unit: 'metric' | 'imperial' }) {
  const points = measurement.points;

  // Compute centroid for the label
  const centroid: [number, number, number] = useMemo(() => {
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length + 2;
    const cz = points.reduce((s, p) => s + p[2], 0) / points.length;
    return [cx, cy, cz];
  }, [points]);

  // Outline geometry (closed loop)
  const outlineGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const closed = [...points, points[0]];
    const positions = new Float32Array(closed.flatMap((p) => p));
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [points]);

  // Fill geometry (triangulated polygon on XZ plane)
  const fillGeometry = useMemo(() => {
    if (points.length < 3) return null;
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[2])));
    const geom = new THREE.ShapeGeometry(shape);
    // Rotate shape from XY to XZ plane
    geom.rotateX(-Math.PI / 2);
    // Lift slightly above ground
    geom.translate(0, 0.05, 0);
    return geom;
  }, [points]);

  return (
    <>
      {/* Outline */}
      <line geometry={outlineGeometry}>
        <lineBasicMaterial color="#f59e0b" linewidth={2} />
      </line>

      {/* Vertex markers */}
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.35, 12, 12]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
      ))}

      {/* Semi-transparent fill */}
      {fillGeometry && (
        <mesh geometry={fillGeometry}>
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Area label */}
      <Html position={centroid} center>
        <div className="whitespace-nowrap rounded-md bg-amber-500 px-2 py-1 text-xs font-bold text-white shadow-lg">
          {formatArea(measurement.distance, unit)}
        </div>
      </Html>
    </>
  );
}

function HeightMeasurementLine({ measurement, unit }: { measurement: Measurement; unit: 'metric' | 'imperial' }) {
  const [base, top] = measurement.points;
  const midpoint: [number, number, number] = [
    base[0] + 1.5,
    (base[1] + top[1]) / 2,
    base[2],
  ];

  const lineGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([...base, ...top]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [base, top]);

  return (
    <>
      {/* Vertical line */}
      <line geometry={lineGeometry}>
        <lineBasicMaterial color="#8b5cf6" linewidth={2} />
      </line>
      {/* Base marker */}
      <mesh position={base}>
        <sphereGeometry args={[0.35, 12, 12]} />
        <meshStandardMaterial color="#8b5cf6" />
      </mesh>
      {/* Top marker */}
      <mesh position={top}>
        <sphereGeometry args={[0.35, 12, 12]} />
        <meshStandardMaterial color="#8b5cf6" />
      </mesh>
      {/* Height label */}
      <Html position={midpoint} center>
        <div className="whitespace-nowrap rounded-md bg-violet-600 px-2 py-1 text-xs font-bold text-white shadow-lg">
          H: {formatLength(measurement.distance, unit)}
        </div>
      </Html>
    </>
  );
}

function PendingAnglePreview({ points }: { points: [number, number, number][] }) {
  const lineGeometry = useMemo(() => {
    if (points.length < 2) return null;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(points.flatMap((p) => p));
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [points]);

  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.3} />
        </mesh>
      ))}
      {lineGeometry && (
        <line geometry={lineGeometry}>
          <lineBasicMaterial color="#06b6d4" linewidth={2} />
        </line>
      )}
      {points.length === 1 && (
        <Html position={[points[0][0], points[0][1] + 2, points[0][2]]} center>
          <div className="whitespace-nowrap rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-bold text-white shadow-lg">
            Click vertex point next
          </div>
        </Html>
      )}
      {points.length === 2 && (
        <Html position={[points[1][0], points[1][1] + 2, points[1][2]]} center>
          <div className="whitespace-nowrap rounded-md bg-cyan-600 px-2 py-1 text-[10px] font-bold text-white shadow-lg">
            Click end point
          </div>
        </Html>
      )}
    </>
  );
}

function AngleMeasurementDisplay({ measurement }: { measurement: Measurement }) {
  const [a, vertex, c] = measurement.points;

  // Two lines: vertex→a and vertex→c
  const lineGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([...a, ...vertex, ...vertex, ...c]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [a, vertex, c]);

  // Arc geometry to visualize the angle
  const arcGeometry = useMemo(() => {
    const radius = 3;
    const va = new THREE.Vector3(a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]).normalize();
    const vc = new THREE.Vector3(c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]).normalize();
    const angleRad = (measurement.distance * Math.PI) / 180;
    const segments = Math.max(8, Math.ceil(angleRad * 16));

    const points: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Slerp-like interpolation between va and vc
      const dir = va.clone().lerp(vc, t).normalize().multiplyScalar(radius);
      points.push(vertex[0] + dir.x, vertex[1] + dir.y, vertex[2] + dir.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    return geom;
  }, [a, vertex, c, measurement.distance]);

  // Label position: midpoint of the arc
  const labelPos: [number, number, number] = useMemo(() => {
    const va = new THREE.Vector3(a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]).normalize();
    const vc = new THREE.Vector3(c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]).normalize();
    const mid = va.clone().lerp(vc, 0.5).normalize().multiplyScalar(4);
    return [vertex[0] + mid.x, vertex[1] + mid.y + 1.5, vertex[2] + mid.z];
  }, [a, vertex, c]);

  return (
    <>
      {/* Two rays from vertex */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color="#06b6d4" linewidth={2} />
      </lineSegments>

      {/* Arc */}
      <line geometry={arcGeometry}>
        <lineBasicMaterial color="#06b6d4" linewidth={2} />
      </line>

      {/* Vertex marker */}
      {[a, vertex, c].map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.35, 12, 12]} />
          <meshStandardMaterial color={i === 1 ? '#0891b2' : '#06b6d4'} />
        </mesh>
      ))}

      {/* Angle label */}
      <Html position={labelPos} center>
        <div className="whitespace-nowrap rounded-md bg-cyan-600 px-2 py-1 text-xs font-bold text-white shadow-lg">
          {measurement.distance.toFixed(1)}°
        </div>
      </Html>
    </>
  );
}

/**
 * Renders an uploaded image as a reference overlay on the ground plane.
 */
function ReferenceImage({ document: doc, index }: { document: Document; index: number; totalImages: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const imageUrl = `${apiBase}/api/v1/documents/${doc.id}/file`;

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      imageUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        if (meshRef.current) {
          const mat = meshRef.current.material as THREE.MeshStandardMaterial;
          mat.map = tex;
          mat.needsUpdate = true;
        }
      },
      undefined,
      (err) => console.error('Failed to load reference image:', err),
    );
  }, [imageUrl]);

  const size = 40;
  const xOffset = -50 + index * (size + 5);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[xOffset, 0.02, -40]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.95} side={THREE.DoubleSide} />
    </mesh>
  );
}

// =============================================================================
// Building Mesh — Three rendering paths
// =============================================================================

interface BuildingMeshProps {
  building: Building;
  position: [number, number, number];
  colorIndex: number;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}

function BuildingMesh({ building, position, colorIndex, onClick, onPointerOver, onPointerOut }: BuildingMeshProps) {
  const { selectedBuildingId, hoveredBuildingId, measurementMode, settings, addHeightMeasurement, isComparing, comparePhase, compareDivider } = useViewerStore();
  const groupRef = useRef<THREE.Group>(null);
  const { camera, size: viewportSize } = useThree();

  const height = building.height_meters || 10;
  const isSelected = selectedBuildingId === building.id;
  const isHovered = hoveredBuildingId === building.id;

  // Phase visibility — in comparison mode, check screen-space position
  const screenPhaseRef = useRef(settings.activePhase);

  // Determine effective phase for this building based on screen position in compare mode
  let effectivePhase = settings.activePhase;
  if (isComparing && comparePhase !== null && groupRef.current) {
    // Project building world position to screen space
    const worldPos = new THREE.Vector3(...position);
    const screenPos = worldPos.clone().project(camera);
    const screenX = ((screenPos.x + 1) / 2) * 100; // 0-100%
    effectivePhase = screenX < compareDivider ? settings.activePhase : comparePhase;
    screenPhaseRef.current = effectivePhase;
  }

  const isPhaseVisible = effectivePhase === null ||
    building.construction_phase === undefined ||
    building.construction_phase === null ||
    building.construction_phase <= effectivePhase!;

  const visibilityRef = useRef(isPhaseVisible ? 1 : 0);

  useFrame((_, delta) => {
    // Re-check screen position in compare mode each frame
    let target: number;
    if (isComparing && comparePhase !== null && groupRef.current) {
      const worldPos = new THREE.Vector3(...position);
      const screenPos = worldPos.clone().project(camera);
      const screenX = ((screenPos.x + 1) / 2) * 100;
      const phase = screenX < compareDivider ? settings.activePhase : comparePhase;
      const visible = phase === null ||
        building.construction_phase === undefined ||
        building.construction_phase === null ||
        building.construction_phase <= phase!;
      target = visible ? 1 : 0;
    } else {
      target = isPhaseVisible ? 1 : 0;
    }
    const current = visibilityRef.current;
    if (Math.abs(current - target) < 0.01) {
      visibilityRef.current = target;
    } else {
      visibilityRef.current += (target - current) * Math.min(1, delta * 5);
    }
    if (groupRef.current) {
      const v = visibilityRef.current;
      const s = 0.01 + v * 0.99; // scale 0.01 → 1
      groupRef.current.scale.set(s, s, s);
      groupRef.current.visible = v > 0.01;
      // Set opacity on all mesh children
      groupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.opacity !== undefined) {
            mat.transparent = v < 0.99;
            mat.opacity = Math.min(mat.userData?.baseOpacity ?? 1, v);
          }
        }
      });
    }
  });

  const handleClick = useCallback(() => {
    if (!isPhaseVisible) return; // Don't interact with hidden buildings
    if (settings.showMeasurements && measurementMode === 'height') {
      const base: [number, number, number] = [position[0], position[1] - height / 2, position[2]];
      const top: [number, number, number] = [position[0], position[1] + height / 2, position[2]];
      addHeightMeasurement(base, top);
    } else {
      onClick?.();
    }
  }, [isPhaseVisible, settings.showMeasurements, measurementMode, position, height, addHeightMeasurement, onClick]);

  const hasGLB = !!building.model_url;
  const hasBuildingData = !!(building.floor_count || building.roof_type);

  return (
    <group ref={groupRef} position={position}>
      {hasGLB ? (
        // Path A: GLB model from server (with LOD switching)
        <GLBBuildingMesh
          buildingId={building.id}
          lodUrls={building.lod_urls}
          isSelected={isSelected}
          isHovered={isHovered}
          onClick={handleClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        />
      ) : hasBuildingData ? (
        // Path B: Procedural rendering with roofs, windows, floor lines
        <ProceduralBuildingMesh
          building={building}
          colorIndex={colorIndex}
          isSelected={isSelected}
          isHovered={isHovered}
          onClick={handleClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        />
      ) : (
        // Path C: Minimal fallback gray box
        <FallbackBuildingMesh
          height={height}
          isSelected={isSelected}
          isHovered={isHovered}
          onClick={handleClick}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        />
      )}

      {/* Building label */}
      {(isSelected || isHovered) && isPhaseVisible && building.name && (
        <Html position={[0, height / 2 + 2, 0]} center>
          <div className="whitespace-nowrap rounded-lg bg-gray-900/80 px-3 py-1.5 text-sm font-medium text-white shadow-lg">
            {building.name}
            {building.floor_count && <span className="ml-2 text-gray-300">{building.floor_count}F</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

// =============================================================================
// Path A: GLB Building Mesh
// =============================================================================

function GLBBuildingMesh({
  buildingId,
  lodUrls,
  isSelected,
  isHovered,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  buildingId: string;
  lodUrls?: Record<string, string>;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Determine available LOD levels, sorted highest (lowest detail) first
  const availableLods = useMemo(() => {
    if (!lodUrls) return [0];
    return Object.keys(lodUrls).map(Number).sort((a, b) => b - a);
  }, [lodUrls]);

  const hasLods = availableLods.length > 1;

  // Start at the lowest-detail LOD (highest number) for fast initial load
  const [currentLod, setCurrentLod] = useState(() => availableLods[0]);
  const [loadedLods, setLoadedLods] = useState<Set<number>>(() => new Set());

  // Distance-based LOD switching — only switch to LODs that have been preloaded
  useFrame(() => {
    if (!hasLods || !groupRef.current) return;
    const worldPos = new THREE.Vector3();
    groupRef.current.getWorldPosition(worldPos);
    const distance = camera.position.distanceTo(worldPos);

    // Find the ideal LOD for this distance
    let targetLod = availableLods[0]; // fallback to lowest detail
    for (const { level, maxDistance } of LOD_THRESHOLDS) {
      if (distance <= maxDistance && lodUrls && lodUrls[String(level)]) {
        targetLod = level;
        break;
      }
    }

    // Only switch to the target if it's already loaded, otherwise use best loaded LOD
    if (targetLod !== currentLod) {
      if (loadedLods.has(targetLod)) {
        setCurrentLod(targetLod);
      } else {
        // Use the best (lowest number) loaded LOD that is still appropriate
        for (const lod of [...loadedLods].sort((a, b) => a - b)) {
          if (lod <= targetLod || lod === currentLod) {
            if (lod !== currentLod) setCurrentLod(lod);
            break;
          }
        }
      }
    }
  });

  // Preload the next-better LOD level in the background
  useEffect(() => {
    if (!hasLods) return;
    const nextBetter = availableLods.find(
      (l) => l < currentLod && !loadedLods.has(l)
    );
    if (nextBetter !== undefined) {
      const url = `${apiBase}/api/v1/buildings/${buildingId}/model/file?lod=${nextBetter}`;
      // useGLTF.preload triggers background fetch
      useGLTF.preload(url);
      // Mark as loaded after a short delay to let the cache populate
      const timer = setTimeout(() => {
        setLoadedLods((prev) => new Set([...prev, nextBetter]));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [currentLod, hasLods, availableLods, loadedLods, apiBase, buildingId]);

  // Mark initial LOD as loaded
  useEffect(() => {
    setLoadedLods((prev) => new Set([...prev, currentLod]));
  }, []);

  const modelUrl = `${apiBase}/api/v1/buildings/${buildingId}/model/file?lod=${currentLod}`;

  return (
    <group ref={groupRef}>
      <GLBModel
        url={modelUrl}
        isSelected={isSelected}
        isHovered={isHovered}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      />
    </group>
  );
}

/** Inner component that loads and renders a single GLB model. */
function GLBModel({
  url,
  isSelected,
  isHovered,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  url: string;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const { scene } = useGLTF(url);
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  // Apply selection/hover tint
  useEffect(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        if (isSelected) {
          mat.color.set('#3b82f6');
        } else if (isHovered) {
          mat.color.lerp(new THREE.Color('#60a5fa'), 0.3);
          mat.transparent = true;
          mat.opacity = 0.9;
        }
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [clonedScene, isSelected, isHovered]);

  return (
    <primitive
      object={clonedScene}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}

// =============================================================================
// Path B: Procedural Building Mesh (with roofs, windows, floor lines)
// =============================================================================

function ProceduralBuildingMesh({
  building,
  colorIndex,
  isSelected,
  isHovered,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  building: Building;
  colorIndex: number;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const height = building.height_meters || 10;
  const floors = building.floor_count || 3;
  const floorHeight = building.floor_height_meters || height / floors;
  const roofType = building.roof_type || 'flat';
  const width = 20;
  const depth = 15;

  const facadeMaterial = (building.specifications?.facade_material as string) || '';
  const defaultColor = MATERIAL_COLORS[facadeMaterial] || BUILDING_COLORS[colorIndex % BUILDING_COLORS.length];
  const baseColor = isSelected ? '#3b82f6' : isHovered ? '#60a5fa' : defaultColor;

  // Generate procedural texture for the facade material
  const facadeTexture = useMemo(() => {
    if (!facadeMaterial || isSelected || isHovered) return null;
    const tilesX = Math.max(1, Math.round(width / 5));
    const tilesY = Math.max(1, Math.round(height / 5));
    return getProceduralTexture(facadeMaterial, [tilesX, tilesY]);
  }, [facadeMaterial, width, height, isSelected, isHovered]);

  return (
    <group
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Main building body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={baseColor}
          map={facadeTexture}
          roughness={facadeMaterial === 'glass' ? 0.05 : facadeMaterial === 'metal' ? 0.35 : 0.7}
          metalness={facadeMaterial === 'glass' ? 0.9 : facadeMaterial === 'metal' ? 0.85 : 0.05}
          transparent={isHovered || facadeMaterial === 'glass'}
          opacity={facadeMaterial === 'glass' ? 0.6 : isHovered ? 0.9 : 1}
        />
      </mesh>

      {/* Floor line dividers */}
      {Array.from({ length: floors - 1 }, (_, i) => {
        const y = -height / 2 + (i + 1) * floorHeight;
        return (
          <mesh key={`floor-${i}`} position={[0, y, 0]}>
            <boxGeometry args={[width + 0.1, 0.08, depth + 0.1]} />
            <meshStandardMaterial color="#8b7d6b" roughness={0.9} />
          </mesh>
        );
      })}

      {/* Roof */}
      {roofType === 'gabled' && <GabledRoof width={width} depth={depth} height={height} />}
      {roofType === 'hipped' && <HippedRoof width={width} depth={depth} height={height} />}

      {/* Green roof overlay — vegetated surface on flat roofs */}
      {facadeMaterial === 'green_roof' && roofType === 'flat' && (
        <GreenRoofOverlay width={width} depth={depth} height={height} />
      )}

      {/* Procedural windows on all 4 facades */}
      <ProceduralWindows
        width={width}
        depth={depth}
        height={height}
        floors={floors}
        floorHeight={floorHeight}
      />

      {/* Front door */}
      <mesh position={[0, -height / 2 + 1.1, -depth / 2 - 0.02]}>
        <planeGeometry args={[1.2, 2.2]} />
        <meshStandardMaterial
          color="#5c3a1e"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Door frame */}
      <mesh position={[0, -height / 2 + 1.1, -depth / 2 - 0.01]}>
        <planeGeometry args={[1.35, 2.35]} />
        <meshStandardMaterial
          color="#3d2815"
          roughness={0.8}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Balconies on upper floors — front facade */}
      {floors > 1 &&
        Array.from({ length: floors - 1 }, (_, i) => {
          const floorIdx = i + 1;
          const z = -height / 2 + floorIdx * floorHeight;
          const balconyW = Math.min(2.5, width * 0.3);
          return (
            <group key={`balcony-${floorIdx}`}>
              {/* Slab */}
              <mesh position={[0, z, -depth / 2 - 0.6]} castShadow>
                <boxGeometry args={[balconyW, 0.15, 1.2]} />
                <meshStandardMaterial color="#b0a898" roughness={0.85} metalness={0.0} />
              </mesh>
              {/* Railing */}
              <mesh position={[0, z + 0.5, -depth / 2 - 1.2]}>
                <boxGeometry args={[balconyW, 1.0, 0.05]} />
                <meshStandardMaterial color="#888" roughness={0.6} metalness={0.3} />
              </mesh>
            </group>
          );
        })}

      {/* Cornice — decorative ledge at roofline */}
      {/* Front and back */}
      <mesh position={[0, height / 2 + 0.15, -depth / 2 - 0.1]}>
        <boxGeometry args={[width + 0.4, 0.3, 0.3]} />
        <meshStandardMaterial color="#c0b8ac" roughness={0.8} />
      </mesh>
      <mesh position={[0, height / 2 + 0.15, depth / 2 + 0.1]}>
        <boxGeometry args={[width + 0.4, 0.3, 0.3]} />
        <meshStandardMaterial color="#c0b8ac" roughness={0.8} />
      </mesh>
      {/* Left and right */}
      <mesh position={[-width / 2 - 0.1, height / 2 + 0.15, 0]}>
        <boxGeometry args={[0.3, 0.3, depth + 0.4]} />
        <meshStandardMaterial color="#c0b8ac" roughness={0.8} />
      </mesh>
      <mesh position={[width / 2 + 0.1, height / 2 + 0.15, 0]}>
        <boxGeometry args={[0.3, 0.3, depth + 0.4]} />
        <meshStandardMaterial color="#c0b8ac" roughness={0.8} />
      </mesh>
    </group>
  );
}

// =============================================================================
// Path C: Fallback (gray box)
// =============================================================================

function FallbackBuildingMesh({
  height,
  isSelected,
  isHovered,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  height: number;
  isSelected: boolean;
  isHovered: boolean;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  return (
    <mesh
      castShadow
      receiveShadow
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <boxGeometry args={[20, height, 15]} />
      <meshStandardMaterial
        color={isSelected ? '#3b82f6' : isHovered ? '#60a5fa' : '#94a3b8'}
        roughness={0.6}
        metalness={0.1}
        transparent={isHovered}
        opacity={isHovered ? 0.9 : 1}
      />
    </mesh>
  );
}

// =============================================================================
// Sub-components: Roofs
// =============================================================================

/** Green roof overlay — textured vegetation surface on top of flat roofs */
function GreenRoofOverlay({ width, depth, height }: { width: number; depth: number; height: number }) {
  const texture = useMemo(() => {
    const tilesX = Math.max(1, Math.round(width / 6));
    const tilesZ = Math.max(1, Math.round(depth / 6));
    return getProceduralTexture('green_roof', [tilesX, tilesZ]);
  }, [width, depth]);

  return (
    <group>
      {/* Vegetated surface slightly above roof */}
      <mesh position={[0, height / 2 + 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - 0.5, depth - 0.5]} />
        <meshStandardMaterial
          map={texture}
          color="#5a8a3a"
          roughness={0.95}
          metalness={0.0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Low parapet wall around edges */}
      <mesh position={[0, height / 2 + 0.25, -depth / 2]}>
        <boxGeometry args={[width, 0.5, 0.15]} />
        <meshStandardMaterial color="#a09888" roughness={0.9} />
      </mesh>
      <mesh position={[0, height / 2 + 0.25, depth / 2]}>
        <boxGeometry args={[width, 0.5, 0.15]} />
        <meshStandardMaterial color="#a09888" roughness={0.9} />
      </mesh>
      <mesh position={[-width / 2, height / 2 + 0.25, 0]}>
        <boxGeometry args={[0.15, 0.5, depth]} />
        <meshStandardMaterial color="#a09888" roughness={0.9} />
      </mesh>
      <mesh position={[width / 2, height / 2 + 0.25, 0]}>
        <boxGeometry args={[0.15, 0.5, depth]} />
        <meshStandardMaterial color="#a09888" roughness={0.9} />
      </mesh>
    </group>
  );
}

function GabledRoof({ width, depth, height }: { width: number; depth: number; height: number }) {
  const ridgeHeight = width * 0.25;
  const topY = height / 2;

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const hw = width / 2;
    const hd = depth / 2;

    // Ridge runs along the depth axis
    const vertices = new Float32Array([
      // Left slope
      -hw, topY, -hd,     0, topY + ridgeHeight, -hd,     -hw, topY, hd,
      0, topY + ridgeHeight, -hd,     0, topY + ridgeHeight, hd,     -hw, topY, hd,
      // Right slope
      hw, topY, -hd,     hw, topY, hd,     0, topY + ridgeHeight, -hd,
      0, topY + ridgeHeight, -hd,     hw, topY, hd,     0, topY + ridgeHeight, hd,
      // Front gable
      -hw, topY, -hd,     hw, topY, -hd,     0, topY + ridgeHeight, -hd,
      // Back gable
      -hw, topY, hd,     0, topY + ridgeHeight, hd,     hw, topY, hd,
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return geom;
  }, [width, depth, height, ridgeHeight, topY]);

  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color="#8b4513" roughness={0.8} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

function HippedRoof({ width, depth, height }: { width: number; depth: number; height: number }) {
  const ridgeHeight = width * 0.2;
  const topY = height / 2;

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const hw = width / 2;
    const hd = depth / 2;

    // Pyramid apex
    const vertices = new Float32Array([
      // Front face
      -hw, topY, -hd,     hw, topY, -hd,     0, topY + ridgeHeight, 0,
      // Right face
      hw, topY, -hd,     hw, topY, hd,     0, topY + ridgeHeight, 0,
      // Back face
      hw, topY, hd,     -hw, topY, hd,     0, topY + ridgeHeight, 0,
      // Left face
      -hw, topY, hd,     -hw, topY, -hd,     0, topY + ridgeHeight, 0,
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return geom;
  }, [width, depth, height, ridgeHeight, topY]);

  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color="#8b4513" roughness={0.8} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

// =============================================================================
// Sub-component: Procedural Windows
// =============================================================================

// =============================================================================
// Annotation System
// =============================================================================

function AnnotationClickPlane({
  onAnnotationClick,
}: {
  onAnnotationClick: (position: [number, number, number]) => void;
}) {
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onAnnotationClick([e.point.x, e.point.y, e.point.z]);
    },
    [onAnnotationClick]
  );

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.01, 0]}
      onClick={handleClick}
      visible={false}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial />
    </mesh>
  );
}

function AnnotationMarkers({
  annotations,
  onResolve,
  onDelete,
}: {
  annotations: AnnotationData[];
  onResolve?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      {annotations
        .filter((a) => !a.resolved)
        .map((ann) => (
          <group key={ann.id} position={[ann.position_x, ann.position_y, ann.position_z]}>
            {/* Pin marker */}
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                setExpandedId(expandedId === ann.id ? null : ann.id);
              }}
            >
              <sphereGeometry args={[0.6, 16, 16]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#f59e0b"
                emissiveIntensity={0.4}
              />
            </mesh>
            {/* Vertical stem */}
            <mesh position={[0, 1.5, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 3, 8]} />
              <meshStandardMaterial color="#f59e0b" />
            </mesh>

            {/* Tooltip / expanded card */}
            <Html position={[0, 3.5, 0]} center distanceFactor={80}>
              {expandedId === ann.id ? (
                <div
                  className="rounded-lg bg-white p-3 shadow-xl"
                  style={{ width: 200, pointerEvents: 'auto' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-gray-800">{ann.text}</p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {new Date(ann.created_at).toLocaleDateString()}
                  </p>
                  <div className="mt-2 flex gap-1">
                    {onResolve && (
                      <button
                        onClick={() => onResolve(ann.id)}
                        className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-200"
                      >
                        Resolve
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(ann.id)}
                        className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-pointer rounded-md bg-amber-500 px-2 py-1 text-[10px] font-medium text-white shadow-lg"
                  style={{ pointerEvents: 'auto', maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId(ann.id);
                  }}
                >
                  {ann.text}
                </div>
              )}
            </Html>
          </group>
        ))}
    </>
  );
}

// =============================================================================
// Sub-component: Procedural Windows
// =============================================================================

function ProceduralWindows({
  width,
  depth,
  height,
  floors,
  floorHeight,
}: {
  width: number;
  depth: number;
  height: number;
  floors: number;
  floorHeight: number;
}) {
  const winWidth = 1.2;
  const winHeight = 1.4;

  const windows = useMemo(() => {
    const result: { pos: [number, number, number]; rot: number; w: number; h: number }[] = [];
    const spacing = 3.5;

    // Front and back facades (along width)
    const nWidthWins = Math.max(1, Math.floor((width - 2) / spacing));
    // Left and right facades (along depth)
    const nDepthWins = Math.max(1, Math.floor((depth - 2) / spacing));

    for (let floor = 0; floor < floors; floor++) {
      const baseY = -height / 2 + floor * floorHeight + floorHeight * 0.45;

      // Front facade (z = -depth/2)
      for (let w = 0; w < nWidthWins; w++) {
        const x = -width / 2 + 1.5 + (w + 0.5) * ((width - 3) / nWidthWins);
        result.push({ pos: [x, baseY, -depth / 2 - 0.01], rot: 0, w: winWidth, h: winHeight });
      }
      // Back facade (z = depth/2)
      for (let w = 0; w < nWidthWins; w++) {
        const x = -width / 2 + 1.5 + (w + 0.5) * ((width - 3) / nWidthWins);
        result.push({ pos: [x, baseY, depth / 2 + 0.01], rot: Math.PI, w: winWidth, h: winHeight });
      }
      // Left facade (x = -width/2)
      for (let w = 0; w < nDepthWins; w++) {
        const z = -depth / 2 + 1.5 + (w + 0.5) * ((depth - 3) / nDepthWins);
        result.push({ pos: [-width / 2 - 0.01, baseY, z], rot: -Math.PI / 2, w: winWidth, h: winHeight });
      }
      // Right facade (x = width/2)
      for (let w = 0; w < nDepthWins; w++) {
        const z = -depth / 2 + 1.5 + (w + 0.5) * ((depth - 3) / nDepthWins);
        result.push({ pos: [width / 2 + 0.01, baseY, z], rot: Math.PI / 2, w: winWidth, h: winHeight });
      }
    }

    return result;
  }, [width, depth, height, floors, floorHeight]);

  return (
    <>
      {windows.map((win, i) => (
        <mesh
          key={i}
          position={win.pos}
          rotation={[0, win.rot, 0]}
        >
          <planeGeometry args={[win.w, win.h]} />
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

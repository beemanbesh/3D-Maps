// =============================================================================
// Core Types for the 3D Development Platform
// =============================================================================

export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface ConstructionPhase {
  phase_number: number;
  name: string;
  start_date?: string;
  end_date?: string;
  color?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  location?: Location;
  status: 'draft' | 'processing' | 'ready' | 'archived';
  construction_phases?: ConstructionPhase[];
  created_at: string;
  updated_at: string;
  owner_id: string;
  buildings?: Building[];
  documents?: Document[];
}

export interface Building {
  id: string;
  project_id: string;
  name?: string;
  height_meters?: number;
  floor_count?: number;
  floor_height_meters?: number;
  roof_type?: string;
  construction_phase?: number;
  model_url?: string;
  lod_urls?: Record<string, string>;
  specifications?: BuildingSpecifications;
  generation_status?: string;
  generation_prompt?: string;
  meshy_task_id?: string;
  created_at: string;
}

export interface BuildingSpecifications {
  total_area_sqm?: number;
  residential_units?: number;
  commercial_area_sqm?: number;
  ai_confidence?: number;
  [key: string]: unknown;
}

export interface Document {
  id: string;
  project_id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  uploaded_at: string;
  processed_at?: string;
}

export interface ProcessingStatus {
  job_id: string;
  status: string;
  progress?: number;
  message?: string;
  result?: Record<string, unknown>;
}

// =============================================================================
// Site Zone Types
// =============================================================================

export type SiteZoneType = 'building' | 'residential' | 'road' | 'green_space' | 'parking' | 'water' | 'development_area';

export interface SiteZoneProperties {
  height?: number;
  floors?: number;
  floor_height?: number;
  tree_density?: number;
  width?: number;
  [key: string]: unknown;
}

export interface SiteZone {
  id: string;
  project_id: string;
  name?: string;
  zone_type: SiteZoneType;
  coordinates: number[][]; // [[lng, lat], ...]
  color: string;
  properties?: SiteZoneProperties;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ZoneTypeConfig {
  label: string;
  color: string;
  icon: string;
  defaultProperties: SiteZoneProperties;
}

export const ZONE_TYPE_CONFIG: Record<SiteZoneType, ZoneTypeConfig> = {
  building: {
    label: 'Building',
    color: '#9b59b6',
    icon: 'B',
    defaultProperties: { height: 30, floors: 10, floor_height: 3 },
  },
  residential: {
    label: 'Residential',
    color: '#e91e8a',
    icon: 'R',
    defaultProperties: { height: 12, floors: 4, floor_height: 3 },
  },
  road: {
    label: 'Road',
    color: '#444444',
    icon: 'D',
    defaultProperties: { width: 10 },
  },
  green_space: {
    label: 'Green Space',
    color: '#27ae60',
    icon: 'G',
    defaultProperties: { tree_density: 0.3 },
  },
  parking: {
    label: 'Parking/Plaza',
    color: '#95a5a6',
    icon: 'P',
    defaultProperties: {},
  },
  water: {
    label: 'Water',
    color: '#3498db',
    icon: 'W',
    defaultProperties: {},
  },
  development_area: {
    label: 'Development Area',
    color: '#d4a574',
    icon: 'A',
    defaultProperties: { ground_texture: 'grass' },
  },
};

// =============================================================================
// API Request Types
// =============================================================================

export interface CreateProjectRequest {
  name: string;
  description?: string;
  location?: Location;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  location?: Location;
  status?: string;
}

export interface CreateBuildingRequest {
  name?: string;
  height_meters?: number;
  floor_count?: number;
  floor_height_meters?: number;
  roof_type?: string;
  construction_phase?: number;
  footprint_coordinates?: number[][];
  specifications?: Record<string, unknown>;
}

// =============================================================================
// 3D Viewer Types
// =============================================================================

export type MeasurementMode = 'distance' | 'area' | 'height' | 'angle';
export type MeasurementUnit = 'metric' | 'imperial';

export type CameraMode = 'orbit' | 'firstPerson' | 'flyThrough';

export type CameraPreset = 'aerial' | 'street' | 'corner' | 'front';

export interface CameraPresetConfig {
  position: [number, number, number];
  target: [number, number, number];
  label: string;
}

export interface ViewerSettings {
  cameraMode: CameraMode;
  showShadows: boolean;
  showGrid: boolean;
  showExistingBuildings: boolean;
  showLandscaping: boolean;
  showRoads: boolean;
  showMeasurements: boolean;
  sunTime: number; // 0-24
  sunDate: Date;
  mapLayer: 'none' | 'satellite' | 'streets' | 'terrain';
  quality: 'low' | 'medium' | 'high';
  showPerformance: boolean;
  showShadowStudy: boolean;
  activePhase: number | null; // null = show all phases
  moveSpeed: number; // multiplier: 0.25 (slow) to 3 (fast), default 1
}

export interface SceneObject {
  id: string;
  type: 'building' | 'terrain' | 'road' | 'vegetation' | 'context';
  name: string;
  modelUrl?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// AI Generation Types
// =============================================================================

export interface GenerationStatus {
  status: string;
  progress?: number;
  model_url?: string;
  error?: string;
  meshy_task_id?: string;
}

export interface AITemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
  thumbnail_url?: string;
}

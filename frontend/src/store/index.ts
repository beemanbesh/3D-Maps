import { create } from 'zustand';
import type { Project, Building, ViewerSettings, CameraMode, CameraPreset, CameraPresetConfig, MeasurementMode, MeasurementUnit, SiteZoneType } from '@/types';
import type { AuthUser } from '@/services/api';

// =============================================================================
// Auth Store
// =============================================================================

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, isAuthenticated: false });
  },
}));

// =============================================================================
// Project Store
// =============================================================================

interface ProjectState {
  projects: Project[];
  activeProject: Project | null;
  isLoading: boolean;
  error: string | null;
  setProjects: (projects: Project[]) => void;
  setActiveProject: (project: Project | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  isLoading: false,
  error: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (project) => set({ activeProject: project }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

// =============================================================================
// Viewer Store
// =============================================================================

const defaultViewerSettings: ViewerSettings = {
  cameraMode: 'orbit',
  showShadows: true,
  showGrid: true,
  showExistingBuildings: true,
  showLandscaping: true,
  showRoads: true,
  showMeasurements: false,
  sunTime: 12,
  sunDate: new Date(),
  mapLayer: 'none',
  quality: 'medium',
  showPerformance: false,
  showShadowStudy: false,
  activePhase: null,
  moveSpeed: 1,
};

export interface CameraKeyframe {
  time: number; // seconds from recording start
  position: [number, number, number];
  target: [number, number, number];
}

export interface Measurement {
  id: string;
  type: 'distance' | 'area' | 'height' | 'angle';
  points: [number, number, number][];
  distance: number; // meters for distance/height, m² for area
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraPresetConfig> = {
  aerial: { position: [0, 120, 0.1], target: [0, 0, 0], label: 'Aerial' },
  street: { position: [60, 5, 0], target: [0, 5, 0], label: 'Street' },
  corner: { position: [50, 50, 50], target: [0, 0, 0], label: '45°' },
  front: { position: [0, 20, 80], target: [0, 10, 0], label: 'Front' },
};

interface ViewerState {
  settings: ViewerSettings;
  selectedBuildingId: string | null;
  hoveredBuildingId: string | null;
  isInfoPanelOpen: boolean;
  measurements: Measurement[];
  pendingPoint: [number, number, number] | null;
  pendingPolygon: [number, number, number][];
  pendingAngle: [number, number, number][];
  measurementMode: MeasurementMode;
  measurementUnit: MeasurementUnit;
  cameraTarget: CameraPresetConfig | null;
  // Phase comparison mode
  isComparing: boolean;
  comparePhase: number | null;
  compareDivider: number; // 0-100, percentage from left
  setComparing: (enabled: boolean) => void;
  setComparePhase: (phase: number | null) => void;
  setCompareDivider: (pct: number) => void;
  // Camera path recording
  cameraPath: CameraKeyframe[];
  isRecording: boolean;
  isPlaying: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  addKeyframe: (position: [number, number, number], target: [number, number, number]) => void;
  startPlayback: () => void;
  stopPlayback: () => void;
  clearCameraPath: () => void;
  updateSettings: (partial: Partial<ViewerSettings>) => void;
  setCameraMode: (mode: CameraMode) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  setCameraTarget: (target: CameraPresetConfig) => void;
  clearCameraTarget: () => void;
  selectBuilding: (id: string | null) => void;
  hoverBuilding: (id: string | null) => void;
  toggleInfoPanel: () => void;
  setMeasurementMode: (mode: MeasurementMode) => void;
  setMeasurementUnit: (unit: MeasurementUnit) => void;
  addMeasurementPoint: (point: [number, number, number]) => void;
  addAreaPoint: (point: [number, number, number]) => void;
  closeAreaMeasurement: () => void;
  addHeightMeasurement: (base: [number, number, number], top: [number, number, number]) => void;
  addAnglePoint: (point: [number, number, number]) => void;
  clearMeasurements: () => void;
  // Annotation mode
  isAnnotating: boolean;
  setAnnotating: (enabled: boolean) => void;
  // Site planner mode
  isSitePlannerActive: boolean;
  activeSitePlannerTool: SiteZoneType | null;
  selectedZoneId: string | null;
  setSitePlannerActive: (enabled: boolean) => void;
  setActiveSitePlannerTool: (tool: SiteZoneType | null) => void;
  selectZone: (id: string | null) => void;
}

// Compute area of a 3D polygon projected onto the XZ plane (Shoelace formula)
function computePolygonArea(points: [number, number, number][]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][2]; // x_i * z_j
    area -= points[j][0] * points[i][2]; // x_j * z_i
  }
  return Math.abs(area) / 2;
}

export const useViewerStore = create<ViewerState>((set) => ({
  settings: defaultViewerSettings,
  selectedBuildingId: null,
  hoveredBuildingId: null,
  isInfoPanelOpen: false,
  measurements: [],
  pendingPoint: null,
  pendingPolygon: [],
  pendingAngle: [],
  measurementMode: 'distance',
  measurementUnit: 'metric',
  cameraTarget: null,
  isComparing: false,
  comparePhase: null,
  compareDivider: 50,
  setComparing: (enabled) => set({ isComparing: enabled }),
  setComparePhase: (phase) => set({ comparePhase: phase }),
  setCompareDivider: (pct) => set({ compareDivider: Math.max(5, Math.min(95, pct)) }),
  cameraPath: [],
  isRecording: false,
  isPlaying: false,
  startRecording: () => set({ isRecording: true, cameraPath: [], isPlaying: false }),
  stopRecording: () => set({ isRecording: false }),
  addKeyframe: (position, target) =>
    set((state) => {
      if (!state.isRecording) return {};
      const time = state.cameraPath.length === 0
        ? 0
        : Date.now() / 1000; // Will be normalized at stop
      return { cameraPath: [...state.cameraPath, { time, position, target }] };
    }),
  startPlayback: () => set({ isPlaying: true, isRecording: false }),
  stopPlayback: () => set({ isPlaying: false }),
  clearCameraPath: () => set({ cameraPath: [], isRecording: false, isPlaying: false }),
  updateSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  setCameraMode: (mode) =>
    set((state) => ({ settings: { ...state.settings, cameraMode: mode } })),
  setCameraPreset: (preset) =>
    set({ cameraTarget: CAMERA_PRESETS[preset] }),
  setCameraTarget: (target) => set({ cameraTarget: target }),
  clearCameraTarget: () => set({ cameraTarget: null }),
  selectBuilding: (id) => set({ selectedBuildingId: id, isInfoPanelOpen: !!id }),
  hoverBuilding: (id) => set({ hoveredBuildingId: id }),
  toggleInfoPanel: () => set((state) => ({ isInfoPanelOpen: !state.isInfoPanelOpen })),
  setMeasurementMode: (mode) => set({ measurementMode: mode, pendingPoint: null, pendingPolygon: [], pendingAngle: [] }),
  setMeasurementUnit: (unit) => set({ measurementUnit: unit }),
  addMeasurementPoint: (point) =>
    set((state) => {
      if (state.pendingPoint) {
        const dx = point[0] - state.pendingPoint[0];
        const dy = point[1] - state.pendingPoint[1];
        const dz = point[2] - state.pendingPoint[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return {
          pendingPoint: null,
          measurements: [
            ...state.measurements,
            {
              id: crypto.randomUUID(),
              type: 'distance',
              points: [state.pendingPoint, point],
              distance,
            },
          ],
        };
      }
      return { pendingPoint: point };
    }),
  addAreaPoint: (point) =>
    set((state) => ({
      pendingPolygon: [...state.pendingPolygon, point],
    })),
  closeAreaMeasurement: () =>
    set((state) => {
      if (state.pendingPolygon.length < 3) return { pendingPolygon: [] };
      const area = computePolygonArea(state.pendingPolygon);
      return {
        pendingPolygon: [],
        measurements: [
          ...state.measurements,
          {
            id: crypto.randomUUID(),
            type: 'area',
            points: state.pendingPolygon,
            distance: area, // area in m²
          },
        ],
      };
    }),
  addHeightMeasurement: (base, top) =>
    set((state) => {
      const height = Math.abs(top[1] - base[1]);
      return {
        measurements: [
          ...state.measurements,
          {
            id: crypto.randomUUID(),
            type: 'height',
            points: [base, top],
            distance: height,
          },
        ],
      };
    }),
  addAnglePoint: (point) =>
    set((state) => {
      const updated = [...state.pendingAngle, point];
      if (updated.length < 3) {
        return { pendingAngle: updated };
      }
      // 3 points collected: [rayStart, vertex, rayEnd]
      const [a, vertex, c] = updated;
      const va = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
      const vc = [c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]];
      const dot = va[0] * vc[0] + va[1] * vc[1] + va[2] * vc[2];
      const magA = Math.sqrt(va[0] ** 2 + va[1] ** 2 + va[2] ** 2);
      const magC = Math.sqrt(vc[0] ** 2 + vc[1] ** 2 + vc[2] ** 2);
      const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (magA * magC + 0.0001))));
      const angleDeg = (angleRad * 180) / Math.PI;
      return {
        pendingAngle: [],
        measurements: [
          ...state.measurements,
          {
            id: crypto.randomUUID(),
            type: 'angle' as const,
            points: updated as [number, number, number][],
            distance: angleDeg, // degrees
          },
        ],
      };
    }),
  clearMeasurements: () => set({ measurements: [], pendingPoint: null, pendingPolygon: [], pendingAngle: [] }),
  isAnnotating: false,
  setAnnotating: (enabled) => set({ isAnnotating: enabled }),
  // Site planner
  isSitePlannerActive: false,
  activeSitePlannerTool: null,
  selectedZoneId: null,
  setSitePlannerActive: (enabled) => set({ isSitePlannerActive: enabled, activeSitePlannerTool: enabled ? 'building' : null, selectedZoneId: null }),
  setActiveSitePlannerTool: (tool) => set({ activeSitePlannerTool: tool }),
  selectZone: (id) => set({ selectedZoneId: id }),
}));

// =============================================================================
// Upload Store
// =============================================================================

interface UploadFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

interface UploadState {
  files: UploadFile[];
  addFiles: (files: File[]) => void;
  updateFileStatus: (id: string, status: UploadFile['status'], progress?: number) => void;
  removeFile: (id: string) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  files: [],
  addFiles: (files) =>
    set((state) => ({
      files: [
        ...state.files,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          status: 'pending' as const,
          progress: 0,
        })),
      ],
    })),
  updateFileStatus: (id, status, progress) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, status, progress: progress ?? f.progress } : f
      ),
    })),
  removeFile: (id) => set((state) => ({ files: state.files.filter((f) => f.id !== id) })),
  clearCompleted: () =>
    set((state) => ({ files: state.files.filter((f) => f.status !== 'completed') })),
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './index';

// Reset store before each test
beforeEach(() => {
  useViewerStore.setState({
    settings: {
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
    },
    selectedBuildingId: null,
    hoveredBuildingId: null,
    isInfoPanelOpen: false,
    measurements: [],
    pendingPoint: null,
    pendingPolygon: [],
    measurementMode: 'distance',
    measurementUnit: 'metric',
    cameraPath: [],
    isRecording: false,
    isPlaying: false,
  });
});

describe('ViewerStore', () => {
  describe('settings', () => {
    it('has correct default settings', () => {
      const { settings } = useViewerStore.getState();
      expect(settings.cameraMode).toBe('orbit');
      expect(settings.showShadows).toBe(true);
      expect(settings.mapLayer).toBe('none');
      expect(settings.activePhase).toBeNull();
    });

    it('updates partial settings', () => {
      useViewerStore.getState().updateSettings({ showGrid: false, sunTime: 16 });
      const { settings } = useViewerStore.getState();
      expect(settings.showGrid).toBe(false);
      expect(settings.sunTime).toBe(16);
      // Other settings remain unchanged
      expect(settings.showShadows).toBe(true);
    });

    it('sets camera mode', () => {
      useViewerStore.getState().setCameraMode('firstPerson');
      expect(useViewerStore.getState().settings.cameraMode).toBe('firstPerson');
    });

    it('updates map layer', () => {
      useViewerStore.getState().updateSettings({ mapLayer: 'satellite' });
      expect(useViewerStore.getState().settings.mapLayer).toBe('satellite');
    });

    it('updates active phase', () => {
      useViewerStore.getState().updateSettings({ activePhase: 2 });
      expect(useViewerStore.getState().settings.activePhase).toBe(2);
    });
  });

  describe('building selection', () => {
    it('selects a building and opens info panel', () => {
      useViewerStore.getState().selectBuilding('building-1');
      const state = useViewerStore.getState();
      expect(state.selectedBuildingId).toBe('building-1');
      expect(state.isInfoPanelOpen).toBe(true);
    });

    it('deselects building when null is passed', () => {
      useViewerStore.getState().selectBuilding('building-1');
      useViewerStore.getState().selectBuilding(null);
      const state = useViewerStore.getState();
      expect(state.selectedBuildingId).toBeNull();
      expect(state.isInfoPanelOpen).toBe(false);
    });

    it('sets hovered building', () => {
      useViewerStore.getState().hoverBuilding('building-2');
      expect(useViewerStore.getState().hoveredBuildingId).toBe('building-2');
    });

    it('toggles info panel', () => {
      expect(useViewerStore.getState().isInfoPanelOpen).toBe(false);
      useViewerStore.getState().toggleInfoPanel();
      expect(useViewerStore.getState().isInfoPanelOpen).toBe(true);
      useViewerStore.getState().toggleInfoPanel();
      expect(useViewerStore.getState().isInfoPanelOpen).toBe(false);
    });
  });

  describe('measurements', () => {
    it('stores first point as pending', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      const state = useViewerStore.getState();
      expect(state.pendingPoint).toEqual([0, 0, 0]);
      expect(state.measurements).toHaveLength(0);
    });

    it('completes measurement on second point', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([3, 4, 0]);
      const state = useViewerStore.getState();
      expect(state.pendingPoint).toBeNull();
      expect(state.measurements).toHaveLength(1);
      expect(state.measurements[0].distance).toBe(5); // 3-4-5 triangle
    });

    it('calculates 3D distance correctly', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([1, 2, 2]);
      const distance = useViewerStore.getState().measurements[0].distance;
      expect(distance).toBe(3); // sqrt(1 + 4 + 4) = 3
    });

    it('clears all measurements', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([1, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([5, 5, 5]); // pending
      useViewerStore.getState().clearMeasurements();
      const state = useViewerStore.getState();
      expect(state.measurements).toHaveLength(0);
      expect(state.pendingPoint).toBeNull();
    });

    it('supports multiple measurements', () => {
      // First measurement
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([1, 0, 0]);
      // Second measurement
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([0, 10, 0]);

      const { measurements } = useViewerStore.getState();
      expect(measurements).toHaveLength(2);
      expect(measurements[0].distance).toBe(1);
      expect(measurements[1].distance).toBe(10);
    });

    it('creates distance measurement with type', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]);
      useViewerStore.getState().addMeasurementPoint([3, 4, 0]);
      expect(useViewerStore.getState().measurements[0].type).toBe('distance');
    });
  });

  describe('area measurements', () => {
    it('adds points to pending polygon', () => {
      useViewerStore.getState().addAreaPoint([0, 0, 0]);
      useViewerStore.getState().addAreaPoint([10, 0, 0]);
      expect(useViewerStore.getState().pendingPolygon).toHaveLength(2);
    });

    it('closes polygon and calculates area', () => {
      // 10x10 square on XZ plane → area = 100 m²
      useViewerStore.getState().addAreaPoint([0, 0, 0]);
      useViewerStore.getState().addAreaPoint([10, 0, 0]);
      useViewerStore.getState().addAreaPoint([10, 0, 10]);
      useViewerStore.getState().addAreaPoint([0, 0, 10]);
      useViewerStore.getState().closeAreaMeasurement();

      const state = useViewerStore.getState();
      expect(state.pendingPolygon).toHaveLength(0);
      expect(state.measurements).toHaveLength(1);
      expect(state.measurements[0].type).toBe('area');
      expect(state.measurements[0].distance).toBe(100); // 10*10 = 100 m²
      expect(state.measurements[0].points).toHaveLength(4);
    });

    it('requires at least 3 points to close polygon', () => {
      useViewerStore.getState().addAreaPoint([0, 0, 0]);
      useViewerStore.getState().addAreaPoint([10, 0, 0]);
      useViewerStore.getState().closeAreaMeasurement();

      const state = useViewerStore.getState();
      expect(state.pendingPolygon).toHaveLength(0);
      expect(state.measurements).toHaveLength(0);
    });
  });

  describe('height measurements', () => {
    it('creates height measurement from base and top', () => {
      useViewerStore.getState().addHeightMeasurement([5, 0, 5], [5, 15, 5]);
      const state = useViewerStore.getState();
      expect(state.measurements).toHaveLength(1);
      expect(state.measurements[0].type).toBe('height');
      expect(state.measurements[0].distance).toBe(15);
    });
  });

  describe('measurement mode and unit', () => {
    it('defaults to distance mode and metric unit', () => {
      const state = useViewerStore.getState();
      expect(state.measurementMode).toBe('distance');
      expect(state.measurementUnit).toBe('metric');
    });

    it('switches measurement mode and clears pending state', () => {
      useViewerStore.getState().addMeasurementPoint([0, 0, 0]); // pending point
      useViewerStore.getState().setMeasurementMode('area');
      const state = useViewerStore.getState();
      expect(state.measurementMode).toBe('area');
      expect(state.pendingPoint).toBeNull();
      expect(state.pendingPolygon).toHaveLength(0);
    });

    it('switches measurement unit', () => {
      useViewerStore.getState().setMeasurementUnit('imperial');
      expect(useViewerStore.getState().measurementUnit).toBe('imperial');
    });

    it('clear also resets pending polygon', () => {
      useViewerStore.getState().addAreaPoint([0, 0, 0]);
      useViewerStore.getState().addAreaPoint([10, 0, 0]);
      useViewerStore.getState().clearMeasurements();
      expect(useViewerStore.getState().pendingPolygon).toHaveLength(0);
    });
  });
});

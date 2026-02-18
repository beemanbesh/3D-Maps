import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useViewerStore } from '@/store';
import type { SiteZone } from '@/types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

const STYLE_URLS: Record<string, string> = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
};

// Meters per degree at equator
const METERS_PER_DEG_LAT = 111320;

// Meters per pixel at zoom level 0 at the equator (Web Mercator, 256px tiles)
const MAPBOX_METERS_PER_PIXEL_Z0 = 156543.03392;

interface MapboxBackgroundProps {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  /** Project latitude/longitude for geo-referencing the Three.js camera */
  projectLat?: number;
  projectLng?: number;
  /** Site zones to render as native Mapbox layers for perfect alignment */
  siteZones?: SiteZone[];
}

export function MapboxBackground({ center, zoom = 16, projectLat, projectLng, siteZones }: MapboxBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const { settings } = useViewerStore();

  // Derive center from project coordinates if available
  const mapCenter: [number, number] = center || (projectLng != null && projectLat != null ? [projectLng, projectLat] : [-73.985, 40.748]);

  // Store project origin for coordinate conversion
  const originRef = useRef({ lat: mapCenter[1], lng: mapCenter[0] });
  useEffect(() => {
    originRef.current = { lat: mapCenter[1], lng: mapCenter[0] };
  }, [mapCenter]);

  // =========================================================================
  // Site zone refs + builder (declared early so mapLayer effect can reference)
  // =========================================================================
  const siteZonesRef = useRef(siteZones);
  siteZonesRef.current = siteZones;
  const zoneSourceRef = useRef(false);

  // Build and add zone layers to the map
  const addZoneLayersToMap = useCallback((map: mapboxgl.Map, zones: SiteZone[]) => {
    // Remove existing zone layers first
    removeSiteZoneLayers(map);

    if (!zones.length) {
      zoneSourceRef.current = false;
      return;
    }

    // Convert zones to GeoJSON features
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extrudedFeatures: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fillFeatures: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roadFeatures: any[] = [];

    // Ground texture color mapping for development_area zones
    const GROUND_TEXTURE_COLORS: Record<string, string> = {
      grass: '#7cba3f',
      concrete: '#b0b0b0',
      gravel: '#a0958a',
      dirt: '#8b7355',
    };

    for (const zone of zones) {
      if (!zone.coordinates || zone.coordinates.length < 2) continue;

      if (zone.zone_type === 'road') {
        const coords = zone.coordinates;
        const n = coords.length;
        const half = Math.floor(n / 2);
        const centerline: number[][] = [];
        for (let i = 0; i < half; i++) {
          const opposite = n - 1 - i;
          if (opposite >= 0 && opposite < n) {
            centerline.push([
              (coords[i][0] + coords[opposite][0]) / 2,
              (coords[i][1] + coords[opposite][1]) / 2,
            ]);
          }
        }
        if (centerline.length >= 2) {
          roadFeatures.push({
            type: 'Feature',
            properties: {
              id: zone.id,
              width: zone.properties?.width || 10,
              color: zone.color || '#444444',
            },
            geometry: { type: 'LineString', coordinates: centerline },
          });
        }
      } else if (zone.zone_type === 'building' || zone.zone_type === 'residential') {
        const ring = zone.coordinates.map((c) => [c[0], c[1]]);
        if (ring.length >= 3) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        }
        extrudedFeatures.push({
          type: 'Feature',
          properties: {
            id: zone.id,
            height: zone.properties?.height || (zone.zone_type === 'building' ? 30 : 12),
            color: zone.color || (zone.zone_type === 'building' ? '#9b59b6' : '#e91e8a'),
            type: zone.zone_type,
          },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      } else {
        const ring = zone.coordinates.map((c) => [c[0], c[1]]);
        if (ring.length >= 3) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        }
        // Development area zones use ground texture for color
        let zoneColor = zone.color || '#95a5a6';
        if (zone.zone_type === 'development_area') {
          const texture = (zone.properties?.ground_texture as string) || 'grass';
          zoneColor = GROUND_TEXTURE_COLORS[texture] || GROUND_TEXTURE_COLORS.grass;
        }
        fillFeatures.push({
          type: 'Feature',
          properties: { id: zone.id, color: zoneColor, type: zone.zone_type },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    }

    try {
      if (extrudedFeatures.length > 0) {
        map.addSource('site-zones-extruded', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: extrudedFeatures },
        });
        map.addLayer({
          id: 'site-zones-extruded-layer',
          type: 'fill-extrusion',
          source: 'site-zones-extruded',
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.85,
          },
        });
      }

      if (fillFeatures.length > 0) {
        map.addSource('site-zones-fill', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: fillFeatures },
        });
        map.addLayer({
          id: 'site-zones-fill-layer',
          type: 'fill',
          source: 'site-zones-fill',
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.6 },
        });
        map.addLayer({
          id: 'site-zones-fill-outline',
          type: 'line',
          source: 'site-zones-fill',
          paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.9 },
        });
      }

      if (roadFeatures.length > 0) {
        map.addSource('site-zones-roads', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: roadFeatures },
        });
        map.addLayer({
          id: 'site-zones-road-surface',
          type: 'line',
          source: 'site-zones-roads',
          paint: { 'line-color': '#3a3a3a', 'line-width': ['get', 'width'], 'line-opacity': 0.9 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: 'site-zones-road-center',
          type: 'line',
          source: 'site-zones-roads',
          paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-dasharray': [4, 4], 'line-opacity': 0.8 },
        });
        map.addLayer(
          {
            id: 'site-zones-road-sidewalk',
            type: 'line',
            source: 'site-zones-roads',
            paint: { 'line-color': '#b0b0b0', 'line-width': ['+', ['get', 'width'], 4], 'line-opacity': 0.4 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          },
          'site-zones-road-surface',
        );
      }

      zoneSourceRef.current = true;
    } catch (err) {
      console.warn('Failed to add site zone layers:', err);
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE_URLS[settings.mapLayer] || STYLE_URLS.satellite,
      center: mapCenter,
      zoom,
      interactive: false, // Camera controlled by Three.js only
      attributionControl: false,
      pitch: settings.mapLayer === 'terrain' ? 60 : 0,
    });

    map.on('style.load', () => {
      if (settings.mapLayer === 'terrain' && map.getSource('mapbox-dem') === undefined) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }
      // Ensure site zone layers are added when style loads
      if (siteZonesRef.current?.length && !zoneSourceRef.current) {
        addZoneLayersToMap(map, siteZonesRef.current);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // React to mapLayer changes — skip on first mount (map was already created with correct style)
  const isFirstMount = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const styleUrl = STYLE_URLS[settings.mapLayer] || STYLE_URLS.satellite;
    map.setStyle(styleUrl);

    map.once('style.load', () => {
      if (settings.mapLayer === 'terrain') {
        if (map.getSource('mapbox-dem') === undefined) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      } else {
        map.setTerrain(null);
      }
      // Re-add site zone layers after style change (style change destroys all layers)
      zoneSourceRef.current = false;
      if (siteZonesRef.current?.length) {
        addZoneLayersToMap(map, siteZonesRef.current);
      }
    });
  }, [settings.mapLayer, addZoneLayersToMap]);

  /**
   * Sync the Mapbox camera with the Three.js camera via jumpTo.
   * Forces an immediate render to eliminate the 1-frame lag between
   * Three.js and Mapbox canvases.
   */
  const syncCamera = useCallback((detail: {
    groundX: number;
    groundZ: number;
    camY: number;
    metersPerPixel: number;
    bearing: number;
    pitch: number;
  }) => {
    const map = mapRef.current;
    if (!map) return;

    const origin = originRef.current;
    const latRad = (origin.lat * Math.PI) / 180;
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(latRad);

    // Convert Three.js ground look-at point to geographic coordinates (north = -Z)
    const lng = origin.lng + detail.groundX / metersPerDegLon;
    const lat = origin.lat - detail.groundZ / METERS_PER_DEG_LAT;

    // Derive Mapbox zoom from Three.js meters-per-pixel
    const cosLat = Math.cos(latRad);
    const mpp = Math.max(0.001, detail.metersPerPixel);
    const zoomLevel = Math.max(1, Math.min(22,
      Math.log2((MAPBOX_METERS_PER_PIXEL_Z0 * cosLat) / mpp),
    ));

    map.jumpTo({
      center: [lng, lat],
      zoom: zoomLevel,
      bearing: detail.bearing,
      pitch: detail.pitch,
    });

    // Force immediate render so map canvas updates in the same frame as Three.js
    try {
      (map as any)._render();
    } catch {
      // Fallback: _render is private and may not exist in all versions
    }
  }, []);

  // Expose syncCamera via a DOM event so SceneViewer can call it
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        syncCamera(detail);
      }
    };
    window.addEventListener('mapbox-sync-camera', handler);
    return () => window.removeEventListener('mapbox-sync-camera', handler);
  }, [syncCamera]);

  // Add zones when siteZones data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!siteZones?.length) {
      if (zoneSourceRef.current) {
        removeSiteZoneLayers(map);
        zoneSourceRef.current = false;
      }
      return;
    }

    if (map.isStyleLoaded()) {
      addZoneLayersToMap(map, siteZones);
    } else {
      map.once('style.load', () => addZoneLayersToMap(map, siteZones));
    }

    // Safety net: if zones still aren't added after 2s, retry
    const retryTimer = setTimeout(() => {
      if (!zoneSourceRef.current && map.isStyleLoaded() && siteZones.length) {
        addZoneLayersToMap(map, siteZones);
      }
    }, 2000);

    return () => {
      clearTimeout(retryTimer);
      try {
        if (zoneSourceRef.current && map.getStyle()) {
          removeSiteZoneLayers(map);
          zoneSourceRef.current = false;
        }
      } catch {
        // Map may already be destroyed
      }
    };
  }, [siteZones, addZoneLayersToMap]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-400 text-sm">
        Set VITE_MAPBOX_TOKEN to enable map background
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ zIndex: 0 }}
    />
  );
}

// =============================================================================
// Site Zone Layer Helpers
// =============================================================================

const SITE_ZONE_LAYER_IDS = [
  'site-zones-road-sidewalk',
  'site-zones-road-center',
  'site-zones-road-surface',
  'site-zones-fill-outline',
  'site-zones-fill-layer',
  'site-zones-extruded-layer',
];

const SITE_ZONE_SOURCE_IDS = [
  'site-zones-roads',
  'site-zones-fill',
  'site-zones-extruded',
];

function removeSiteZoneLayers(map: mapboxgl.Map) {
  for (const layerId of SITE_ZONE_LAYER_IDS) {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch { /* already removed */ }
  }
  for (const sourceId of SITE_ZONE_SOURCE_IDS) {
    try {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch { /* already removed */ }
  }
}


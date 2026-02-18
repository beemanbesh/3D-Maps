import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import type { SiteZone, SiteZoneProperties } from '@/types';
import { ZONE_TYPE_CONFIG } from '@/types';

interface ZonePropertiesPanelProps {
  zone: SiteZone;
  onUpdate: (zoneId: string, data: { name?: string; properties?: SiteZoneProperties }) => void;
  onDelete: (zoneId: string) => void;
  onClose: () => void;
}

export function ZonePropertiesPanel({ zone, onUpdate, onDelete, onClose }: ZonePropertiesPanelProps) {
  const config = ZONE_TYPE_CONFIG[zone.zone_type];
  const [name, setName] = useState(zone.name || '');
  const [props, setProps] = useState<SiteZoneProperties>(zone.properties || {});

  // Sync when zone changes
  useEffect(() => {
    setName(zone.name || '');
    setProps(zone.properties || {});
  }, [zone.id, zone.name, zone.properties]);

  const handleSave = () => {
    onUpdate(zone.id, {
      name: name || undefined,
      properties: props,
    });
  };

  // Compute approximate area from coordinates (in square meters)
  const area = computePolygonAreaM2(zone.coordinates);

  return (
    <div className="absolute right-4 top-16 z-20 w-72 rounded-xl bg-white/95 p-4 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded"
            style={{ backgroundColor: zone.color }}
          />
          <h3 className="text-sm font-semibold text-gray-900">{config?.label || zone.zone_type}</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 space-y-2.5 text-sm">
        {/* Name */}
        <div>
          <label className="block text-xs text-gray-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={config?.label || 'Zone'}
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
          />
        </div>

        {/* Area display */}
        <div className="flex justify-between">
          <span className="text-xs text-gray-500">Area</span>
          <span className="text-xs font-medium text-gray-700">
            {area >= 10000
              ? `${(area / 10000).toFixed(2)} ha`
              : `${Math.round(area).toLocaleString()} m\u00B2`}
          </span>
        </div>

        {/* Type-specific properties */}
        {(zone.zone_type === 'building' || zone.zone_type === 'residential') && (
          <>
            <div>
              <label className="block text-xs text-gray-500">Height (m)</label>
              <input
                type="number"
                step="1"
                value={props.height ?? config?.defaultProperties.height ?? ''}
                onChange={(e) => setProps((p) => ({ ...p, height: parseFloat(e.target.value) || undefined }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Floors</label>
              <input
                type="number"
                step="1"
                value={props.floors ?? config?.defaultProperties.floors ?? ''}
                onChange={(e) => setProps((p) => ({ ...p, floors: parseInt(e.target.value) || undefined }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Facade Material</label>
              <select
                value={(props.facade_material as string) || 'concrete'}
                onChange={(e) => setProps((p) => ({ ...p, facade_material: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="glass">Glass</option>
                <option value="brick">Brick</option>
                <option value="concrete">Concrete</option>
                <option value="stone">Stone</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500">Roof Style</label>
              <select
                value={(props.roof_style as string) || 'flat'}
                onChange={(e) => setProps((p) => ({ ...p, roof_style: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="flat">Flat</option>
                <option value="gabled">Gabled</option>
                <option value="hip">Hip</option>
              </select>
            </div>
          </>
        )}

        {zone.zone_type === 'residential' && (
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">Balconies</label>
            <input
              type="checkbox"
              checked={!!props.balconies}
              onChange={(e) => setProps((p) => ({ ...p, balconies: e.target.checked }))}
              className="rounded border-gray-300"
            />
          </div>
        )}

        {zone.zone_type === 'green_space' && (
          <>
            <div>
              <label className="block text-xs text-gray-500">Tree Density</label>
              <select
                value={(props.tree_density_level as string) || 'medium'}
                onChange={(e) => setProps((p) => ({ ...p, tree_density_level: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="sparse">Sparse</option>
                <option value="medium">Medium</option>
                <option value="dense">Dense</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500">Tree Density Value (0-1)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={props.tree_density ?? config?.defaultProperties.tree_density ?? 0.3}
                onChange={(e) => setProps((p) => ({ ...p, tree_density: parseFloat(e.target.value) || 0 }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Has Benches</label>
              <input
                type="checkbox"
                checked={!!props.has_benches}
                onChange={(e) => setProps((p) => ({ ...p, has_benches: e.target.checked }))}
                className="rounded border-gray-300"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Has Paths</label>
              <input
                type="checkbox"
                checked={!!props.has_paths}
                onChange={(e) => setProps((p) => ({ ...p, has_paths: e.target.checked }))}
                className="rounded border-gray-300"
              />
            </div>
          </>
        )}

        {zone.zone_type === 'road' && (
          <>
            <div>
              <label className="block text-xs text-gray-500">Width (m)</label>
              <input
                type="number"
                step="1"
                value={props.width ?? config?.defaultProperties.width ?? 10}
                onChange={(e) => setProps((p) => ({ ...p, width: parseFloat(e.target.value) || undefined }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Lane Count</label>
              <input
                type="number"
                step="1"
                min="1"
                max="6"
                value={(props.lane_count as number) ?? 2}
                onChange={(e) => setProps((p) => ({ ...p, lane_count: parseInt(e.target.value) || 2 }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Has Sidewalks</label>
              <input
                type="checkbox"
                checked={props.has_sidewalks !== false}
                onChange={(e) => setProps((p) => ({ ...p, has_sidewalks: e.target.checked }))}
                className="rounded border-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Road Surface</label>
              <select
                value={(props.road_surface as string) || 'asphalt'}
                onChange={(e) => setProps((p) => ({ ...p, road_surface: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="asphalt">Asphalt</option>
                <option value="cobblestone">Cobblestone</option>
              </select>
            </div>
          </>
        )}

        {zone.zone_type === 'parking' && (
          <>
            <div>
              <label className="block text-xs text-gray-500">Parking Layout</label>
              <select
                value={(props.parking_layout as string) || 'perpendicular'}
                onChange={(e) => setProps((p) => ({ ...p, parking_layout: e.target.value }))}
                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="angled">Angled</option>
                <option value="perpendicular">Perpendicular</option>
                <option value="parallel">Parallel</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Covered</label>
              <input
                type="checkbox"
                checked={!!props.covered}
                onChange={(e) => setProps((p) => ({ ...p, covered: e.target.checked }))}
                className="rounded border-gray-300"
              />
            </div>
          </>
        )}

        {zone.zone_type === 'water' && (
          <div>
            <label className="block text-xs text-gray-500">Water Type</label>
            <select
              value={(props.water_type as string) || 'pond'}
              onChange={(e) => setProps((p) => ({ ...p, water_type: e.target.value }))}
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
            >
              <option value="pond">Pond</option>
              <option value="stream">Stream</option>
              <option value="fountain">Fountain</option>
            </select>
          </div>
        )}

        {zone.zone_type === 'development_area' && (
          <div>
            <label className="block text-xs text-gray-500">Ground Texture</label>
            <select
              value={(props.ground_texture as string) || 'grass'}
              onChange={(e) => setProps((p) => ({ ...p, ground_texture: e.target.value }))}
              className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-sm"
            >
              <option value="grass">Grass</option>
              <option value="concrete">Concrete</option>
              <option value="gravel">Gravel</option>
              <option value="dirt">Dirt</option>
            </select>
          </div>
        )}

        <button
          onClick={handleSave}
          className="mt-1 w-full rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
        >
          Save Changes
        </button>

        <button
          onClick={() => onDelete(zone.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
        >
          <Trash2 size={12} />
          Delete Zone
        </button>
      </div>
    </div>
  );
}

/**
 * Compute area of a polygon given in [lng, lat] coordinates.
 * Uses the Shoelace formula projected to meters.
 */
function computePolygonAreaM2(coords: number[][]): number {
  if (coords.length < 3) return 0;

  // Approximate center for projection
  const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((centerLat * Math.PI) / 180);

  // Convert to meters
  const mCoords = coords.map((c) => [c[0] * metersPerDegLon, c[1] * metersPerDegLat]);

  // Shoelace
  let area = 0;
  for (let i = 0; i < mCoords.length; i++) {
    const j = (i + 1) % mCoords.length;
    area += mCoords[i][0] * mCoords[j][1];
    area -= mCoords[j][0] * mCoords[i][1];
  }
  return Math.abs(area) / 2;
}

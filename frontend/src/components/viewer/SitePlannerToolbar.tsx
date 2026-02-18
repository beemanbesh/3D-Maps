import { Eye } from 'lucide-react';
import type { SiteZoneType } from '@/types';
import { ZONE_TYPE_CONFIG } from '@/types';
import { useViewerStore } from '@/store';

const ZONE_TYPES: SiteZoneType[] = ['building', 'residential', 'road', 'green_space', 'parking', 'water', 'development_area'];

interface SitePlannerToolbarProps {
  onViewIn3D: () => void;
}

export function SitePlannerToolbar({ onViewIn3D }: SitePlannerToolbarProps) {
  const { activeSitePlannerTool, setActiveSitePlannerTool } = useViewerStore();

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-gray-900/90 px-3 py-2 shadow-2xl backdrop-blur-sm">
      {ZONE_TYPES.map((type) => {
        const config = ZONE_TYPE_CONFIG[type];
        const isActive = activeSitePlannerTool === type;
        return (
          <button
            key={type}
            onClick={() => setActiveSitePlannerTool(isActive ? null : type)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? 'bg-white/20 text-white ring-2 ring-white/40'
                : 'text-gray-300 hover:bg-white/10 hover:text-white'
            }`}
            title={`Draw ${config.label} zone`}
          >
            <span
              className="inline-block h-3 w-3 rounded-sm border border-white/30"
              style={{ backgroundColor: config.color }}
            />
            <span className="hidden sm:inline">{config.label}</span>
          </button>
        );
      })}

      <div className="mx-1 h-6 w-px bg-white/20" />

      <button
        onClick={onViewIn3D}
        className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
      >
        <Eye size={14} />
        View in 3D
      </button>
    </div>
  );
}

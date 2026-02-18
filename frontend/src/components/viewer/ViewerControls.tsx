import { useState } from 'react';
import { Sun, Layers, Ruler, TreePine, Building2, Route, Grid3x3, HardHat, Trash2, Settings, X, Video, ArrowUpDown, Move, Maximize, Circle, Square, Play, Pause, Activity, Triangle, SplitSquareVertical } from 'lucide-react';
import { useViewerStore, CAMERA_PRESETS } from '@/store';
import type { ConstructionPhase, CameraPreset, MeasurementMode } from '@/types';

interface ViewerControlsProps {
  constructionPhases?: ConstructionPhase[];
  buildings?: import('@/types').Building[];
}

export function ViewerControls({ constructionPhases, buildings }: ViewerControlsProps) {
  const { settings, updateSettings, setCameraMode, setCameraPreset, measurements, clearMeasurements, measurementMode, setMeasurementMode, measurementUnit, setMeasurementUnit, isRecording, isPlaying, cameraPath, startRecording, stopRecording, startPlayback, stopPlayback, clearCameraPath, isComparing, setComparing, comparePhase, setComparePhase } = useViewerStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const maxPhase = constructionPhases?.length
    ? Math.max(...constructionPhases.map((p) => p.phase_number))
    : 0;

  return (
    <>
      {/* Mobile toggle button — visible only on small screens */}
      <button
        onClick={() => setMobileOpen((v) => !v)}
        className="absolute left-4 top-16 z-20 rounded-lg bg-white/90 p-2.5 shadow-lg backdrop-blur-sm md:hidden"
        aria-label="Toggle controls"
      >
        {mobileOpen ? <X size={20} /> : <Settings size={20} />}
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Controls panel — hidden on mobile unless toggled */}
      <div
        className={`absolute left-4 top-16 z-10 flex max-h-[calc(100vh-5rem)] flex-col gap-2 overflow-y-auto md:top-16 ${
          mobileOpen ? 'top-28' : 'hidden md:flex'
        }`}
      >
        <div className="card !p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">Camera</h3>
          <div className="mb-2 flex flex-wrap gap-1">
            {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => setCameraPreset(preset)}
                className="rounded-md bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-primary-50 hover:text-primary-600"
              >
                {CAMERA_PRESETS[preset].label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['orbit', 'firstPerson', 'flyThrough'] as const).map((mode) => {
              const isTouchOnly = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches;
              const needsPointerLock = mode !== 'orbit';
              const disabled = isTouchOnly && needsPointerLock;
              return (
                <button
                  key={mode}
                  onClick={() => !disabled && setCameraMode(mode)}
                  disabled={disabled}
                  title={disabled ? 'Not available on touch devices' : undefined}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    disabled
                      ? 'cursor-not-allowed text-gray-300'
                      : settings.cameraMode === mode
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {mode === 'orbit' ? 'Orbit' : mode === 'firstPerson' ? 'Walk' : 'Fly'}
                </button>
              );
            })}
          </div>
          {/* Move Speed */}
          <div className="mt-2">
            <label className="text-[11px] text-gray-500">
              Speed: {settings.moveSpeed < 1 ? settings.moveSpeed.toFixed(2) : settings.moveSpeed.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={settings.moveSpeed}
              onChange={(e) => updateSettings({ moveSpeed: parseFloat(e.target.value) })}
              className="mt-0.5 w-full"
            />
            <div className="flex justify-between text-[9px] text-gray-400">
              <span>Slow</span>
              <span>Fast</span>
            </div>
          </div>
          {/* Camera Path Recording */}
          <div className="mt-2 flex items-center gap-1">
            {!isRecording && !isPlaying && (
              <button
                onClick={startRecording}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
                title="Record camera path"
              >
                <Circle size={10} className="fill-red-500 text-red-500" />
                Record
              </button>
            )}
            {isRecording && (
              <button
                onClick={stopRecording}
                className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600"
              >
                <Square size={10} />
                Stop ({Math.round(cameraPath.length * 0.1)}s)
              </button>
            )}
            {!isRecording && cameraPath.length > 0 && !isPlaying && (
              <button
                onClick={startPlayback}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-primary-50 hover:text-primary-600"
              >
                <Play size={10} />
                Play
              </button>
            )}
            {isPlaying && (
              <button
                onClick={stopPlayback}
                className="flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-[11px] font-medium text-primary-600"
              >
                <Pause size={10} />
                Pause
              </button>
            )}
            {!isRecording && cameraPath.length > 0 && !isPlaying && (
              <button
                onClick={clearCameraPath}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-red-500"
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        </div>
        <div className="card !p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">Layers</h3>
          <div className="flex flex-col gap-1.5">
            <Toggle icon={<Building2 size={14} />} label="Existing Buildings" active={settings.showExistingBuildings} onClick={() => updateSettings({ showExistingBuildings: !settings.showExistingBuildings })} />
            <Toggle icon={<TreePine size={14} />} label="Landscaping" active={settings.showLandscaping} onClick={() => updateSettings({ showLandscaping: !settings.showLandscaping })} />
            <Toggle icon={<Route size={14} />} label="Roads" active={settings.showRoads} onClick={() => updateSettings({ showRoads: !settings.showRoads })} />
            <Toggle icon={<Grid3x3 size={14} />} label="Grid" active={settings.showGrid} onClick={() => updateSettings({ showGrid: !settings.showGrid })} />
            <Toggle icon={<Ruler size={14} />} label="Measurements" active={settings.showMeasurements} onClick={() => updateSettings({ showMeasurements: !settings.showMeasurements })} />
          </div>
          {settings.showMeasurements && (
            <>
              <div className="mt-2 flex gap-1">
                {([
                  { mode: 'distance' as MeasurementMode, icon: <Move size={12} />, label: 'Dist' },
                  { mode: 'area' as MeasurementMode, icon: <Maximize size={12} />, label: 'Area' },
                  { mode: 'height' as MeasurementMode, icon: <ArrowUpDown size={12} />, label: 'Height' },
                  { mode: 'angle' as MeasurementMode, icon: <Triangle size={12} />, label: 'Angle' },
                ]).map(({ mode, icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setMeasurementMode(mode)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      measurementMode === mode
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  onClick={() => setMeasurementUnit(measurementUnit === 'metric' ? 'imperial' : 'metric')}
                  className="rounded-md bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-100"
                >
                  {measurementUnit === 'metric' ? 'm / m²' : 'ft / ft²'}
                </button>
                {measurements.length > 0 && (
                  <button
                    onClick={clearMeasurements}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={10} />
                    Clear ({measurements.length})
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-gray-400">
                {measurementMode === 'distance' && 'Click two points to measure distance'}
                {measurementMode === 'area' && 'Click 3+ points, then Enter to close'}
                {measurementMode === 'height' && 'Click a building to measure height'}
                {measurementMode === 'angle' && 'Click 3 points: start, vertex, end'}
              </p>
            </>
          )}
        </div>
        <div className="card !p-3">
          <Toggle icon={<Sun size={14} />} label="Shadows" active={settings.showShadows} onClick={() => updateSettings({ showShadows: !settings.showShadows })} />
          {settings.showShadows && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-xs text-gray-500">Time: {Math.floor(settings.sunTime)}:{String(Math.round((settings.sunTime % 1) * 60)).padStart(2, '0')}</label>
                <input type="range" min={6} max={20} step={0.5} value={settings.sunTime} onChange={(e) => updateSettings({ sunTime: parseFloat(e.target.value) })} className="mt-1 w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Date</label>
                <input
                  type="date"
                  value={settings.sunDate.toISOString().split('T')[0]}
                  onChange={(e) => {
                    const d = new Date(e.target.value + 'T12:00:00');
                    if (!isNaN(d.getTime())) updateSettings({ sunDate: d });
                  }}
                  className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary-400 focus:outline-none"
                />
              </div>
            </div>
          )}
          {settings.showShadows && (
            <Toggle icon={<Sun size={14} />} label="Shadow Study" active={settings.showShadowStudy} onClick={() => updateSettings({ showShadowStudy: !settings.showShadowStudy })} />
          )}
          <Toggle icon={<Activity size={14} />} label="FPS Monitor" active={settings.showPerformance} onClick={() => updateSettings({ showPerformance: !settings.showPerformance })} />
        </div>
        <div className="card !p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500"><Layers size={12} className="mr-1 inline" />Map</h3>
          <div className="flex flex-wrap gap-1">
            {(['none', 'satellite', 'streets', 'terrain'] as const).map((layer) => (
              <button key={layer} onClick={() => updateSettings({ mapLayer: layer })} className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${settings.mapLayer === layer ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                {layer === 'none' ? 'Off' : layer}
              </button>
            ))}
          </div>
        </div>
        {/* Construction Phasing Timeline */}
        {constructionPhases && constructionPhases.length > 0 && (
          <div className="card !p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              <HardHat size={12} className="mr-1 inline" />Phasing
            </h3>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => updateSettings({ activePhase: null })}
                className={`rounded-md px-2 py-1 text-left text-xs font-medium transition-colors ${
                  settings.activePhase === null
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                All Phases
              </button>
              {constructionPhases
                .sort((a, b) => a.phase_number - b.phase_number)
                .map((phase) => (
                  <button
                    key={phase.phase_number}
                    onClick={() => updateSettings({ activePhase: phase.phase_number })}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-medium transition-colors ${
                      settings.activePhase === phase.phase_number
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {phase.color && (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: phase.color }}
                      />
                    )}
                    {phase.name}
                  </button>
                ))}
            </div>
            {maxPhase > 1 && (
              <div className="mt-2">
                <input
                  type="range"
                  min={1}
                  max={maxPhase}
                  step={1}
                  value={settings.activePhase ?? maxPhase}
                  onChange={(e) => updateSettings({ activePhase: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
                  <span>Phase 1</span>
                  <span>Phase {maxPhase}</span>
                </div>
                {/* Compare mode */}
                <button
                  onClick={() => {
                    if (!isComparing) {
                      // Start comparing: set comparePhase to a different phase
                      const current = settings.activePhase ?? maxPhase;
                      const other = current > 1 ? current - 1 : current + 1;
                      setComparePhase(Math.min(other, maxPhase));
                      setComparing(true);
                    } else {
                      setComparing(false);
                    }
                  }}
                  className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    isComparing
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <SplitSquareVertical size={12} />
                  {isComparing ? 'Exit Compare' : 'Compare Phases'}
                </button>
                {isComparing && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                    <span className="text-gray-500">vs Phase</span>
                    <select
                      value={comparePhase ?? 1}
                      onChange={(e) => setComparePhase(parseInt(e.target.value))}
                      className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700"
                    >
                      {constructionPhases
                        .sort((a, b) => a.phase_number - b.phase_number)
                        .map((p) => (
                          <option key={p.phase_number} value={p.phase_number}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            {/* Phase metadata panel */}
            {settings.activePhase !== null && (() => {
              const phase = constructionPhases.find((p) => p.phase_number === settings.activePhase);
              const phaseBuildings = (buildings || []).filter(
                (b) => b.construction_phase === settings.activePhase
              );
              const cumulativeBuildings = (buildings || []).filter(
                (b) => b.construction_phase !== undefined && b.construction_phase !== null && b.construction_phase <= settings.activePhase!
              );
              const totalUnits = cumulativeBuildings.reduce(
                (sum, b) => sum + (b.specifications?.residential_units || 0), 0
              );
              return (
                <div className="mt-2 rounded-md bg-gray-50 p-2 text-[11px]">
                  <div className="font-medium text-gray-700">{phase?.name || `Phase ${settings.activePhase}`}</div>
                  {phase?.start_date && (
                    <div className="mt-0.5 text-gray-500">
                      {phase.start_date}{phase.end_date ? ` → ${phase.end_date}` : ''}
                    </div>
                  )}
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-500">
                    <span>This phase:</span>
                    <span className="font-medium text-gray-700">{phaseBuildings.length} building{phaseBuildings.length !== 1 ? 's' : ''}</span>
                    <span>Cumulative:</span>
                    <span className="font-medium text-gray-700">{cumulativeBuildings.length} building{cumulativeBuildings.length !== 1 ? 's' : ''}</span>
                    {totalUnits > 0 && (
                      <>
                        <span>Total units:</span>
                        <span className="font-medium text-gray-700">{totalUnits}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

function Toggle({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors ${active ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50'}`}>
      {icon}{label}
    </button>
  );
}

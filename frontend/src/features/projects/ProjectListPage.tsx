import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, FolderOpen, Clock, X, MapPin } from 'lucide-react';
import { projectsApi } from '@/services/api';
import type { Project, Location } from '@/types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

interface GeocodeSuggestion {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

export function ProjectListPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState('');
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced geocoding
  const geocodeAddress = useCallback((query: string) => {
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (!query.trim() || !MAPBOX_TOKEN) {
      setAddressSuggestions([]);
      return;
    }
    geocodeTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=address,place,locality,neighborhood`
        );
        const data = await res.json();
        if (data.features) {
          setAddressSuggestions(
            data.features.map((f: any) => ({ place_name: f.place_name, center: f.center }))
          );
          setShowSuggestions(true);
        }
      } catch {
        setAddressSuggestions([]);
      }
    }, 350);
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (location.pathname === '/projects/new') {
      setShowCreate(true);
    }
  }, [location.pathname]);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => projectsApi.create({
      name: newName,
      description: newDescription || undefined,
      location: selectedLocation || undefined,
    }),
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setAddressQuery('');
      setSelectedLocation(null);
      setError('');
      toast.success('Project created!');
      if (newProject?.id) {
        navigate(`/projects/${newProject.id}`);
      }
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail || 'Failed to create project. Check that the backend is running.');
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) {
      setError('Project name is required');
      return;
    }
    setError('');
    createMutation.mutate();
  };

  const handleCancel = () => {
    setShowCreate(false);
    setError('');
    if (location.pathname === '/projects/new') {
      navigate('/');
    }
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    processing: 'bg-yellow-100 text-yellow-700',
    ready: 'bg-green-100 text-green-700',
    archived: 'bg-blue-100 text-blue-700',
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your 3D development visualizations</p>
        </div>
        {!showCreate && (
          <button onClick={() => setShowCreate(true)} className="btn-primary self-start">
            <Plus size={16} className="mr-2" />
            New Project
          </button>
        )}
      </div>

      {showCreate && (
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Create New Project</h2>
            <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Name *</label>
              <input
                type="text"
                placeholder="e.g., Riverside Development Phase 1"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                placeholder="Brief description of the development project..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div className="relative" ref={suggestionsRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <div className="relative">
                <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder={MAPBOX_TOKEN ? 'Search for an address...' : 'Set VITE_MAPBOX_TOKEN to enable'}
                  value={addressQuery}
                  disabled={!MAPBOX_TOKEN}
                  onChange={(e) => {
                    setAddressQuery(e.target.value);
                    setSelectedLocation(null);
                    geocodeAddress(e.target.value);
                  }}
                  onFocus={() => addressSuggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              {showSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                  {addressSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 hover:text-primary-700 border-b border-gray-50 last:border-0"
                      onClick={() => {
                        setAddressQuery(s.place_name);
                        setSelectedLocation({
                          latitude: s.center[1],
                          longitude: s.center[0],
                          address: s.place_name,
                        });
                        setShowSuggestions(false);
                      }}
                    >
                      <MapPin size={12} className="inline mr-2 text-gray-400" />
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
              {selectedLocation && (
                <p className="mt-1 text-xs text-green-600">
                  {selectedLocation.latitude.toFixed(5)}, {selectedLocation.longitude.toFixed(5)}
                </p>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button onClick={handleCreate} disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Creating...' : 'Create Project'}
              </button>
              <button onClick={handleCancel} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 text-center text-gray-500">Loading projects...</div>
      ) : !projects?.length && !showCreate ? (
        <div className="mt-16 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No projects yet</h3>
          <p className="mt-2 text-sm text-gray-500">Create your first project to start visualizing developments in 3D.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-6 inline-flex">
            <Plus size={16} className="mr-2" />
            Create Project
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project: Project) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="card group transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-gray-900 group-hover:text-primary-600">{project.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[project.status]}`}>{project.status}</span>
              </div>
              {project.description && <p className="mt-2 line-clamp-2 text-sm text-gray-500">{project.description}</p>}
              {project.location?.address && (
                <div className="mt-2 flex items-center text-xs text-gray-400">
                  <MapPin size={11} className="mr-1 flex-shrink-0" />
                  <span className="truncate">{project.location.address}</span>
                </div>
              )}
              <div className="mt-4 flex items-center text-xs text-gray-400">
                <Clock size={12} className="mr-1" />
                Updated {new Date(project.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

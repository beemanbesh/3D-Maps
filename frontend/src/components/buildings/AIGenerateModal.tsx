import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Sparkles, Image, LayoutGrid, Type, Loader2, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { buildingsApi } from '@/services/api';
import type { AITemplate, GenerationStatus } from '@/types';

interface AIGenerateModalProps {
  buildingId: string;
  buildingName?: string;
  onClose: () => void;
  onComplete: () => void;
}

type TabId = 'templates' | 'text' | 'image';
type CategoryFilter = 'all' | 'commercial' | 'residential' | 'infrastructure' | 'landscaping';

export function AIGenerateModal({ buildingId, buildingName, onClose, onComplete }: AIGenerateModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('templates');
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<GenerationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Templates tab state
  const [templates, setTemplates] = useState<AITemplate[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<AITemplate | null>(null);
  const [templatePrompt, setTemplatePrompt] = useState('');

  // Text tab state
  const [textPrompt, setTextPrompt] = useState('');
  const [artStyle, setArtStyle] = useState('realistic');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [showNegative, setShowNegative] = useState(false);

  // Image tab state
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Load templates
  useEffect(() => {
    buildingsApi.getTemplates().then(setTemplates).catch(() => {});
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await buildingsApi.getGenerationStatus(buildingId);
        setGenStatus(status);
        if (status.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setGenerating(false);
          onComplete();
        } else if (status.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setGenerating(false);
          setError(status.error || 'Generation failed');
        }
      } catch {
        // Ignore poll errors
      }
    }, 5000);
  }, [buildingId, onComplete]);

  const handleGenerateText = useCallback(async (prompt: string) => {
    setError(null);
    setGenerating(true);
    setGenStatus({ status: 'generating', progress: 0 });
    try {
      await buildingsApi.generate(buildingId, prompt, artStyle, negativePrompt || undefined);
      startPolling();
    } catch (err) {
      setGenerating(false);
      setError(err instanceof Error ? err.message : 'Failed to start generation');
    }
  }, [buildingId, artStyle, negativePrompt, startPolling]);

  const handleGenerateImage = useCallback(async () => {
    if (!imageUrl.trim()) return;
    setError(null);
    setGenerating(true);
    setGenStatus({ status: 'generating', progress: 0 });
    try {
      await buildingsApi.generateFromImage(buildingId, imageUrl.trim());
      startPolling();
    } catch (err) {
      setGenerating(false);
      setError(err instanceof Error ? err.message : 'Failed to start generation');
    }
  }, [buildingId, imageUrl, startPolling]);

  const handleImageFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      setImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  const filteredTemplates = categoryFilter === 'all'
    ? templates
    : templates.filter((t) => t.category === categoryFilter);

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'templates', label: 'Templates', icon: <LayoutGrid size={14} /> },
    { id: 'text', label: 'Text to 3D', icon: <Type size={14} /> },
    { id: 'image', label: 'Image to 3D', icon: <Image size={14} /> },
  ];

  const CATEGORIES: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'commercial', label: 'Commercial' },
    { id: 'residential', label: 'Residential' },
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'landscaping', label: 'Landscaping' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-purple-500" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">AI 3D Generation</h2>
              <p className="text-xs text-gray-500">
                {buildingName ? `Generating for "${buildingName}"` : 'Generate a 3D model'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Generation in progress overlay */}
        {generating && (
          <div className="border-b border-blue-100 bg-blue-50 px-6 py-4">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-blue-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">
                  {genStatus?.progress != null && genStatus.progress > 50
                    ? 'Refining model...'
                    : 'Creating preview...'}
                </p>
                <p className="text-xs text-blue-600">
                  This typically takes 2-4 minutes. You can close this modal and check back later.
                </p>
              </div>
            </div>
            {genStatus?.progress != null && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-1000"
                  style={{ width: `${Math.max(genStatus.progress, 5)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Completed state */}
        {genStatus?.status === 'completed' && (
          <div className="border-b border-green-100 bg-green-50 px-6 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle size={20} className="text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">Model generated successfully!</p>
                <p className="text-xs text-green-600">The 3D model is now available in the viewer.</p>
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-6 py-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} className="text-red-600" />
              <div>
                <p className="text-sm font-medium text-red-800">Generation failed</p>
                <p className="text-xs text-red-600">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !generating && setActiveTab(tab.id)}
              disabled={generating}
              className={`flex flex-1 items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'border-b-2 border-purple-500 text-purple-700'
                  : 'text-gray-500 hover:text-gray-700'
              } disabled:opacity-50`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Templates Tab */}
          {activeTab === 'templates' && (
            <div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                      categoryFilter === cat.id
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplate(template);
                      setTemplatePrompt(template.prompt);
                    }}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      selectedTemplate?.id === template.id
                        ? 'border-purple-300 bg-purple-50 ring-2 ring-purple-200'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium capitalize text-gray-600">
                        {template.category}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{template.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{template.prompt}</p>
                  </button>
                ))}
              </div>

              {selectedTemplate && (
                <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <label className="mb-1 block text-xs font-medium text-purple-700">
                    Prompt (editable)
                  </label>
                  <textarea
                    value={templatePrompt}
                    onChange={(e) => setTemplatePrompt(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <button
                    onClick={() => handleGenerateText(templatePrompt)}
                    disabled={generating || !templatePrompt.trim()}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    <Sparkles size={14} />
                    {generating ? 'Generating...' : 'Generate 3D Model'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Text to 3D Tab */}
          {activeTab === 'text' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Prompt</label>
                <textarea
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  placeholder="Describe the 3D model you want to generate..."
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Art Style</label>
                <select
                  value={artStyle}
                  onChange={(e) => setArtStyle(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  <option value="realistic">Realistic</option>
                  <option value="cartoon">Cartoon</option>
                  <option value="low-poly">Low Poly</option>
                  <option value="sculpture">Sculpture</option>
                </select>
              </div>

              <div>
                <button
                  onClick={() => setShowNegative(!showNegative)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  {showNegative ? 'Hide' : 'Show'} negative prompt
                </button>
                {showNegative && (
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="What to avoid (e.g., blurry, low quality)..."
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                )}
              </div>

              <button
                onClick={() => handleGenerateText(textPrompt)}
                disabled={generating || !textPrompt.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Sparkles size={14} />
                {generating ? 'Generating...' : 'Generate 3D Model'}
              </button>
            </div>
          )}

          {/* Image to 3D Tab */}
          {activeTab === 'image' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Upload Image</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-6 transition-all hover:border-purple-400 hover:bg-purple-50">
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="max-h-40 rounded-lg object-contain" />
                  ) : (
                    <>
                      <Upload size={32} className="mb-2 text-gray-400" />
                      <p className="text-sm text-gray-500">Click to upload an image</p>
                      <p className="text-xs text-gray-400">PNG, JPG up to 10MB</p>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-2 text-xs text-gray-400">or</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Image URL</label>
                <input
                  type="url"
                  value={imageUrl.startsWith('data:') ? '' : imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setImagePreview(null);
                  }}
                  placeholder="https://example.com/building-photo.jpg"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <button
                onClick={handleGenerateImage}
                disabled={generating || !imageUrl.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Sparkles size={14} />
                {generating ? 'Generating...' : 'Generate from Image'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-3">
          <p className="text-center text-xs text-gray-400">
            Powered by Meshy.ai &middot; Generation typically takes 2-4 minutes
          </p>
        </div>
      </div>
    </div>
  );
}

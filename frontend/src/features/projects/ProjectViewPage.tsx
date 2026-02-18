import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Eye, Upload, Building2, FileText, Plus, Loader2, CheckCircle, AlertCircle, Clock, Image, FileSpreadsheet, Trash2, Share2, MapPin, FileDown, Sparkles } from 'lucide-react';
import { projectsApi, documentsApi, activityApi, buildingsApi } from '@/services/api';
import { AIGenerateModal } from '@/components/buildings/AIGenerateModal';
import { FileUpload } from '@/components/upload/FileUpload';
import { AddBuildingModal } from '@/components/buildings/AddBuildingModal';
import { ShareModal } from '@/components/sharing/ShareModal';
import type { Document } from '@/types';

export function ProjectViewPage() {
  const { id } = useParams<{ id: string }>();
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [aiGenerateBuildingId, setAiGenerateBuildingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const prevStatusMap = useRef<Record<string, string>>({});

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      // Auto-refresh every 3 seconds while any document is processing or building is generating
      const data = query.state.data;
      if (!data) return false;
      const hasProcessing = data.documents?.some(
        (d: Document) => d.processing_status === 'pending' || d.processing_status === 'processing'
      );
      const hasGenerating = data.buildings?.some(
        (b: { generation_status?: string }) => b.generation_status === 'generating'
      );
      return (hasProcessing || hasGenerating) ? 3000 : false;
    },
  });

  // Toast when document processing completes or fails
  useEffect(() => {
    if (!project?.documents) return;
    for (const doc of project.documents) {
      const prev = prevStatusMap.current[doc.id];
      if (prev && prev !== doc.processing_status) {
        if (doc.processing_status === 'completed') {
          toast.success(`"${doc.filename}" processed — buildings extracted`);
        } else if (doc.processing_status === 'failed') {
          toast.error(`"${doc.filename}" processing failed`);
        }
      }
      prevStatusMap.current[doc.id] = doc.processing_status;
    }
  }, [project?.documents]);

  const onUploadComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['project', id] });
    queryClient.invalidateQueries({ queryKey: ['activity', id] });
  }, [queryClient, id]);

  const { data: activityLog } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => activityApi.list(id!),
    enabled: !!id,
  });

  const processingDocCount = useMemo(() => {
    if (!project?.documents) return 0;
    return project.documents.filter(
      (d) => d.processing_status === 'pending' || d.processing_status === 'processing'
    ).length;
  }, [project?.documents]);

  if (isLoading) return <div className="text-center text-gray-500">Loading project...</div>;
  if (!project) return <div className="text-center text-gray-500">Project not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link to="/" className="rounded-lg p-2 hover:bg-gray-100">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">{project.name}</h1>
            {project.description && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-500">{project.description}</p>
            )}
            {project.location?.address && (
              <p className="mt-1 flex items-center text-xs text-gray-400">
                <MapPin size={11} className="mr-1 flex-shrink-0" />
                {project.location.address}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <a
            href={`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/v1/reports/projects/${id}/report`}
            className="btn-secondary shrink-0"
          >
            <FileDown size={16} className="mr-2" />
            PDF Report
          </a>
          <button
            onClick={() => setShowShare(true)}
            className="btn-secondary shrink-0"
          >
            <Share2 size={16} className="mr-2" />
            Share
          </button>
          <Link to={`/projects/${id}/viewer`} className="btn-primary shrink-0">
            <Eye size={16} className="mr-2" />
            Open 3D Viewer
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Document Upload */}
          <section className="card">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Upload size={20} />
              Upload Documents
            </h2>
            <div className="mt-4">
              <FileUpload projectId={project.id} onUploadComplete={onUploadComplete} />
            </div>
          </section>

          {/* Documents List */}
          {project.documents && project.documents.length > 0 && (
            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <FileText size={20} />
                  Documents
                  {processingDocCount > 0 && (
                    <span className="ml-2 flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      <Loader2 size={12} className="animate-spin" />
                      {processingDocCount} processing
                    </span>
                  )}
                </h2>
              </div>
              <div className="mt-4 space-y-2">
                {project.documents.map((doc) => (
                  <DocumentRow key={doc.id} document={doc} onDelete={onUploadComplete} />
                ))}
              </div>
            </section>
          )}

          {/* Buildings */}
          <section className="card">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                <Building2 size={20} />
                Buildings
              </h2>
              <button
                onClick={() => setShowAddBuilding(true)}
                className="flex items-center gap-1 rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100"
              >
                <Plus size={16} />
                Add Building
              </button>
            </div>
            {project.buildings?.length ? (
              <div className="mt-4 space-y-3">
                {project.buildings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                    <div>
                      <p className="font-medium text-gray-900">{b.name || 'Unnamed Building'}</p>
                      <p className="text-sm text-gray-500">
                        {b.floor_count && `${b.floor_count} floors`}
                        {b.height_meters && ` · ${b.height_meters}m tall`}
                        {b.roof_type && ` · ${b.roof_type} roof`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.model_url ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          3D Ready
                        </span>
                      ) : b.generation_status === 'generating' ? (
                        <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                          <Loader2 size={10} className="animate-spin" />
                          Generating...
                        </span>
                      ) : b.generation_status === 'failed' ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          Failed
                        </span>
                      ) : (
                        <button
                          onClick={() => setAiGenerateBuildingId(b.id)}
                          className="flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200"
                          title="Generate 3D model with AI"
                        >
                          <Sparkles size={10} />
                          Generate 3D
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${b.name || 'this building'}"? This cannot be undone.`)) {
                            buildingsApi.delete(b.id).then(() => {
                              queryClient.invalidateQueries({ queryKey: ['project', id] });
                              toast.success('Building deleted');
                            }).catch(() => {
                              toast.error('Failed to delete building');
                            });
                          }
                        }}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Delete building"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                No buildings yet. Upload documents or add buildings manually.
              </p>
            )}
          </section>

          {showAddBuilding && (
            <AddBuildingModal projectId={project.id} onClose={() => setShowAddBuilding(false)} />
          )}
          {showShare && (
            <ShareModal projectId={project.id} projectName={project.name} onClose={() => setShowShare(false)} />
          )}
          {aiGenerateBuildingId && (
            <AIGenerateModal
              buildingId={aiGenerateBuildingId}
              buildingName={project.buildings?.find((b) => b.id === aiGenerateBuildingId)?.name}
              onClose={() => setAiGenerateBuildingId(null)}
              onComplete={() => {
                queryClient.invalidateQueries({ queryKey: ['project', id] });
                setAiGenerateBuildingId(null);
              }}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold text-gray-900">Project Details</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd className="mt-0.5 font-medium capitalize text-gray-900">{project.status}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd className="mt-0.5 text-gray-900">
                  {new Date(project.created_at).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Last Updated</dt>
                <dd className="mt-0.5 text-gray-900">
                  {new Date(project.updated_at).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Buildings</dt>
                <dd className="mt-0.5 text-gray-900">{project.buildings?.length || 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Documents</dt>
                <dd className="mt-0.5 text-gray-900">{project.documents?.length || 0}</dd>
              </div>
            </dl>
          </div>

          {/* Activity Feed */}
          {activityLog && activityLog.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900">Recent Activity</h3>
              <ul className="mt-3 space-y-2">
                {activityLog.slice(0, 10).map((entry) => {
                  const actionLabels: Record<string, string> = {
                    document_uploaded: 'uploaded a document',
                    building_created: 'added a building',
                    annotation_created: 'added an annotation',
                    building_updated: 'updated a building',
                  };
                  const label = actionLabels[entry.action] || entry.action.replace(/_/g, ' ');
                  const name = entry.user_name || entry.user_email?.split('@')[0] || 'System';
                  const timeAgo = formatTimeAgo(entry.created_at);
                  return (
                    <li key={entry.id} className="flex items-start gap-2 text-xs text-gray-600">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" />
                      <span>
                        <span className="font-medium text-gray-800">{name}</span>{' '}
                        {label}
                        {entry.details?.filename && (
                          <span className="text-gray-400"> ({entry.details.filename as string})</span>
                        )}
                        {entry.details?.name && (
                          <span className="text-gray-400"> ({entry.details.name as string})</span>
                        )}
                        <span className="ml-1 text-gray-400">{timeAgo}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DocumentRow({ document: doc, onDelete }: { document: Document; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const statusConfig = {
    pending: { icon: <Clock size={14} />, color: 'text-amber-600 bg-amber-50', label: 'Pending' },
    processing: { icon: <Loader2 size={14} className="animate-spin" />, color: 'text-blue-600 bg-blue-50', label: 'Processing' },
    completed: { icon: <CheckCircle size={14} />, color: 'text-green-600 bg-green-50', label: 'Completed' },
    failed: { icon: <AlertCircle size={14} />, color: 'text-red-600 bg-red-50', label: 'Failed' },
  };

  const status = statusConfig[doc.processing_status] || statusConfig.pending;

  const getFileIcon = () => {
    const ext = doc.file_type.toLowerCase();
    if (ext === 'pdf') return <FileText size={16} className="text-red-500" />;
    if (['jpg', 'jpeg', 'png', 'tiff'].includes(ext)) return <Image size={16} className="text-green-500" />;
    if (['csv', 'xlsx'].includes(ext)) return <FileSpreadsheet size={16} className="text-blue-500" />;
    return <FileText size={16} className="text-gray-500" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await documentsApi.delete(doc.id);
      toast.success(`"${doc.filename}" deleted`);
      onDelete();
    } catch {
      toast.error('Failed to delete document');
      setDeleting(false);
    }
  };

  const isProcessing = doc.processing_status === 'processing' || doc.processing_status === 'pending';

  return (
    <div className="group rounded-lg border border-gray-100 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        {getFileIcon()}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-gray-700">{doc.filename}</p>
          <p className="text-xs text-gray-500">
            {formatSize(doc.file_size_bytes)} · {doc.file_type.toUpperCase()}
            {doc.processed_at && ` · Processed ${new Date(doc.processed_at).toLocaleDateString()}`}
          </p>
        </div>
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
          {status.icon}
          {status.label}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="ml-1 rounded-md p-1 text-gray-400 opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-50"
          title="Delete document"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
      {isProcessing && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 animate-[shimmer_1.5s_ease-in-out_infinite]"
              style={{
                width: doc.processing_status === 'pending' ? '30%' : '70%',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s ease-in-out infinite',
              }}
            />
          </div>
          <p className="mt-1 text-[10px] text-gray-400">
            {doc.processing_status === 'pending' ? 'Queued for processing...' : 'Extracting data and generating 3D models...'}
          </p>
        </div>
      )}
    </div>
  );
}

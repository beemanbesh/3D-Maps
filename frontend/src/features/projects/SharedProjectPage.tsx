import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Eye, Loader2 } from 'lucide-react';
import { sharesApi } from '@/services/api';

export function SharedProjectPage() {
  const { token } = useParams<{ token: string }>();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['shared-project', token],
    queryFn: () => sharesApi.getSharedProject(token!),
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 size={32} className="animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <h1 className="text-xl font-bold text-gray-900">Link expired or invalid</h1>
        <p className="mt-2 text-sm text-gray-500">This share link may have been revoked.</p>
        <Link to="/" className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-500">
          Go to home page
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <Box className="h-7 w-7 text-primary-600" />
            <span className="text-lg font-bold text-gray-900">3D Dev Platform</span>
          </Link>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            Shared view
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{project.name}</h1>
            {project.description && (
              <p className="mt-1 text-sm text-gray-500">{project.description}</p>
            )}
          </div>
          <Link
            to={`/projects/${project.id}/viewer`}
            className="btn-primary shrink-0 self-start sm:self-auto"
          >
            <Eye size={16} className="mr-2" />
            Open 3D Viewer
          </Link>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="card">
            <h3 className="font-semibold text-gray-900">Project Info</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd className="capitalize text-gray-900">{project.status}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Buildings</dt>
                <dd className="text-gray-900">{project.buildings?.length || 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Documents</dt>
                <dd className="text-gray-900">{project.documents?.length || 0}</dd>
              </div>
            </dl>
          </div>

          {project.buildings && project.buildings.length > 0 && (
            <div className="card sm:col-span-2">
              <h3 className="font-semibold text-gray-900">Buildings</h3>
              <div className="mt-3 space-y-2">
                {project.buildings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <p className="text-sm font-medium text-gray-700">{b.name || 'Unnamed Building'}</p>
                    <span className="text-xs text-gray-500">
                      {b.floor_count && `${b.floor_count} floors`}
                      {b.height_meters && ` · ${b.height_meters}m`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

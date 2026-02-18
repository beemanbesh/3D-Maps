import { Link } from 'react-router-dom';
import { Clock, MapPin } from 'lucide-react';
import type { Project } from '@/types';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  processing: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  archived: 'bg-blue-100 text-blue-700',
};

export interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="card group transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-gray-900 group-hover:text-primary-600">
          {project.name}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[project.status]}`}
        >
          {project.status}
        </span>
      </div>
      {project.description && (
        <p className="mt-2 line-clamp-2 text-sm text-gray-500">
          {project.description}
        </p>
      )}
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
  );
}

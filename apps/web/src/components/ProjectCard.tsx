import { Link } from 'react-router-dom';
import type { ProjectCardRow } from '@lib/project-types';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_CLASSES: Record<string, string> = {
  active: 'badge-success',
  paused: 'badge-warning',
  completed: 'badge-info',
  archived: 'badge-muted',
};

export default function ProjectCard({ project }: { project: ProjectCardRow }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold" style={{ margin: 0 }}>{project.name}</h3>
        <span className={`badge ${STATUS_CLASSES[project.status] ?? 'badge-muted'}`}>
          {STATUS_LABELS[project.status] ?? project.status}
        </span>
      </div>
      {project.description && (
        <p className="text-sm text-muted mb-2" style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {project.description}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{project.task_count ?? 0} tasks</span>
        <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

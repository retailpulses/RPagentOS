import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectList } from '../hooks/useProjects';
import ProjectCard from '../components/ProjectCard';
import type { ProjectStatus } from '@lib/project-types';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export default function ProjectList() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: projects, loading, error } = useProjectList(
    statusFilter ? { status: statusFilter } : undefined,
  );

  const activeCount = projects.filter(p => p.status === 'active').length;

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div>
          <h2>Projects</h2>
          <p className="text-sm text-muted">
            {activeCount} active, {projects.length} total
          </p>
        </div>
        <Link to="/projects/new" className="btn btn-primary">
          + New Project
        </Link>
      </div>

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : ''}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-muted">Loading projects...</p>}
      {error && <p style={{ color: 'var(--color-urgent)' }}>{error}</p>}

      {!loading && !error && projects.length === 0 && (
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-muted mb-3">No projects yet.</p>
          <Link to="/projects/new" className="btn btn-primary">
            Create your first project
          </Link>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {projects.map(p => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

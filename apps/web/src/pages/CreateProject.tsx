import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateProject } from '../hooks/useProjects';

export default function CreateProject() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { create, loading, error } = useCreateProject();
  const [name, setName] = useState(searchParams.get('name') ?? '');
  const [description, setDescription] = useState(searchParams.get('description') ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const result = await create({
      name: name.trim(),
      description: description.trim() || undefined,
      metadata: searchParams.get('source') ? {
        source: searchParams.get('source'),
        platform: searchParams.get('platform'),
        shop_code: searchParams.get('shop_code'),
        metric_period: searchParams.get('period'),
        metric_signal: searchParams.get('signal'),
      } : undefined,
    });

    if (result) {
      navigate(`/projects/${result.id}`);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2>New Project</h2>

      <form onSubmit={handleSubmit} className="card flex flex-col gap-4" style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label>Project Name *</label>
          <input
            required
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Q3 Product Catalog Refresh"
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What is this project about?"
            rows={4}
          />
        </div>

        {error && <p style={{ color: 'var(--color-urgent)' }} className="text-sm">{error}</p>}

        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create Project'}
          </button>
          <button className="btn" type="button" onClick={() => navigate('/projects')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

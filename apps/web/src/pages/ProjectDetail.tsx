import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectDetail, useUpdateProject, useAddProjectAttachment, useRemoveProjectAttachment } from '../hooks/useProjects';
import TaskCard from '../components/TaskCard';
import type { ProjectStatus } from '@lib/project-types';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useProjectDetail(id);
  const { update: updateProject, loading: saving, error: saveError } = useUpdateProject();
  const { add: addAttachment, loading: uploading, error: uploadError } = useAddProjectAttachment();
  const { remove: removeAttachment, error: removeError } = useRemoveProjectAttachment();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [localUploadError, setLocalUploadError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const startEditing = () => {
    if (!data) return;
    setEditName(data.project.name);
    setEditDescription(data.project.description ?? '');
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !editName.trim()) return;
    const result = await updateProject(id, {
      name: editName.trim(),
      description: editDescription.trim() || null,
    });
    if (result) {
      setEditing(false);
      refetch();
    }
  };

  const handleStatusChange = async (status: ProjectStatus) => {
    if (!id) return;
    const result = await updateProject(id, { status });
    if (result) refetch();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setLocalUploadError(null);
    if (!id || !file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setLocalUploadError('Attachment must be 5 MB or smaller.');
      return;
    }

    const fileDataUrl = await readFileAsDataUrl(file);
    const result = await addAttachment(id, {
      file_name: file.name,
      content_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      file_data_url: fileDataUrl,
      uploaded_by: 'jim',
      description: attachmentNote.trim() || undefined,
    });

    if (result) {
      setAttachmentNote('');
      refetch();
    }
  };

  const handleRemoveAttachment = async (attachmentId: string, fileName: string) => {
    if (!window.confirm(`Remove attachment "${fileName}"?`)) return;
    setRemovingId(attachmentId);
    const removed = await removeAttachment(attachmentId);
    setRemovingId(null);
    if (removed) refetch();
  };

  if (loading) return <p className="text-muted">Loading project...</p>;
  if (error) return <p style={{ color: 'var(--color-urgent)' }}>{error}</p>;
  if (!data) return <p className="text-muted">Project not found.</p>;

  const { project, attachments, tasks } = data;

  return (
    <div style={{ maxWidth: 900 }}>
      <Link
        to="/projects"
        className="text-sm text-muted"
        style={{ display: 'inline-block', marginBottom: '1rem' }}
      >
        {'<-'} Back to Projects
      </Link>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <h2>{project.name}</h2>
          <div className="flex items-center gap-2" style={{ marginTop: '0.25rem' }}>
            <span className={`badge ${STATUS_CLASSES[project.status] ?? 'badge-muted'}`}>
              {STATUS_LABELS[project.status] ?? project.status}
            </span>
            <span className="text-xs text-muted">
              {tasks.length} tasks &middot; Updated {new Date(project.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        {!editing && (
          <button className="btn btn-primary" onClick={startEditing}>Edit</button>
        )}
      </div>

      {/* Status change buttons */}
      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        {(['active', 'paused', 'completed', 'archived'] as ProjectStatus[])
          .filter(s => s !== project.status)
          .map(s => (
            <button
              key={s}
              className="btn btn-sm"
              onClick={() => handleStatusChange(s)}
            >
              Mark {STATUS_LABELS[s]}
            </button>
          ))}
      </div>

      {/* Edit form */}
      {editing && (
        <form onSubmit={handleSave} className="card flex flex-col gap-4 mb-4">
          <div className="form-group">
            <label>Project Name *</label>
            <input
              required
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={4}
            />
          </div>
          {saveError && <p style={{ color: 'var(--color-urgent)' }} className="text-sm">{saveError}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={saving || !editName.trim()}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-4">
        {/* Description */}
        <section className="card">
          <h3 className="font-semibold mb-2 text-sm">Description</h3>
          {project.description ? (
            <p style={{ whiteSpace: 'pre-wrap' }} className="text-sm">{project.description}</p>
          ) : (
            <p className="text-sm text-muted">No description yet.</p>
          )}
        </section>

        {/* Attachments */}
        <section className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Attachments ({attachments.length})</h3>
            <label className="btn btn-sm">
              {uploading ? 'Uploading...' : 'Upload File'}
              <input
                type="file"
                accept="image/*,.csv,text/csv,application/pdf,text/plain"
                onChange={handleFileUpload}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          <div className="form-group mb-2">
            <label>Attachment Note</label>
            <input
              value={attachmentNote}
              onChange={e => setAttachmentNote(e.target.value)}
              placeholder="Optional context for the next uploaded file"
            />
          </div>
          {(localUploadError || uploadError || removeError) && (
            <p style={{ color: 'var(--color-urgent)' }} className="text-sm mb-2">
              {localUploadError || uploadError || removeError}
            </p>
          )}
          {attachments.length === 0 ? (
            <p className="text-sm text-muted">No attachments.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {attachments.map(att => (
                <div
                  key={att.id}
                  className="flex items-center justify-between"
                  style={{
                    padding: '0.5rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div className="flex items-center gap-2" style={{ overflow: 'hidden' }}>
                    <span className="text-sm" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {att.file_name}
                    </span>
                    <span className="text-xs text-muted">
                      ({(att.file_size_bytes / 1024).toFixed(0)} KB)
                    </span>
                    {att.description && (
                      <span className="text-xs text-muted">- {att.description}</span>
                    )}
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ color: 'var(--color-urgent)' }}
                    onClick={() => handleRemoveAttachment(att.id, att.file_name)}
                    disabled={removingId === att.id}
                  >
                    {removingId === att.id ? '...' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tasks */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Tasks ({tasks.length})</h3>
            <Link to={`/task/new?project_id=${project.id}`} className="btn btn-sm btn-primary">
              + Add Task
            </Link>
          </div>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted">No tasks in this project yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

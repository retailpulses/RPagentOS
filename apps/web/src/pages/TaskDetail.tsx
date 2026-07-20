import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAddTaskAttachment, useRemoveTaskAttachment, useTaskDetail, useTaskSelectOptions, useUpdateTask, useUpdateTaskStatus } from '../hooks/useTasks'
import { useProjectOptions } from '../hooks/useProjects'
import StatusBadge from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import TaskTargets from '../components/TaskTargets'
import TaskSteps from '../components/TaskSteps'
import TaskActivity from '../components/TaskActivity'
import TaskAttachments from '../components/TaskAttachments'
import type { OwnerKey, OwnerType, TaskAttachmentRow, TaskPriority, TaskSource, TaskStatus, TaskType } from '@lib/task-types'

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, error, refetch } = useTaskDetail(id)
  const { update: updateStatus } = useUpdateTaskStatus()
  const { update: updateTask, loading: saving, error: saveError } = useUpdateTask()
  const { add: addAttachment, loading: uploading, error: uploadError } = useAddTaskAttachment()
  const { remove: removeAttachment, error: removeError } = useRemoveTaskAttachment()
  const taskTypeOptions = useTaskSelectOptions('task_type')
  const priorityOptions = useTaskSelectOptions('priority')
  const ownerTypeOptions = useTaskSelectOptions('owner_type')
  const ownerKeyOptions = useTaskSelectOptions('owner_key')
  const sourceOptions = useTaskSelectOptions('source')
  const platformOptions = useTaskSelectOptions('platform')
  const shopCodeOptions = useTaskSelectOptions('shop_code')
  const projectOptions = useProjectOptions()
  const [attachmentDescription, setAttachmentDescription] = useState('')
  const [localUploadError, setLocalUploadError] = useState<string | null>(null)
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    task_type: 'listing' as TaskType,
    priority: 'medium' as TaskPriority,
    platform: '',
    shop_code: '',
    owner_type: '' as OwnerType | '',
    owner_key: '' as OwnerKey | '',
    due_date: '',
    scheduled_start_at: '',
    source: 'manual' as TaskSource,
    approval_required: false,
    execution_brief: '',
    project_id: '',
  })

  const startEditing = () => {
    if (!data) return
    const { task } = data
    setEditForm({
      title: task.title,
      description: task.description ?? '',
      task_type: task.task_type,
      priority: task.priority,
      platform: task.platform ?? '',
      shop_code: task.shop_code ?? '',
      owner_type: task.owner_type ?? '',
      owner_key: task.owner_key ?? '',
      due_date: task.due_date ?? '',
      scheduled_start_at: task.scheduled_start_at ? task.scheduled_start_at.slice(0, 16) : '',
      source: task.source,
      approval_required: task.approval_required,
      execution_brief: task.execution_brief ?? '',
      project_id: task.project_id ?? '',
    })
    setEditing(true)
  }

  const handleStatusChange = async (status: TaskStatus) => {
    if (!id) return
    await updateStatus(id, status)
    refetch()
  }

  const handleAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    setLocalUploadError(null)
    if (!id || !file) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setLocalUploadError('Attachment must be 5 MB or smaller.')
      return
    }

    const fileDataUrl = await readFileAsDataUrl(file)
    const result = await addAttachment(id, {
      file_name: file.name,
      content_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      file_data_url: fileDataUrl,
      uploaded_by: 'jim',
      description: attachmentDescription.trim() || undefined,
    })

    if (result) {
      setAttachmentDescription('')
      refetch()
    }
  }

  const handleRemoveAttachment = async (attachment: TaskAttachmentRow) => {
    if (!window.confirm(`Remove attachment "${attachment.file_name}"?`)) return

    setRemovingAttachmentId(attachment.id)
    const removed = await removeAttachment(attachment.id)
    setRemovingAttachmentId(null)

    if (removed) {
      refetch()
    }
  }

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !editForm.title.trim()) return

    const result = await updateTask(id, {
      title: editForm.title.trim(),
      description: editForm.description.trim() || undefined,
      task_type: editForm.task_type,
      priority: editForm.priority,
      platform: editForm.platform.trim() || null,
      shop_code: editForm.shop_code.trim() || null,
      owner_type: editForm.owner_type || null,
      owner_key: editForm.owner_key || null,
      due_date: editForm.due_date || null,
      scheduled_start_at: editForm.scheduled_start_at || null,
      source: editForm.source,
      approval_required: editForm.approval_required,
      execution_brief: editForm.execution_brief.trim() || null,
      project_id: editForm.project_id || null,
    })

    if (result) {
      setEditing(false)
      refetch()
    }
  }

  if (loading) return <p>Loading task...</p>
  if (error) return <p style={{ color: 'var(--color-urgent)' }}>{error}</p>
  if (!data) return <p className="text-muted">Task not found.</p>

  const { task, targets, steps, comments, logs, attachments } = data

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' && task.status !== 'canceled'

  return (
    <div style={{ maxWidth: 800 }}>
      <Link to="/today" className="text-sm text-muted" style={{ display: 'inline-block', marginBottom: '1rem' }}>
        {'<-'} Back to Today
      </Link>

      <div className="page-header" style={{ marginBottom: '0.75rem' }}>
        <div className="flex flex-col gap-1" style={{ flex: 1 }}>
          <h2>{task.title}</h2>
          <div className="flex items-center gap-3">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <span className="text-xs text-muted">{task.task_type}</span>
            {task.platform && (
              <span className="text-xs text-muted">
                {task.platform}{task.shop_code ? ` / ${task.shop_code}` : ''}
              </span>
            )}
            {isOverdue && (
              <span style={{ color: 'var(--color-urgent)', fontSize: '0.75rem', fontWeight: 600 }}>
                OVERDUE
              </span>
            )}
          </div>
        </div>
        {!editing && (
          <button className="btn btn-primary" onClick={startEditing}>
            Edit
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSaveTask} className="card flex flex-col gap-4 mb-4">
          <div className="form-group">
            <label>Title *</label>
            <input
              required
              value={editForm.title}
              onChange={e => setEditForm({ ...editForm, title: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={editForm.description}
              onChange={e => setEditForm({ ...editForm, description: e.target.value })}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Task Type</label>
              <select value={editForm.task_type} onChange={e => setEditForm({ ...editForm, task_type: e.target.value as TaskType })}>
                {taskTypeOptions.data.map(value => <option key={value.option_key} value={value.option_key}>{value.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={editForm.priority} onChange={e => setEditForm({ ...editForm, priority: e.target.value as TaskPriority })}>
                {priorityOptions.data.map(value => <option key={value.option_key} value={value.option_key}>{value.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Platform</label>
              <input list="edit-platform-options" value={editForm.platform} onChange={e => setEditForm({ ...editForm, platform: e.target.value })} />
              <datalist id="edit-platform-options">
                {platformOptions.data.map(option => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}
              </datalist>
            </div>
            <div className="form-group">
              <label>Shop Code</label>
              <input list="edit-shop-code-options" value={editForm.shop_code} onChange={e => setEditForm({ ...editForm, shop_code: e.target.value })} />
              <datalist id="edit-shop-code-options">
                {shopCodeOptions.data.map(option => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}
              </datalist>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Owner Type</label>
              <select value={editForm.owner_type} onChange={e => setEditForm({ ...editForm, owner_type: e.target.value as OwnerType | '' })}>
                <option value="">-</option>
                {ownerTypeOptions.data.map(value => <option key={value.option_key} value={value.option_key}>{value.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Owner Key</label>
              <select value={editForm.owner_key} onChange={e => setEditForm({ ...editForm, owner_key: e.target.value as OwnerKey | '' })}>
                <option value="">-</option>
                {ownerKeyOptions.data.map(value => <option key={value.option_key} value={value.option_key}>{value.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" value={editForm.due_date} onChange={e => setEditForm({ ...editForm, due_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Scheduled Start</label>
              <input type="datetime-local" value={editForm.scheduled_start_at} onChange={e => setEditForm({ ...editForm, scheduled_start_at: e.target.value })} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Source</label>
              <select value={editForm.source} onChange={e => setEditForm({ ...editForm, source: e.target.value as TaskSource })}>
                {sourceOptions.data.map(value => <option key={value.option_key} value={value.option_key}>{value.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editForm.approval_required}
                  onChange={e => setEditForm({ ...editForm, approval_required: e.target.checked })}
                  style={{ width: 'auto' }}
                />
                Approval Required
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>Execution Brief</label>
            <textarea
              value={editForm.execution_brief}
              onChange={e => setEditForm({ ...editForm, execution_brief: e.target.value })}
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Project</label>
            <select
              value={editForm.project_id}
              onChange={e => setEditForm({ ...editForm, project_id: e.target.value })}
            >
              <option value="">No project</option>
              {projectOptions.data.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {saveError && <p className="text-sm" style={{ color: 'var(--color-urgent)' }}>{saveError}</p>}

          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={saving || !editForm.title.trim()}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 mb-4">
        {(['backlog', 'planned', 'in_progress', 'waiting_approval', 'blocked', 'done', 'canceled'] as TaskStatus[])
          .filter(s => s !== task.status)
          .map(s => (
            <button
              key={s}
              className="btn btn-sm"
              onClick={() => handleStatusChange(s)}
            >
              Set {s.replace(/_/g, ' ')}
            </button>
          ))}
      </div>

      <div className="flex flex-col gap-4">
        {task.description && (
          <section>
            <h3 className="font-semibold mb-2 text-sm">Description</h3>
            <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>
          </section>
        )}

        <section className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card flex flex-col gap-2">
            <h4 className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>Details</h4>
            <div className="text-sm"><span className="text-muted">Source:</span> {task.source}</div>
            <div className="text-sm"><span className="text-muted">Created by:</span> {task.created_by}</div>
            <div className="text-sm"><span className="text-muted">Owner:</span> {task.owner_key || '-'}</div>
            <div className="text-sm">
              <span className="text-muted">Project:</span>{' '}
              {task.project_id ? (
                <Link to={`/projects/${task.project_id}`}>
                  {projectOptions.data.find(p => p.id === task.project_id)?.name ?? task.project_id.slice(0, 8) + '...'}
                </Link>
              ) : (
                '-'
              )}
            </div>
            {task.due_date && (
              <div className="text-sm">
                <span className="text-muted">Due:</span> {task.due_date}
              </div>
            )}
            {task.scheduled_start_at && (
              <div className="text-sm">
                <span className="text-muted">Scheduled:</span> {new Date(task.scheduled_start_at).toLocaleString()}
              </div>
            )}
            {task.completed_at && (
              <div className="text-sm">
                <span className="text-muted">Completed:</span> {new Date(task.completed_at).toLocaleString()}
              </div>
            )}
          </div>

          <div className="card flex flex-col gap-2">
            <h4 className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>Execution</h4>
            <div className="text-sm">
              <span className="text-muted">Approval required:</span>{' '}
              {task.approval_required ? 'Yes' : 'No'}
            </div>
            {task.approved_at && (
              <div className="text-sm">
                <span className="text-muted">Approved at:</span> {new Date(task.approved_at).toLocaleString()}
              </div>
            )}
            {task.approved_by && (
              <div className="text-sm">
                <span className="text-muted">Approved by:</span> {task.approved_by}
              </div>
            )}
            {task.agent_execution_status && (
              <div className="text-sm">
                <span className="text-muted">Agent status:</span> {task.agent_execution_status}
              </div>
            )}
            {task.execution_brief && (
              <div className="text-sm">
                <span className="text-muted">Brief:</span> {task.execution_brief}
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="font-semibold mb-2 text-sm">Targets</h3>
          <TaskTargets targets={targets} />
        </section>

        <section>
          <h3 className="font-semibold mb-2 text-sm">Steps</h3>
          <TaskSteps steps={steps} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Attachments</h3>
            <label className="btn btn-sm">
              {uploading ? 'Uploading...' : 'Upload File'}
              <input
                type="file"
                accept="image/*,.csv,text/csv,application/pdf,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xls"
                onChange={handleAttachmentChange}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          <div className="form-group mb-2">
            <label>Attachment Note</label>
            <input
              value={attachmentDescription}
              onChange={e => setAttachmentDescription(e.target.value)}
              placeholder="Optional context for the next uploaded file"
            />
          </div>
          {(localUploadError || uploadError || removeError) && (
            <p className="text-sm" style={{ color: 'var(--color-urgent)' }}>
              {localUploadError || uploadError || removeError}
            </p>
          )}
          <TaskAttachments
            attachments={attachments}
            onRemove={handleRemoveAttachment}
            removingId={removingAttachmentId}
          />
        </section>

        <section>
          <h3 className="font-semibold mb-2 text-sm">Activity</h3>
          <TaskActivity comments={comments} logs={logs} />
        </section>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCreateTask, useLinkTarget, useTaskSelectOptions } from '../hooks/useTasks'
import { useProjectOptions } from '../hooks/useProjects'
import type { TaskType, TaskPriority, OwnerType, OwnerKey, TaskSource } from '@lib/task-types'

export default function CreateTask() {
  const navigate = useNavigate()
  const { create, loading, error } = useCreateTask()
  const { link, loading: linking, error: linkError } = useLinkTarget()
  const taskTypeOptions = useTaskSelectOptions('task_type')
  const priorityOptions = useTaskSelectOptions('priority')
  const ownerTypeOptions = useTaskSelectOptions('owner_type')
  const ownerKeyOptions = useTaskSelectOptions('owner_key')
  const sourceOptions = useTaskSelectOptions('source')
  const platformOptions = useTaskSelectOptions('platform')
  const shopCodeOptions = useTaskSelectOptions('shop_code')
  const targetTypeOptions = useTaskSelectOptions('target_type')
  const projectOptions = useProjectOptions()
  const [searchParams] = useSearchParams()

  const [title, setTitle] = useState(searchParams.get('title') ?? '')
  const [description, setDescription] = useState(searchParams.get('description') ?? '')
  const [taskType, setTaskType] = useState<TaskType>((searchParams.get('task_type') as TaskType) || 'listing')
  const [priority, setPriority] = useState<TaskPriority>((searchParams.get('priority') as TaskPriority) || 'medium')
  const [platform, setPlatform] = useState(searchParams.get('platform') ?? '')
  const [shopCode, setShopCode] = useState(searchParams.get('shop_code') ?? '')
  const [ownerType, setOwnerType] = useState<OwnerType | ''>('')
  const [ownerKey, setOwnerKey] = useState<OwnerKey | ''>('')
  const [dueDate, setDueDate] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [executionBrief, setExecutionBrief] = useState(searchParams.get('execution_brief') ?? '')
  const [source, setSource] = useState<TaskSource>((searchParams.get('source') as TaskSource) || 'manual')
  const [targetType, setTargetType] = useState(searchParams.get('target_type') ?? '')
  const [targetId, setTargetId] = useState(searchParams.get('target_id') ?? '')
  const [targetLabel, setTargetLabel] = useState(searchParams.get('target_label') ?? '')
  const [projectId, setProjectId] = useState(searchParams.get('project_id') ?? '')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSubmitting(true)
    const result = await create({
      title: title.trim(),
      description: description.trim() || undefined,
      task_type: taskType,
      priority,
      platform: platform || undefined,
      shop_code: shopCode || undefined,
      owner_type: (ownerType as OwnerType) || undefined,
      owner_key: (ownerKey as OwnerKey) || undefined,
      due_date: dueDate || undefined,
      scheduled_start_at: scheduledStart || undefined,
      source,
      approval_required: approvalRequired,
      execution_brief: executionBrief.trim() || undefined,
      project_id: projectId || null,
    })
    setSubmitting(false)

    if (result && (targetType.trim() || targetId.trim() || targetLabel.trim())) {
      await link(result.id, {
        target_type: targetType.trim() || 'external_record',
        target_id: targetId.trim() || undefined,
        target_label: targetLabel.trim() || undefined,
        target_ref_json: {
          platform: platform || undefined,
          shop_code: shopCode || undefined,
          source,
        },
      })
    }

    if (result) {
      navigate(`/tasks/${result.id}`)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h2>Create Task</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="form-group">
          <label>Title *</label>
          <input
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Fix product title for N508P301428A"
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description of the task..."
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Task Type *</label>
            <select value={taskType} onChange={e => setTaskType(e.target.value as TaskType)}>
              {taskTypeOptions.data.map(t => <option key={t.option_key} value={t.option_key}>{t.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Priority *</label>
            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
              {priorityOptions.data.map(p => <option key={p.option_key} value={p.option_key}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Platform</label>
            <input
              list="platform-options"
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              placeholder="e.g. mercari, rakuten"
            />
            <datalist id="platform-options">
              {platformOptions.data.map(option => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}
            </datalist>
          </div>

          <div className="form-group">
            <label>Shop Code</label>
            <input
              list="shop-code-options"
              value={shopCode}
              onChange={e => setShopCode(e.target.value)}
              placeholder="e.g. shop4, main, jp"
            />
            <datalist id="shop-code-options">
              {shopCodeOptions.data.map(option => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}
            </datalist>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Owner Type</label>
            <select value={ownerType} onChange={e => setOwnerType(e.target.value as OwnerType | '')}>
              <option value="">-</option>
              {ownerTypeOptions.data.map(t => <option key={t.option_key} value={t.option_key}>{t.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Owner Key</label>
            <select value={ownerKey} onChange={e => setOwnerKey(e.target.value as OwnerKey | '')}>
              <option value="">-</option>
              {ownerKeyOptions.data.map(k => <option key={k.option_key} value={k.option_key}>{k.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Scheduled Start</label>
            <input type="datetime-local" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Source</label>
            <select value={source} onChange={e => setSource(e.target.value as TaskSource)}>
              {sourceOptions.data.map(s => <option key={s.option_key} value={s.option_key}>{s.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={e => setApprovalRequired(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Approval Required
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>Execution Brief</label>
          <textarea
            value={executionBrief}
            onChange={e => setExecutionBrief(e.target.value)}
            placeholder="Guidance for agent execution (display-only, no external actions)"
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projectOptions.data.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <fieldset className="card flex flex-col gap-3" style={{ border: 0 }}>
          <legend className="text-sm font-semibold">Initial Target</legend>
          <div className="form-row">
            <div className="form-group">
              <label>Target Type</label>
              <input
                list="target-type-options"
                value={targetType}
                onChange={e => setTargetType(e.target.value)}
                placeholder="e.g. variant, listing, workflow"
              />
              <datalist id="target-type-options">
                {targetTypeOptions.data.map(option => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}
              </datalist>
            </div>
            <div className="form-group">
              <label>Target ID</label>
              <input
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                placeholder="SKU, listing ID, Baserow row ID"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Target Label</label>
            <input
              value={targetLabel}
              onChange={e => setTargetLabel(e.target.value)}
              placeholder="Readable label shown on task cards"
            />
          </div>
        </fieldset>

        {(error || linkError) && (
          <p style={{ color: 'var(--color-urgent)', fontSize: '0.85rem' }}>
            {error || linkError}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={loading || linking || submitting || !title.trim()}>
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
          <button type="button" className="btn" onClick={() => navigate('/today')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

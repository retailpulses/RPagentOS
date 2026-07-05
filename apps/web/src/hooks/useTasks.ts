import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { TaskCardRow, TaskFilters, TaskDetailRow, TaskRow, CreateTaskInput, UpdateTaskInput, CreateTaskTargetInput, TaskTargetRow, TaskStepRow, TaskCommentRow, TaskLogRow, TaskAttachmentRow, CreateTaskAttachmentInput, TaskSelectFieldKey, TaskSelectOptionRow } from '@lib/task-types'

const DEFAULT_PAGE_SIZE = 50
const MISSING_SUPABASE_MESSAGE = 'Task data is not connected. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this deployment.'

export const FALLBACK_TASK_SELECT_OPTIONS: Record<TaskSelectFieldKey, Array<{ option_key: string; label: string }>> = {
  task_type: [
    { option_key: 'product', label: 'Product' },
    { option_key: 'promotion', label: 'Promotion' },
    { option_key: 'listing', label: 'Listing' },
    { option_key: 'account', label: 'Account' },
    { option_key: 'workflow', label: 'Workflow' },
  ],
  priority: [
    { option_key: 'urgent', label: 'Urgent' },
    { option_key: 'high', label: 'High' },
    { option_key: 'medium', label: 'Medium' },
    { option_key: 'low', label: 'Low' },
  ],
  owner_type: [
    { option_key: 'human', label: 'Human' },
    { option_key: 'agent', label: 'Agent' },
    { option_key: 'mixed', label: 'Mixed' },
  ],
  owner_key: [
    { option_key: 'jim', label: 'Jim' },
    { option_key: 'agent_listing', label: 'Listing Agent' },
    { option_key: 'agent_promotion', label: 'Promotion Agent' },
    { option_key: 'external_operator', label: 'External Operator' },
  ],
  source: [
    { option_key: 'manual', label: 'Manual' },
    { option_key: 'system', label: 'System' },
    { option_key: 'agent', label: 'Agent' },
    { option_key: 'import', label: 'Import' },
    { option_key: 'workflow', label: 'Workflow' },
    { option_key: 'external', label: 'External' },
  ],
  platform: [
    { option_key: 'mercari', label: 'Mercari' },
    { option_key: 'rakuten', label: 'Rakuten' },
    { option_key: 'amazon', label: 'Amazon' },
  ],
  shop_code: [
    { option_key: 'shop4', label: 'Shop4' },
    { option_key: 'main', label: 'Main' },
    { option_key: 'jp', label: 'Japan' },
  ],
  target_type: [
    { option_key: 'variant', label: 'Variant' },
    { option_key: 'listing', label: 'Listing' },
    { option_key: 'workflow', label: 'Workflow' },
    { option_key: 'external_record', label: 'External Record' },
  ],
}

function fallbackRows(fieldKey: TaskSelectFieldKey): TaskSelectOptionRow[] {
  return FALLBACK_TASK_SELECT_OPTIONS[fieldKey].map((option, index) => ({
    id: `fallback-${fieldKey}-${option.option_key}`,
    field_key: fieldKey,
    option_key: option.option_key,
    label: option.label,
    description: null,
    sort_order: (index + 1) * 10,
    is_active: true,
    metadata: {},
    created_at: '',
    updated_at: '',
  }))
}

async function listTaskSelectOptions(fieldKey: TaskSelectFieldKey): Promise<TaskSelectOptionRow[]> {
  if (!supabase) return fallbackRows(fieldKey)

  const { data, error } = await supabase
    .from('task_select_options')
    .select('*')
    .eq('field_key', fieldKey)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    return fallbackRows(fieldKey)
  }

  return ((data ?? []) as TaskSelectOptionRow[]).length > 0
    ? (data ?? []) as TaskSelectOptionRow[]
    : fallbackRows(fieldKey)
}

async function listTasks(
  filters: TaskFilters = {},
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<{ data: TaskCardRow[]; count: number }> {
  if (!supabase) return { data: [], count: 0 }

  let query = supabase
    .from('tasks')
    .select(
      `*,
      task_targets!left ( id, target_label )`,
      { count: 'exact', head: false },
    )
    .order('priority', { ascending: false })
    .order('due_date', { ascending: true })
    .order('scheduled_start_at', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status)
  }
  if (filters.priority && filters.priority.length > 0) {
    query = query.in('priority', filters.priority)
  }
  if (filters.task_type && filters.task_type.length > 0) {
    query = query.in('task_type', filters.task_type)
  }
  if (filters.platform) {
    query = query.eq('platform', filters.platform)
  }
  if (filters.shop_code) {
    query = query.eq('shop_code', filters.shop_code)
  }
  if (filters.owner_type) {
    query = query.eq('owner_type', filters.owner_type)
  }
  if (filters.owner_key) {
    query = query.eq('owner_key', filters.owner_key)
  }
  if (filters.due_before) {
    query = query.lte('due_date', filters.due_before)
  }
  if (filters.due_after) {
    query = query.gte('due_date', filters.due_after)
  }
  if (filters.scheduled_after) {
    query = query.gte('scheduled_start_at', filters.scheduled_after)
  }
  if (filters.scheduled_before) {
    query = query.lte('scheduled_start_at', filters.scheduled_before)
  }
  if (filters.approval_required !== undefined) {
    query = query.eq('approval_required', filters.approval_required)
  }
  if (filters.search) {
    query = query.or(
      `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`,
    )
  }

  const { data, error, count } = await query

  if (error) throw error

  const rows: TaskCardRow[] = (data ?? []).map((row: Record<string, unknown>) => {
    const targets = row['task_targets'] as Array<{ id: string; target_label: string | null }> | undefined
    const { task_targets, ...taskFields } = row
    return {
      ...taskFields,
      target_count: targets?.length ?? 0,
      target_labels: targets?.map(t => t.target_label).filter(Boolean) as string[] | undefined,
    } as unknown as TaskCardRow
  })

  return { data: rows, count: count ?? 0 }
}

async function getTaskDetail(id: string): Promise<TaskDetailRow | null> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (taskError) throw taskError
  if (!task) return null

  const [targets, steps, comments, logs, attachments] = await Promise.all([
    supabase.from('task_targets').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_steps').select('*').eq('task_id', id).order('position'),
    supabase.from('task_comments').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_logs').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_attachments').select('*').eq('task_id', id).order('created_at'),
  ])

  if (targets.error) throw targets.error
  if (steps.error) throw steps.error
  if (comments.error) throw comments.error
  if (logs.error) throw logs.error
  if (attachments.error) throw attachments.error

  return {
    task: task as TaskRow,
    targets: (targets.data ?? []) as TaskTargetRow[],
    steps: (steps.data ?? []) as TaskStepRow[],
    comments: (comments.data ?? []) as TaskCommentRow[],
    logs: (logs.data ?? []) as TaskLogRow[],
    attachments: (attachments.data ?? []) as TaskAttachmentRow[],
  }
}

async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: input.title,
      description: input.description ?? null,
      task_type: input.task_type,
      priority: input.priority,
      platform: input.platform ?? null,
      shop_code: input.shop_code ?? null,
      owner_type: input.owner_type ?? null,
      owner_key: input.owner_key ?? null,
      due_date: input.due_date ?? null,
      scheduled_start_at: input.scheduled_start_at ?? null,
      source: input.source ?? 'manual',
      approval_required: input.approval_required ?? false,
      execution_brief: input.execution_brief ?? null,
      created_by: input.created_by ?? 'jim',
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw error
  return data as TaskRow
}

async function linkTarget(taskId: string, input: CreateTaskTargetInput): Promise<TaskTargetRow> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data, error } = await supabase
    .from('task_targets')
    .insert({
      task_id: taskId,
      target_type: input.target_type,
      target_id: input.target_id ?? null,
      target_label: input.target_label ?? null,
      target_ref_json: input.target_ref_json ?? {},
    })
    .select()
    .single()

  if (error) throw error
  return data as TaskTargetRow
}

async function updateTaskStatus(id: string, status: string): Promise<TaskRow> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const patch: Record<string, unknown> = { status }
  if (status === 'done') {
    patch['completed_at'] = new Date().toISOString()
  } else {
    patch['completed_at'] = null
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  void supabase.from('task_logs').insert({
    task_id: id,
    log_type: 'status_changed',
    actor_type: 'human',
    actor_key: 'jim',
    message: `Status changed to ${status}`,
    payload: {},
  })

  return data as TaskRow
}

async function updateTask(id: string, input: UpdateTaskInput): Promise<TaskRow> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data, error } = await supabase
    .from('tasks')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as TaskRow
}

async function addTaskAttachment(taskId: string, input: CreateTaskAttachmentInput): Promise<TaskAttachmentRow> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: input.file_name,
      content_type: input.content_type,
      file_size_bytes: input.file_size_bytes,
      file_data_url: input.file_data_url,
      uploaded_by: input.uploaded_by ?? 'jim',
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw error

  await supabase.from('task_logs').insert({
    task_id: taskId,
    log_type: 'attachment_added',
    actor_type: 'human',
    actor_key: input.uploaded_by ?? 'jim',
    message: `Attachment added: ${input.file_name}`,
    payload: {
      file_name: input.file_name,
      content_type: input.content_type,
      file_size_bytes: input.file_size_bytes,
    },
  })

  return data as TaskAttachmentRow
}

export function useTaskList(filters: TaskFilters = {}) {
  const [data, setData] = useState<TaskCardRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filterKey = JSON.stringify(filters)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listTasks(filters)
      setData(result.data)
      setCount(result.count)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [filterKey])

  useEffect(() => { fetch() }, [fetch])

  return { data, count, loading, error, refetch: fetch }
}

export function useTaskSelectOptions(fieldKey: TaskSelectFieldKey) {
  const [data, setData] = useState<TaskSelectOptionRow[]>(() => fallbackRows(fieldKey))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listTaskSelectOptions(fieldKey)
      setData(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load selector options')
      setData(fallbackRows(fieldKey))
    } finally {
      setLoading(false)
    }
  }, [fieldKey])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

export function useTaskDetail(id: string | undefined) {
  const [data, setData] = useState<TaskDetailRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const result = await getTaskDetail(id)
      setData(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load task')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

export function useCreateTask() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (input: CreateTaskInput): Promise<TaskRow | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await createTask(input)
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create task')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { create, loading, error }
}

export function useLinkTarget() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const link = async (taskId: string, input: CreateTaskTargetInput): Promise<TaskTargetRow | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await linkTarget(taskId, input)
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to link target')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { link, loading, error }
}

export function useUpdateTaskStatus() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = async (id: string, status: string): Promise<TaskRow | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await updateTaskStatus(id, status)
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update task')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { update, loading, error }
}

export function useUpdateTask() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = async (id: string, input: UpdateTaskInput): Promise<TaskRow | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await updateTask(id, input)
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update task')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { update, loading, error }
}

export function useAddTaskAttachment() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (taskId: string, input: CreateTaskAttachmentInput): Promise<TaskAttachmentRow | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await addTaskAttachment(taskId, input)
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to upload attachment')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { add, loading, error }
}

async function removeTaskAttachment(attachmentId: string): Promise<void> {
  if (!supabase) throw new Error(MISSING_SUPABASE_MESSAGE)

  const { data: att, error: fetchError } = await supabase
    .from('task_attachments')
    .select('task_id, file_name')
    .eq('id', attachmentId)
    .maybeSingle()

  if (fetchError) throw fetchError
  if (!att) throw new Error('Attachment not found')

  const { error: deleteError } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId)

  if (deleteError) throw deleteError

  await supabase.from('task_logs').insert({
    task_id: att.task_id,
    log_type: 'attachment_removed',
    actor_type: 'human',
    actor_key: 'jim',
    message: `Attachment removed: ${att.file_name}`,
    payload: { file_name: att.file_name },
  })
}

export function useRemoveTaskAttachment() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (attachmentId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      await removeTaskAttachment(attachmentId)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove attachment')
      return false
    } finally {
      setLoading(false)
    }
  }

  return { remove, loading, error }
}

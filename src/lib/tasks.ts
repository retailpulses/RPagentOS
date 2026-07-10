import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TaskRow,
  TaskTargetRow,
  TaskStepRow,
  TaskCommentRow,
  TaskLogRow,
  TaskAttachmentRow,
  TaskCardRow,
  TaskDetailRow,
  TaskFilters,
  CreateTaskInput,
  UpdateTaskInput,
  CreateTaskTargetInput,
  CreateTaskStepInput,
  UpdateTaskStepInput,
  CreateTaskCommentInput,
  CreateTaskLogInput,
  CreateTaskAttachmentInput,
  TaskSelectFieldKey,
  TaskSelectOptionRow,
} from './task-types.js';

const DEFAULT_PAGE_SIZE = 50;

export async function listTasks(
  supabase: SupabaseClient,
  filters: TaskFilters = {},
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<{ data: TaskCardRow[]; count: number }> {
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
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status);
  }
  if (filters.priority && filters.priority.length > 0) {
    query = query.in('priority', filters.priority);
  }
  if (filters.task_type && filters.task_type.length > 0) {
    query = query.in('task_type', filters.task_type);
  }
  if (filters.platform) {
    query = query.eq('platform', filters.platform);
  }
  if (filters.shop_code) {
    query = query.eq('shop_code', filters.shop_code);
  }
  if (filters.owner_type) {
    query = query.eq('owner_type', filters.owner_type);
  }
  if (filters.owner_key) {
    query = query.eq('owner_key', filters.owner_key);
  }
  if (filters.due_before) {
    query = query.lte('due_date', filters.due_before);
  }
  if (filters.due_after) {
    query = query.gte('due_date', filters.due_after);
  }
  if (filters.scheduled_after) {
    query = query.gte('scheduled_start_at', filters.scheduled_after);
  }
  if (filters.scheduled_before) {
    query = query.lte('scheduled_start_at', filters.scheduled_before);
  }
  if (filters.approval_required !== undefined) {
    query = query.eq('approval_required', filters.approval_required);
  }
  if (filters.search) {
    query = query.or(
      `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`,
    );
  }

  const { data, error, count } = await query;

  if (error) throw error;

  const rows: TaskCardRow[] = (data ?? []).map((row: Record<string, unknown>) => {
    const targets = row['task_targets'] as Array<{ id: string; target_label: string | null }> | undefined;
    const { task_targets, ...taskFields } = row;
    return {
      ...taskFields,
      target_count: targets?.length ?? 0,
      target_labels: targets?.map(t => t.target_label).filter(Boolean) as string[] | undefined,
    } as unknown as TaskCardRow;
  });

  return { data: rows, count: count ?? 0 };
}

export async function getTaskDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<TaskDetailRow | null> {
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (taskError) throw taskError;
  if (!task) return null;

  const [targets, steps, comments, logs, attachments] = await Promise.all([
    supabase.from('task_targets').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_steps').select('*').eq('task_id', id).order('position'),
    supabase.from('task_comments').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_logs').select('*').eq('task_id', id).order('created_at'),
    supabase.from('task_attachments').select('*').eq('task_id', id).order('created_at'),
  ]);

  if (targets.error) throw targets.error;
  if (steps.error) throw steps.error;
  if (comments.error) throw comments.error;
  if (logs.error) throw logs.error;
  if (attachments.error) throw attachments.error;

  return {
    task: task as TaskRow,
    targets: (targets.data ?? []) as TaskTargetRow[],
    steps: (steps.data ?? []) as TaskStepRow[],
    comments: (comments.data ?? []) as TaskCommentRow[],
    logs: (logs.data ?? []) as TaskLogRow[],
    attachments: (attachments.data ?? []) as TaskAttachmentRow[],
  };
}

export async function createTask(
  supabase: SupabaseClient,
  input: CreateTaskInput,
): Promise<TaskRow> {
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
      project_id: input.project_id ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as TaskRow;
}

export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskRow> {
  const { data, error } = await supabase
    .from('tasks')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as TaskRow;
}

export async function updateTaskStatus(
  supabase: SupabaseClient,
  id: string,
  status: string,
): Promise<TaskRow> {
  const patch: Record<string, unknown> = { status };
  if (status === 'done') {
    patch['completed_at'] = new Date().toISOString();
  } else {
    patch['completed_at'] = null;
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  addTaskLog(supabase, id, {
    log_type: 'status_changed',
    message: `Status changed to ${status}`,
    actor_type: 'human',
    actor_key: 'jim',
  }).catch(() => {});

  return data as TaskRow;
}

export async function linkTarget(
  supabase: SupabaseClient,
  taskId: string,
  input: CreateTaskTargetInput,
): Promise<TaskTargetRow> {
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
    .single();

  if (error) throw error;
  return data as TaskTargetRow;
}

export const createTaskTarget = linkTarget;

export async function unlinkTarget(
  supabase: SupabaseClient,
  targetRowId: string,
): Promise<void> {
  const { error } = await supabase
    .from('task_targets')
    .delete()
    .eq('id', targetRowId);

  if (error) throw error;
}

export async function createStep(
  supabase: SupabaseClient,
  taskId: string,
  input: CreateTaskStepInput,
): Promise<TaskStepRow> {
  const { data, error } = await supabase
    .from('task_steps')
    .insert({
      task_id: taskId,
      position: input.position,
      title: input.title,
      description: input.description ?? null,
      owner_type: input.owner_type ?? null,
      owner_key: input.owner_key ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as TaskStepRow;
}

export async function updateStep(
  supabase: SupabaseClient,
  stepId: string,
  input: UpdateTaskStepInput,
): Promise<TaskStepRow> {
  const patch: Record<string, unknown> = { ...input };
  if (input.status === 'done') {
    patch['completed_at'] = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('task_steps')
    .update(patch)
    .eq('id', stepId)
    .select()
    .single();

  if (error) throw error;
  return data as TaskStepRow;
}

export async function addComment(
  supabase: SupabaseClient,
  taskId: string,
  input: CreateTaskCommentInput,
): Promise<TaskCommentRow> {
  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: taskId,
      body: input.body,
      author_type: input.author_type ?? 'human',
      author_key: input.author_key ?? 'jim',
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;

  addTaskLog(supabase, taskId, {
    log_type: 'comment_added',
    actor_type: input.author_type ?? 'human',
    actor_key: input.author_key ?? 'jim',
    message: 'Comment added.',
  }).catch(() => {});

  return data as TaskCommentRow;
}

export async function addTaskLog(
  supabase: SupabaseClient,
  taskId: string,
  input: CreateTaskLogInput,
): Promise<TaskLogRow> {
  const { data, error } = await supabase
    .from('task_logs')
    .insert({
      task_id: taskId,
      step_id: input.step_id ?? null,
      run_id: input.run_id ?? null,
      log_type: input.log_type,
      actor_type: input.actor_type ?? 'system',
      actor_key: input.actor_key ?? 'system',
      message: input.message ?? null,
      payload: input.payload ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as TaskLogRow;
}

export const appendTaskLog = addTaskLog;

export async function listTaskSelectOptions(
  supabase: SupabaseClient,
  fieldKey?: TaskSelectFieldKey,
): Promise<TaskSelectOptionRow[]> {
  let query = supabase
    .from('task_select_options')
    .select('*')
    .eq('is_active', true)
    .order('field_key', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (fieldKey) {
    query = query.eq('field_key', fieldKey);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TaskSelectOptionRow[];
}

export async function addTaskAttachment(
  supabase: SupabaseClient,
  taskId: string,
  input: CreateTaskAttachmentInput,
): Promise<TaskAttachmentRow> {
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
    .single();

  if (error) throw error;

  await addTaskLog(supabase, taskId, {
    log_type: 'attachment_added',
    actor_type: 'human',
    actor_key: input.uploaded_by ?? 'jim',
    message: `Attachment added: ${input.file_name}`,
    payload: {
      file_name: input.file_name,
      content_type: input.content_type,
      file_size_bytes: input.file_size_bytes,
    },
  }).catch(() => {});

  return data as TaskAttachmentRow;
}

export async function removeTaskAttachment(
  supabase: SupabaseClient,
  attachmentId: string,
): Promise<void> {
  const { data: att, error: fetchError } = await supabase
    .from('task_attachments')
    .select('task_id, file_name')
    .eq('id', attachmentId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!att) throw new Error('Attachment not found');

  const { error: deleteError } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId);

  if (deleteError) throw deleteError;

  await addTaskLog(supabase, att.task_id, {
    log_type: 'attachment_removed',
    actor_type: 'human',
    actor_key: 'jim',
    message: `Attachment removed: ${att.file_name}`,
    payload: { file_name: att.file_name },
  }).catch(() => {});
}

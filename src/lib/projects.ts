import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProjectRow,
  ProjectAttachmentRow,
  ProjectCardRow,
  ProjectDetailRow,
  CreateProjectInput,
  UpdateProjectInput,
  CreateProjectAttachmentInput,
} from './project-types.js';
import type { TaskCardRow } from './task-types.js';

export async function listProjects(
  supabase: SupabaseClient,
  filters?: { status?: string },
): Promise<ProjectCardRow[]> {
  let query = supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const projects = (data ?? []) as ProjectRow[];

  // Fetch task counts for each project
  const projectIds = projects.map(p => p.id);
  if (projectIds.length === 0) return [];

  const { data: counts, error: countError } = await supabase
    .from('tasks')
    .select('project_id')
    .in('project_id', projectIds);

  if (countError) throw countError;

  const countMap = new Map<string, number>();
  for (const row of (counts ?? [])) {
    const pid = (row as Record<string, unknown>)['project_id'] as string;
    if (pid) countMap.set(pid, (countMap.get(pid) ?? 0) + 1);
  }

  return projects.map(p => ({
    ...p,
    task_count: countMap.get(p.id) ?? 0,
  }));
}

export async function getProjectDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<ProjectDetailRow | null> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!project) return null;

  const [attachments, tasks] = await Promise.all([
    supabase
      .from('project_attachments')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select(`*, task_targets!left ( id, target_label )`)
      .eq('project_id', id)
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  if (attachments.error) throw attachments.error;
  if (tasks.error) throw tasks.error;

  const taskRows: TaskCardRow[] = ((tasks.data ?? []) as Record<string, unknown>[]).map(row => {
    const targets = row['task_targets'] as Array<{ id: string; target_label: string | null }> | undefined;
    const { task_targets, ...taskFields } = row;
    return {
      ...taskFields,
      target_count: targets?.length ?? 0,
      target_labels: targets?.map(t => t.target_label).filter(Boolean) as string[] | undefined,
    } as unknown as TaskCardRow;
  });

  return {
    project: project as ProjectRow,
    attachments: (attachments.data ?? []) as ProjectAttachmentRow[],
    tasks: taskRows,
  };
}

export async function createProject(
  supabase: SupabaseClient,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as ProjectRow;
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from('projects')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as ProjectRow;
}

export async function addProjectAttachment(
  supabase: SupabaseClient,
  projectId: string,
  input: CreateProjectAttachmentInput,
): Promise<ProjectAttachmentRow> {
  const { data, error } = await supabase
    .from('project_attachments')
    .insert({
      project_id: projectId,
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
  return data as ProjectAttachmentRow;
}

export async function removeProjectAttachment(
  supabase: SupabaseClient,
  attachmentId: string,
): Promise<void> {
  const { data: att, error: fetchError } = await supabase
    .from('project_attachments')
    .select('id')
    .eq('id', attachmentId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!att) throw new Error('Attachment not found');

  const { error: deleteError } = await supabase
    .from('project_attachments')
    .delete()
    .eq('id', attachmentId);

  if (deleteError) throw deleteError;
}

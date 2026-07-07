import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  ProjectRow,
  ProjectAttachmentRow,
  ProjectCardRow,
  ProjectDetailRow,
  CreateProjectInput,
  UpdateProjectInput,
  CreateProjectAttachmentInput,
} from '@lib/project-types';

const MISSING_SUPABASE_MESSAGE = 'Project data is not connected. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this deployment.';

export function useProjectList(filters?: { status?: string }) {
  const [data, setData] = useState<ProjectCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filters);

  const fetch = useCallback(async () => {
    if (!supabase) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      const { data: projects, error: queryError } = await query;
      if (queryError) throw queryError;

      const rows = (projects ?? []) as ProjectRow[];

      // Fetch task counts
      if (rows.length > 0) {
        const projectIds = rows.map(p => p.id);
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

        setData(rows.map(p => ({ ...p, task_count: countMap.get(p.id) ?? 0 })));
      } else {
        setData([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function useProjectDetail(id: string | undefined) {
  const [data, setData] = useState<ProjectDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id || !supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (projectError) throw projectError;
      if (!project) { setData(null); setLoading(false); return; }

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

      const taskRows = ((tasks.data ?? []) as Record<string, unknown>[]).map(row => {
        const targets = row['task_targets'] as Array<{ id: string; target_label: string | null }> | undefined;
        const { task_targets, ...taskFields } = row;
        return {
          ...taskFields,
          target_count: targets?.length ?? 0,
          target_labels: targets?.map(t => t.target_label).filter(Boolean) as string[] | undefined,
        };
      });

      setData({
        project: project as ProjectRow,
        attachments: (attachments.data ?? []) as ProjectAttachmentRow[],
        tasks: taskRows as any[],
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function useCreateProject() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: CreateProjectInput): Promise<ProjectRow | null> => {
    if (!supabase) { setError(MISSING_SUPABASE_MESSAGE); return null; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({
          name: input.name,
          description: input.description ?? null,
          status: input.status ?? 'active',
          metadata: input.metadata ?? {},
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return data as ProjectRow;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { create, loading, error };
}

export function useUpdateProject() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (id: string, input: UpdateProjectInput): Promise<ProjectRow | null> => {
    if (!supabase) { setError(MISSING_SUPABASE_MESSAGE); return null; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from('projects')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;
      return data as ProjectRow;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update project');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { update, loading, error };
}

export function useAddProjectAttachment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (projectId: string, input: CreateProjectAttachmentInput): Promise<ProjectAttachmentRow | null> => {
    if (!supabase) { setError(MISSING_SUPABASE_MESSAGE); return null; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
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

      if (insertError) throw insertError;
      return data as ProjectAttachmentRow;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to upload attachment');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { add, loading, error };
}

export function useRemoveProjectAttachment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (attachmentId: string): Promise<boolean> => {
    if (!supabase) { setError(MISSING_SUPABASE_MESSAGE); return false; }
    setLoading(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('project_attachments')
        .delete()
        .eq('id', attachmentId);

      if (deleteError) throw deleteError;
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove attachment');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { remove, loading, error };
}

// Lightweight hook: fetch all active projects for dropdowns/selectors
export function useProjectOptions() {
  const [data, setData] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!supabase) { setData([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: projects, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('status', 'active')
        .order('name', { ascending: true });

      if (error) throw error;
      setData((projects ?? []) as { id: string; name: string }[]);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, refetch: fetch };
}

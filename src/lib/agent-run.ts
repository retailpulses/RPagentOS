import { supabase } from './supabase.js';

export interface CreateRunInput {
  runType: string;
  targetPlatform?: string;
  targetShopCode?: string;
  metadata?: Record<string, unknown>;
}

export async function createAgentRun(input: CreateRunInput) {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      run_type: input.runType,
      target_platform: input.targetPlatform ?? null,
      target_shop_code: input.targetShopCode ?? null,
      status: 'running',
      metadata: input.metadata ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('ERROR: failed to create agent_run', error);
    process.exit(1);
  }

  return data;
}

export async function completeAgentRun(runId: string, metadata?: Record<string, unknown>) {
  const { data: existing } = await supabase
    .from('agent_runs')
    .select('metadata')
    .eq('id', runId)
    .maybeSingle();

  const merged = existing?.metadata
    ? { ...(existing.metadata as Record<string, unknown>), ...metadata }
    : (metadata ?? {});

  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      metadata: Object.keys(merged).length > 0 ? merged : undefined,
    })
    .eq('id', runId);

  if (error) {
    console.error('ERROR: failed to complete agent_run', error);
  }
}

export async function failAgentRun(runId: string, errorMessage: string, metadata?: Record<string, unknown>) {
  const { data: existing } = await supabase
    .from('agent_runs')
    .select('metadata')
    .eq('id', runId)
    .maybeSingle();

  const merged = existing?.metadata
    ? { ...(existing.metadata as Record<string, unknown>), ...metadata, error: errorMessage }
    : { ...metadata, error: errorMessage };

  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      metadata: merged,
    })
    .eq('id', runId);

  if (error) {
    console.error('ERROR: failed to mark agent_run as failed', error);
  }
}

export function parseRunId(argv: string[]): string | null {
  const arg = argv.find(a => a.startsWith('--run-id='));
  return arg ? arg.split('=')[1] : null;
}

export async function resolveRunId(runIdArg: string | null): Promise<string> {
  if (runIdArg) return runIdArg;

  const { data, error } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('ERROR: no --run-id provided and no running agent_run found.');
    process.exit(1);
  }

  console.log(`Using latest running agent_run: ${data.id}`);
  return data.id;
}

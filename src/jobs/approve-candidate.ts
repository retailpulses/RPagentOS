import { supabase } from '../lib/supabase.js';
import { parseRunId, resolveRunId } from '../lib/agent-run.js';

export interface ApproveResult {
  approved: boolean;
  candidateId: string | null;
}

export async function approveCandidate(
  client: typeof supabase,
  runId: string,
): Promise<ApproveResult> {
  const { data: candidate, error: queryError } = await client
    .from('promotion_candidates')
    .select('*')
    .eq('status', 'pending')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (queryError) {
    console.error('ERROR: querying pending candidate failed', queryError);
    throw queryError;
  }

  if (!candidate) {
    return { approved: false, candidateId: null };
  }

  const { error: approvalError } = await client.from('human_approvals').insert({
    candidate_id: candidate.id,
    reviewer: 'local-dev',
    action: 'approved',
    comment: 'Approved by local MVP script',
    run_id: runId,
  });

  if (approvalError) {
    console.error('ERROR: inserting human_approval failed', approvalError);
    throw approvalError;
  }

  const { error: updateError } = await client
    .from('promotion_candidates')
    .update({ status: 'approved' })
    .eq('id', candidate.id);

  if (updateError) {
    console.error('ERROR: updating candidate status failed', updateError);
    throw updateError;
  }

  return { approved: true, candidateId: candidate.id };
}

async function main() {
  const runId = await resolveRunId(parseRunId(process.argv));

  const result = await approveCandidate(supabase, runId);

  if (result.approved) {
    console.log(`run_id: ${runId}`);
    console.log(`Approved candidate: ${result.candidateId}`);
  } else {
    console.log('No pending promotion candidate found. Nothing to approve.');
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}

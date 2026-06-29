import { supabase } from '../lib/supabase.js';
import { parseRunId, resolveRunId, completeAgentRun, failAgentRun } from '../lib/agent-run.js';

export interface ExecuteResult {
  created: number;
  skipped: number;
}

export async function executeApprovedMock(
  client: typeof supabase,
  runId: string,
): Promise<ExecuteResult> {
  const { data: candidates, error: queryError } = await client
    .from('promotion_candidates')
    .select('*, listing:listing_id(*)')
    .eq('status', 'approved')
    .eq('run_id', runId);

  if (queryError) {
    console.error('ERROR: querying approved candidates failed', queryError);
    throw queryError;
  }

  if (!candidates || candidates.length === 0) {
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const { data: existing } = await client
      .from('agent_execution_logs')
      .select('id')
      .eq('candidate_id', candidate.id)
      .eq('status', 'success')
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const listing = candidate.listing as Record<string, unknown> | null;

    const { error: insertError } = await client.from('agent_execution_logs').insert({
      candidate_id: candidate.id,
      action_type: 'mock_timesale_execution',
      target_platform: listing?.platform ?? null,
      target_shop_code: listing?.shop_code ?? null,
      status: 'success',
      request_payload: {
        candidate_id: candidate.id,
        candidate_type: candidate.candidate_type,
        suggested_discount_rate: candidate.suggested_discount_rate,
        suggested_price: candidate.suggested_price,
        listing_id: candidate.listing_id,
        listing_title: listing?.title ?? null,
        listing_current_price: listing?.current_price ?? null,
      },
      response_payload: { mock: true, message: 'No real platform action executed' },
      run_id: runId,
    });

    if (insertError) {
      console.error(`ERROR: inserting execution_log for candidate ${candidate.id}`, insertError);
      continue;
    }

    const { error: updateError } = await client
      .from('promotion_candidates')
      .update({ status: 'executed' })
      .eq('id', candidate.id);

    if (updateError) {
      console.error(`ERROR: updating candidate ${candidate.id} status to executed`, updateError);
      continue;
    }

    created++;
  }

  return { created, skipped };
}

async function main() {
  const runId = await resolveRunId(parseRunId(process.argv));

  try {
    const result = await executeApprovedMock(supabase, runId);
    console.log(`run_id: ${runId}`);
    console.log(`Execution logs created: ${result.created}, skipped (already exist): ${result.skipped}`);
    await completeAgentRun(runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failAgentRun(runId, msg);
    process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) {
  main();
}

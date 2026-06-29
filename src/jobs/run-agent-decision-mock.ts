import { supabase } from '../lib/supabase.js';
import { parseRunId, resolveRunId } from '../lib/agent-run.js';

export interface DecisionResult {
  created: number;
  skipped: number;
}

export async function mockDecisions(
  client: typeof supabase,
  runId: string,
): Promise<DecisionResult> {
  const { data: candidates, error: queryError } = await client
    .from('promotion_candidates')
    .select('*, listing:listing_id(*)')
    .eq('status', 'pending')
    .eq('run_id', runId);

  if (queryError) {
    console.error('ERROR: querying promotion_candidates failed', queryError);
    throw queryError;
  }

  if (!candidates || candidates.length === 0) {
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const { data: existing } = await client
      .from('agent_decisions')
      .select('id')
      .eq('candidate_id', candidate.id)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const inputSnapshot = {
      candidate_id: candidate.id,
      candidate_type: candidate.candidate_type,
      reason: candidate.reason,
      suggested_discount_rate: candidate.suggested_discount_rate,
      suggested_price: candidate.suggested_price,
      listing: candidate.listing
        ? {
            id: candidate.listing.id,
            platform: candidate.listing.platform,
            shop_code: candidate.listing.shop_code,
            title: candidate.listing.title,
            current_price: candidate.listing.current_price,
            stock_qty: candidate.listing.stock_qty,
          }
        : null,
    };

    const outputSnapshot = {
      decision: 'recommend',
      confidence: 0.75,
      summary: 'Mock decision for MVP flow validation',
    };

    const { error: insertError } = await client.from('agent_decisions').insert({
      candidate_id: candidate.id,
      agent_name: 'mock-agent',
      model_name: 'mock-local',
      decision: 'recommend',
      confidence: 0.75,
      reasoning_summary: 'Mock decision for MVP flow validation',
      input_snapshot: inputSnapshot,
      output_snapshot: outputSnapshot,
      run_id: runId,
    });

    if (insertError) {
      console.error(`ERROR: inserting decision for candidate ${candidate.id}`, insertError);
      continue;
    }
    created++;
  }

  return { created, skipped };
}

async function main() {
  const runId = await resolveRunId(parseRunId(process.argv));

  const result = await mockDecisions(supabase, runId);

  console.log(`run_id: ${runId}`);
  console.log(`Decisions created: ${result.created}, skipped (already exist): ${result.skipped}`);
}

if (process.argv[1] === import.meta.filename) {
  main();
}

import { supabase } from '../lib/supabase.js';
import { createAgentRun, completeAgentRun, parseRunId } from '../lib/agent-run.js';

const PLATFORM = process.env['AGENT_OS_TARGET_PLATFORM'] || 'mercari';
const SHOP = process.env['AGENT_OS_TARGET_SHOP'] || 'shop4';

export interface GenerateResult {
  created: number;
  skipped: number;
}

export async function generateCandidates(
  client: typeof supabase,
  runId: string,
  platform: string,
  shop: string,
): Promise<GenerateResult> {
  const { data: listings, error } = await client
    .from('platform_listings')
    .select('*')
    .eq('platform', platform)
    .eq('shop_code', shop)
    .eq('listing_status', 'active')
    .gt('stock_qty', 0)
    .not('current_price', 'is', null);

  if (error) {
    console.error('ERROR: querying platform_listings failed', error);
    throw error;
  }

  let created = 0;
  let skipped = 0;

  for (const listing of listings) {
    const { data: existing } = await client
      .from('promotion_candidates')
      .select('id')
      .eq('listing_id', listing.id)
      .eq('candidate_type', 'timesale_test')
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const currentPrice = Number(listing.current_price);
    const suggestedPrice = Math.round(currentPrice * 0.95 * 100) / 100;

    const { error: insertError } = await client
      .from('promotion_candidates')
      .insert({
        listing_id: listing.id,
        candidate_type: 'timesale_test',
        reason: 'Mock rule: active listing with stock and price',
        suggested_discount_rate: 5,
        suggested_price: suggestedPrice,
        status: 'pending',
        run_id: runId,
      });

    if (insertError) {
      console.error(`ERROR: inserting candidate for listing ${listing.id}`, insertError);
      continue;
    }
    created++;
  }

  return { created, skipped };
}

async function main() {
  const run = await createAgentRun({
    runType: 'mock_promotion_flow',
    targetPlatform: PLATFORM,
    targetShopCode: SHOP,
  });

  const result = await generateCandidates(supabase, run.id, PLATFORM, SHOP);

  await completeAgentRun(run.id);

  console.log(`run_id: ${run.id}`);
  console.log(`Candidates created: ${result.created}, skipped (already pending): ${result.skipped}`);
}

if (process.argv[1] === import.meta.filename) {
  main();
}

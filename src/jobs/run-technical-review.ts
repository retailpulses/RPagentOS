/**
 * Job: Run scheduled technical/OCR review for listings matching active policies.
 *
 * Usage:
 *   npm run job:quality:technical-review -- --dry-run --limit 5 --platform amazon
 *   npm run job:quality:technical-review -- --confirm --limit 10 --verbose
 *
 * Options:
 *   --dry-run     Preview what would be reviewed, no mutations
 *   --confirm     Required for actual execution
 *   --limit N     Max listings to review (default 50)
 *   --platform    Filter to specific marketplace (amazon|rakuten|mercari)
 *   --policy-id   Run a specific policy by ID
 *   --verbose     Detailed progress output
 */

import { supabase } from '../lib/supabase.js';
import { runPolicyReview } from '../packages/listing-quality/review-runner.js';
import type { PolicyReviewResult } from '../packages/listing-quality/review-runner.js';
import type { ReviewPolicy, Marketplace, TechnicalReviewOptions } from '../packages/listing-quality/types.js';

function parseArgs(): TechnicalReviewOptions & { policyId?: string } {
  const args = process.argv.slice(2);
  const options: TechnicalReviewOptions & { policyId?: string } = {
    dryRun: false,
    confirm: false,
    limit: 50,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--confirm':
        options.confirm = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i] ?? '50', 10);
        break;
      case '--platform':
        options.platform = args[++i] as Marketplace;
        break;
      case '--policy-id':
        options.policyId = args[++i];
        break;
    }
  }

  return options;
}

async function fetchActivePolicies(platform?: Marketplace, policyId?: string): Promise<ReviewPolicy[]> {
  // Fetch specific policy
  if (policyId) {
    const { data, error } = await supabase
      .from('listing_review_policies')
      .select('*')
      .eq('id', policyId)
      .single();

    if (error) throw new Error(`Policy ${policyId}: ${error.message}`);
    return [data as unknown as ReviewPolicy];
  }

  // Fetch active daily_technical policies
  let query = supabase
    .from('listing_review_policies')
    .select('*')
    .eq('is_active', true)
    .eq('review_type', 'daily_technical');

  if (platform) {
    query = query.eq('marketplace', platform);
  }

  const { data, error } = await query.order('priority', { ascending: true });
  if (error) throw new Error(`Fetch policies: ${error.message}`);

  return (data ?? []) as unknown as ReviewPolicy[];
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Safety guard
  if (!options.dryRun && !options.confirm) {
    console.error('ERROR: --confirm is required for actual execution. Use --dry-run to preview.');
    process.exit(1);
  }

  console.log('=== Listing Quality Technical Review ===\n');
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`Limit: ${options.limit}`);
  if (options.platform) console.log(`Platform: ${options.platform}`);
  console.log();

  // Fetch policies
  const policies = await fetchActivePolicies(options.platform, options.policyId);
  console.log(`Active policies: ${policies.length}`);
  for (const p of policies) {
    console.log(`  - ${p.name} (${p.marketplace}, priority=${p.priority})`);
  }
  console.log();

  if (policies.length === 0) {
    console.log('No active policies found. Seed policies first: npm run job:quality:seed-policies');
    process.exit(0);
  }

  // Run each policy
  let grandReviewed = 0;
  let grandSkipped = 0;
  let grandErrors = 0;

  for (const policy of policies) {
    if (options.verbose) {
      console.log(`\nRunning policy: ${policy.name}`);
    }

    const result: PolicyReviewResult = await runPolicyReview(policy, options);
    grandReviewed += result.reviewed;
    grandSkipped += result.skipped;
    grandErrors += result.errors;

    if (options.verbose && result.outputs.length > 0) {
      const scores = result.outputs
        .filter(o => !o.skipped && o.result?.final_score != null)
        .map((o) => o.result.final_score as number);
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
      console.log(
        `  Reviewed: ${result.reviewed}, skipped: ${result.skipped}, ` +
        `errors: ${result.errors}, avg technical score: ${avgScore}`,
      );
    }
  }

  console.log(
    `\n=== Done: ${grandReviewed} reviewed, ${grandSkipped} skipped, ` +
    `${grandErrors} errors ===`,
  );

  // Exit nonzero on unexpected failures so cron/monitoring can alert
  if (grandErrors > 0) {
    console.error(`ERROR: ${grandErrors} listing review(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

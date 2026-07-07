/**
 * Job: Apply completed Qwen review findings to listing quality review results.
 *
 * Qwen review is queued asynchronously (Phase 4). The bridge worker
 * (qwen-bridge.ts) processes the request and stores results in
 * listing_qwen_reviews. This job reads completed Qwen outputs and enriches
 * the original listing_review_results with Qwen issue flags.
 *
 * Usage:
 *   npm run job:quality:apply-qwen -- --result-id=<uuid>
 *   npm run job:quality:apply-qwen -- --work-item-id=<uuid>
 *   npm run job:quality:apply-qwen -- --pending --limit 10
 *
 * Options:
 *   --result-id=<uuid>     Apply Qwen findings to a specific review result
 *   --work-item-id=<uuid>  Apply Qwen findings for a specific work item
 *   --pending              Find all pending Qwen findings and apply them
 *   --limit N              Max results to process with --pending (default 10)
 *   --verbose              Detailed progress output
 *
 * Qwen findings are additive advisory flags. The deterministic RPagentOS
 * score engine remains authoritative -- Qwen does not own the final score.
 * Score completeness is updated (qwen_visual = true) but the score itself
 * is not recalculated here.
 */

import { supabase } from '../lib/supabase.js';
import {
  applyQwenFindings,
  findPendingQwenReviewResults,
} from '../packages/listing-quality/qwen-review-integration.js';

// ─── Argument parsing ──────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface ApplyOptions {
  resultId?: string;
  workItemId?: string;
  pending: boolean;
  limit: number;
  verbose: boolean;
}

function parseArgs(): ApplyOptions {
  return {
    resultId: argValue('result-id'),
    workItemId: argValue('work-item-id'),
    pending: hasFlag('pending'),
    limit: parseInt(argValue('limit') ?? '10', 10),
    verbose: hasFlag('verbose'),
  };
}

// ─── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Find the review result and Qwen request ID for a given work item.
 * Queries listing_qwen_review_requests by work_item_id, then finds the
 * listing_review_result that has the matching qwen_review_request_id in
 * its raw_outputs_json by scanning recent results with non-null jsonb.
 */
async function findResultByWorkItem(
  workItemId: string,
): Promise<{ resultId: string; requestId: string } | null> {
  // Get all Qwen requests for this work item
  const { data: requests, error: reqErr } = await supabase
    .from('listing_qwen_review_requests')
    .select('id, status')
    .eq('work_item_id', workItemId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (reqErr) {
    console.error(`  Error fetching Qwen requests: ${reqErr.message}`);
    return null;
  }

  if (!requests || requests.length === 0) {
    console.error(`  No Qwen review requests found for work item ${workItemId}`);
    return null;
  }

  const requestIds = (requests as Array<{ id: string; status: string }>).map((r) => r.id);

  // Fetch recent review results that have non-null raw_outputs_json and scan
  // in JS for the matching request ID. The query limit is generous to cover
  // recent reviews without an unbounded scan.
  const { data: results, error: rrErr } = await supabase
    .from('listing_review_results')
    .select('id, raw_outputs_json')
    .not('raw_outputs_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (rrErr) {
    console.error(`  Error fetching review results: ${rrErr.message}`);
    return null;
  }

  const requestIdSet = new Set(requestIds);

  for (const row of (results ?? []) as Array<Record<string, unknown>>) {
    const rawOutputs = row.raw_outputs_json as Record<string, unknown> | null;
    if (
      rawOutputs &&
      typeof rawOutputs.qwen_review_request_id === 'string' &&
      requestIdSet.has(rawOutputs.qwen_review_request_id)
    ) {
      return {
        resultId: row.id as string,
        requestId: rawOutputs.qwen_review_request_id,
      };
    }
  }

  console.error(`  No review result found for work item ${workItemId} with a Qwen request`);
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('=== Apply Qwen Findings ===\n');
  if (options.verbose) console.log(`Options: ${JSON.stringify(options)}`);

  const tasks: Array<{ resultId: string; requestId: string }> = [];

  if (options.resultId) {
    // Single result by ID -- need to find the request ID from raw_outputs_json
    const { data, error } = await supabase
      .from('listing_review_results')
      .select('id, raw_outputs_json')
      .eq('id', options.resultId)
      .single();

    if (error || !data) {
      console.error(`Review result ${options.resultId} not found: ${error?.message ?? 'unknown'}`);
      process.exit(1);
    }

    const rawOutputs = (data as Record<string, unknown>).raw_outputs_json as Record<string, unknown> | null;
    const requestId = rawOutputs?.qwen_review_request_id as string | undefined;

    if (!requestId) {
      console.error(`Review result ${options.resultId} has no qwen_review_request_id in raw_outputs_json`);
      process.exit(1);
    }

    tasks.push({ resultId: options.resultId, requestId });
  } else if (options.workItemId) {
    // Find by work item ID
    const found = await findResultByWorkItem(options.workItemId);
    if (!found) {
      process.exit(1);
    }
    tasks.push(found);
  } else if (options.pending) {
    // Find all pending Qwen findings
    console.log(`Looking for pending Qwen review results (limit=${options.limit})...`);
    const pending = await findPendingQwenReviewResults(options.limit);
    console.log(`  Found ${pending.length} review result(s) with completed Qwen reviews\n`);
    tasks.push(...pending);
  } else {
    console.error('ERROR: Specify --result-id, --work-item-id, or --pending');
    console.error('');
    console.error('Usage:');
    console.error('  npm run job:quality:apply-qwen -- --result-id=<uuid>');
    console.error('  npm run job:quality:apply-qwen -- --work-item-id=<uuid>');
    console.error('  npm run job:quality:apply-qwen -- --pending --limit 10');
    process.exit(1);
  }

  if (tasks.length === 0) {
    console.log('No tasks to process.');
    process.exit(0);
  }

  // Process each task
  let applied = 0;
  let errors = 0;
  let totalIssues = 0;

  for (let i = 0; i < tasks.length; i++) {
    const { resultId, requestId } = tasks[i];
    const label = `[${i + 1}/${tasks.length}]`;

    if (options.verbose) {
      console.log(`  ${label} Applying Qwen findings to result ${resultId}...`);
    }

    const result = await applyQwenFindings(resultId, requestId);

    if (result.error) {
      errors++;
      console.error(`  ${label} Error: ${result.error}`);
    } else {
      applied++;
      totalIssues += result.issuesEnriched;
      if (options.verbose) {
        console.log(
          `  ${label} Done: ${result.issuesEnriched} Qwen issue(s) enriched`,
        );
      } else {
        process.stdout.write('.');
      }
    }
  }

  if (!options.verbose) {
    process.stdout.write('\n');
  }

  console.log(
    `\n=== Done: ${applied} applied, ${errors} errors, ${totalIssues} total Qwen issues ===`,
  );

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

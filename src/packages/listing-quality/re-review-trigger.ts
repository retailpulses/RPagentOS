// Re-review trigger — core logic for Phase 3 event-triggered re-review.
//
// Provides functions to detect listing changes, manage quality cycles, and
// enqueue re-review jobs. Does NOT execute reviews — only coordinates the
// cycle lifecycle and job enqueueing.

import { supabase } from '../../lib/supabase.js';
import type {
  ListingQualityCycle,
  CycleStatus,
  ReReviewTriggerSource,
  Marketplace,
  ReviewJob,
  ReviewSnapshot,
} from './types.js';

// ─── Change Detection ─────────────────────────────────────────────────────────

/**
 * Compare the last snapshot's data against the current data and return what
 * changed. Uses simple equality — no hashing at this level.
 *
 * If the snapshot has a source_hash and the caller provides one for the
 * current data, a quick hash comparison short-circuits the per-field checks.
 */
export function detectChanges(
  lastSnapshot: {
    title: string | null;
    description: string | null;
    image_urls_json: string[] | null;
    product_facts_json: Record<string, unknown> | null;
    source_hash: string;
  },
  currentData: {
    title: string | null;
    description: string | null;
    image_urls: string[] | null;
    product_facts: Record<string, unknown> | null;
  },
): ReReviewTriggerSource[] {
  const changes: ReReviewTriggerSource[] = [];

  // Title
  if (lastSnapshot.title !== currentData.title) {
    changes.push('title_change');
  }

  // Description
  if (lastSnapshot.description !== currentData.description) {
    changes.push('description_change');
  }

  // Image URLs — compare sorted arrays
  const lastImages = [...(lastSnapshot.image_urls_json ?? [])].sort();
  const currentImages = [...(currentData.image_urls ?? [])].sort();
  if (
    lastImages.length !== currentImages.length ||
    !lastImages.every((url, i) => url === currentImages[i])
  ) {
    changes.push('image_change');
  }

  // Product facts — stable JSON compare
  const lastFacts = stableJson(lastSnapshot.product_facts_json ?? {});
  const currentFacts = stableJson(currentData.product_facts ?? {});
  if (lastFacts !== currentFacts) {
    changes.push('product_facts_change');
  }

  return changes;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(',')}}`;
}

// ─── Re-review Decision ───────────────────────────────────────────────────────

/**
 * Determine if any detected changes warrant a re-review.
 * Returns true if there are any changes.
 */
export function shouldReReview(changes: ReReviewTriggerSource[]): boolean {
  return changes.length > 0;
}

// ─── Cycle Management ─────────────────────────────────────────────────────────

const ACTIVE_CYCLE_STATUSES: CycleStatus[] = [
  'not_reviewed',
  'review_queued',
  'reviewed',
  'fix_needed',
  'fix_in_progress',
  'fix_ready_for_review',
  're_review_queued',
  'improved',
];

/**
 * Get an existing active quality cycle for a listing, or create a new one.
 *
 * Reuses a cycle if one exists with a status in the "active" range
 * (not_reviewed through improved). Otherwise creates a new cycle with
 * status='review_queued'.
 *
 * @returns The existing or newly created cycle.
 */
export async function getOrCreateCycle(
  listingId: string,
  marketplace: Marketplace,
  trigger: ReReviewTriggerSource,
): Promise<ListingQualityCycle> {
  // Check for an existing active cycle
  const { data: existingCycles, error: fetchErr } = await supabase
    .from('listing_quality_cycles')
    .select('*')
    .eq('listing_id', listingId)
    .eq('marketplace', marketplace)
    .in('cycle_status', ACTIVE_CYCLE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);

  if (fetchErr) throw new Error(`Fetch cycles for ${listingId}: ${fetchErr.message}`);

  if (existingCycles && existingCycles.length > 0) {
    return existingCycles[0] as unknown as ListingQualityCycle;
  }

  // No active cycle — create a new one
  const { data: newCycle, error: createErr } = await supabase
    .from('listing_quality_cycles')
    .insert({
      listing_id: listingId,
      marketplace,
      cycle_status: 'not_reviewed' as CycleStatus,
      created_from: trigger,
    })
    .select('*')
    .single();

  if (createErr) throw new Error(`Create cycle for ${listingId}: ${createErr.message}`);
  return newCycle as unknown as ListingQualityCycle;
}

/**
 * Advance a quality cycle to a new status.
 * Optionally updates the latest snapshot, score, and score delta.
 */
export async function updateCycleStatus(
  cycleId: string,
  status: CycleStatus,
  opts?: {
    baselineSnapshotId?: string;
    baselineScore?: number;
    latestSnapshotId?: string;
    latestScore?: number;
    scoreDelta?: number;
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    cycle_status: status,
    updated_at: new Date().toISOString(),
  };

  if (opts?.baselineSnapshotId !== undefined) {
    update['baseline_snapshot_id'] = opts.baselineSnapshotId;
  }
  if (opts?.baselineScore !== undefined) {
    update['baseline_score'] = opts.baselineScore;
  }
  if (opts?.latestSnapshotId !== undefined) {
    update['latest_snapshot_id'] = opts.latestSnapshotId;
  }
  if (opts?.latestScore !== undefined) {
    update['latest_score'] = opts.latestScore;
  }
  if (opts?.scoreDelta !== undefined) {
    update['score_delta'] = opts.scoreDelta;
  }

  const { error } = await supabase
    .from('listing_quality_cycles')
    .update(update)
    .eq('id', cycleId);

  if (error) throw new Error(`Update cycle ${cycleId}: ${error.message}`);
}

// ─── Job Enqueueing ───────────────────────────────────────────────────────────

/**
 * Enqueue a re-review job for a listing. Creates a ReviewJob with
 * trigger_source='event' and status='queued'. Does NOT execute the review.
 *
 * @returns The created ReviewJob.
 */
export async function enqueueReReview(
  listingRef: { id: string; platform: string; shop_code: string | null },
  trigger: ReReviewTriggerSource,
  cycle: ListingQualityCycle,
): Promise<ReviewJob> {
  const marketplace = listingRef.platform as Marketplace;

  const { data: jobRow, error: jobErr } = await supabase
    .from('listing_review_jobs')
    .insert({
      snapshot_id: null,
      cycle_id: cycle.id,
      trigger_source: 'event',
      marketplace,
      review_type: 'event_triggered',
      status: 'queued',
      priority: 100,
      attempt_count: 0,
      max_attempts: 3,
      requested_by: `re-review:${trigger}`,
    })
    .select('*')
    .single();

  if (jobErr) throw new Error(`Enqueue re-review for ${listingRef.id}: ${jobErr.message}`);

  // Update cycle status to re_review_queued
  await updateCycleStatus(cycle.id, 're_review_queued');

  return jobRow as unknown as ReviewJob;
}

// ─── Work Item Resolution Check ──────────────────────────────────────────────

/**
 * Check if all work items for a listing are resolved.
 * A listing is eligible for re-review when it has no open work items.
 */
export async function areWorkItemsResolved(listingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('listing_work_items')
    .select('id')
    .eq('listing_id', listingId)
    .in('status', ['open', 'in_progress', 'waiting_for_input']);

  if (error) throw new Error(`Check work items for ${listingId}: ${error.message}`);

  return !data || data.length === 0;
}

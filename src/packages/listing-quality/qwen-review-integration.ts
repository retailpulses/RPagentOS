// Phase 4: Queued Async Qwen Visual Review — Integration.
//
// Bridges the listing quality review pipeline with the existing queued Qwen
// review system (qwen-bridge.ts / listing_qwen_review_requests).
//
// Key design rules:
//   - Queue every Qwen review request — never block the UI or the review job.
//   - Qwen does NOT own the final score. Findings are advisory flags.
//   - Fail gracefully: if Qwen is unavailable, the review still completes.
//   - Reuse existing infra (qwen-review.ts, qwen-bridge.ts) — no duplicates.

import { supabase } from '../../lib/supabase.js';
import type {
  Marketplace,
  QualityIssue,
  ReviewPolicy,
  ReviewResult,
  ReviewSnapshot,
  SnapshotImage,
} from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Max images to include in a single Qwen review request (design doc limit). */
const MAX_IMAGES_PER_REQUEST = 5;

/** Default priority used when no severe issues exist. */
const DEFAULT_PRIORITY = 5;

/** Map issue severity to numeric priority (higher = more urgent). */
const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 10,
  high: 7,
  medium: 5,
  low: 3,
};

/** Default confidence for Qwen-discovered issues. */
const QWEN_ISSUE_CONFIDENCE = 0.7;

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build the target_key used to look up the work item created from this review.
 * Must match the logic in work-item-factory.ts::createWorkItemsFromReview.
 */
function buildTargetKey(
  marketplace: string,
  shopCode: string | null,
  listingId: string,
): string {
  return [
    'audit_existing_listing',
    marketplace,
    shopCode ?? '',
    'listing',
    listingId,
  ].join(':');
}

/**
 * Determine numeric priority from the worst issue severity found in the result.
 */
function computePriority(issues: QualityIssue[]): number {
  const worst = issues.reduce(
    (max, issue) => Math.max(max, SEVERITY_PRIORITY[issue.severity] ?? 0),
    0,
  );
  return Math.max(worst, DEFAULT_PRIORITY);
}

// ─── Qwen Review Queue Operations ──────────────────────────────────────────────

/**
 * Enqueue a Qwen visual review request for a listing after technical review
 * completes.
 *
 * This does NOT call Ollama. It creates a `listing_qwen_review_requests` row
 * with the work item ID, image URLs, and priority. The bridge worker
 * (`qwen-bridge.ts`) picks it up and processes it asynchronously.
 *
 * Also stores the request ID on the review result's `raw_outputs_json` under
 * `qwen_review_request_id` for traceability.
 *
 * @returns `{ requestId, error }` — `requestId` is null if enqueue failed.
 */
export async function enqueueQwenReview(
  result: ReviewResult,
  snapshot: ReviewSnapshot,
  snapshotImages: SnapshotImage[],
  policy: ReviewPolicy,
): Promise<{ requestId: string | null; error: string | null }> {
  try {
    // 1. Find the work item created from this review by its target_key.
    const targetKey = buildTargetKey(
      snapshot.marketplace,
      snapshot.shop_code,
      snapshot.listing_id,
    );

    const { data: workItems, error: wiError } = await supabase
      .from('listing_work_items')
      .select('id')
      .eq('target_key', targetKey)
      .order('created_at', { ascending: false })
      .limit(1);

    if (wiError) throw new Error(`Lookup work item: ${wiError.message}`);

    const workItemId = workItems?.[0]?.id;
    if (!workItemId) {
      return { requestId: null, error: 'No work item found for this review' };
    }

    // 2. Collect loaded image URLs (max 5, sorted by image_index).
    const loadedImages = snapshotImages
      .filter((img) => img.loaded && img.image_url)
      .sort((a, b) => a.image_index - b.image_index)
      .slice(0, MAX_IMAGES_PER_REQUEST);

    const imageUrls = loadedImages.map((img) => img.image_url as string);

    // 3. Determine request priority from worst issue severity.
    const priority = computePriority(result.issues_json ?? []);

    // 4. Create the queue request.
    const { data: request, error: reqError } = await supabase
      .from('listing_qwen_review_requests')
      .insert({
        work_item_id: workItemId,
        status: 'queued',
        image_urls_json: imageUrls,
        prompt_profile: 'listing_quality_visual',
        priority,
        max_attempts: 3,
        timeout_seconds: 240,
      })
      .select('id')
      .single();

    if (reqError) throw new Error(`Create Qwen request: ${reqError.message}`);

    const requestId = String((request as { id: string }).id);

    // 5. Store the request ID on the review result's raw_outputs_json so the
    //    apply-qwen-findings CLI job can trace back to it later.
    const updatedRawOutputs = {
      ...result.raw_outputs_json,
      qwen_review_request_id: requestId,
    };

    const { error: storeErr } = await supabase
      .from('listing_review_results')
      .update({ raw_outputs_json: updatedRawOutputs })
      .eq('id', result.id);

    if (storeErr) {
      console.error(
        `enqueueQwenReview: failed to store request ID on result ${result.id}: ${storeErr.message}`,
      );
    }

    return { requestId, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`enqueueQwenReview: ${message}`);
    return { requestId: null, error: message };
  }
}

// ─── Qwen Status Checks ────────────────────────────────────────────────────────

/**
 * Check whether a Qwen review request has been processed to completion.
 * A request is "complete" when its status is 'completed' AND the bridge
 * worker has stored a `review_id` linking to `listing_qwen_reviews`.
 */
export async function isQwenReviewComplete(requestId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('listing_qwen_review_requests')
      .select('status, review_id')
      .eq('id', requestId)
      .single();

    if (error || !data) return false;

    const row = data as { status: string; review_id: string | null };
    return row.status === 'completed' && row.review_id !== null;
  } catch {
    return false;
  }
}

// ─── Apply Qwen Findings to Review Results ────────────────────────────────────

/**
 * Apply Qwen AI findings from a completed review to the original listing quality
 * review result.
 *
 * Reads the Qwen review output (`listing_qwen_reviews`), converts Qwen issue
 * flags to `QualityIssue[]` with `source: 'qwen_visual'`, appends them to the
 * review result's `issues_json`, and updates `score_completeness_json.qwen_visual`
 * to `true`.
 *
 * The review result's final score is NOT recalculated here — Qwen findings are
 * advisory. Re-scoring is a separate, lightweight operation.
 */
export async function applyQwenFindings(
  resultId: string,
  reviewRequestId: string,
): Promise<{ issuesEnriched: number; error: string | null }> {
  try {
    // 1. Fetch the Qwen review request and verify it is complete.
    const { data: req, error: reqErr } = await supabase
      .from('listing_qwen_review_requests')
      .select('status, review_id, work_item_id')
      .eq('id', reviewRequestId)
      .single();

    if (reqErr) {
      throw new Error(`Fetch Qwen request ${reviewRequestId}: ${reqErr.message}`);
    }

    const request = req as {
      status: string;
      review_id: string | null;
      work_item_id: string;
    };

    if (request.status !== 'completed') {
      return {
        issuesEnriched: 0,
        error: `Qwen request ${reviewRequestId} status=${request.status}, expected 'completed'`,
      };
    }

    if (!request.review_id) {
      return {
        issuesEnriched: 0,
        error: `Qwen request ${reviewRequestId} has no review_id (bridge may have failed)`,
      };
    }

    // 2. Fetch the Qwen review output.
    const { data: qwenReview, error: qrErr } = await supabase
      .from('listing_qwen_reviews')
      .select('issues, risk_level, confidence, summary, llm_model')
      .eq('id', request.review_id)
      .single();

    if (qrErr) {
      throw new Error(`Fetch Qwen review ${request.review_id}: ${qrErr.message}`);
    }

    const qwenRow = qwenReview as {
      issues: Array<Record<string, unknown>>;
      risk_level?: string;
      confidence?: number | null;
      summary?: string | null;
      llm_model?: string;
    };

    if (!qwenRow.issues || qwenRow.issues.length === 0) {
      // No Qwen issues to apply — still mark completeness so we don't retry.
      await markQwenApplied(resultId);
      return { issuesEnriched: 0, error: null };
    }

    // 3. Fetch the review result to get its current state and marketplace.
    const { data: reviewRow, error: rrErr } = await supabase
      .from('listing_review_results')
      .select('*, listing_review_snapshots!inner(marketplace)')
      .eq('id', resultId)
      .single();

    if (rrErr) {
      throw new Error(`Fetch review result ${resultId}: ${rrErr.message}`);
    }

    const reviewResult = reviewRow as Record<string, unknown>;
    const snapshotData = reviewResult['listing_review_snapshots'] as {
      marketplace: string;
    };
    const marketplace = snapshotData.marketplace as Marketplace;

    // 4. Convert Qwen issues to QualityIssue[] with source='qwen_visual'.
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    const qwenIssues: QualityIssue[] = [];

    for (const raw of qwenRow.issues) {
      const issueType = typeof raw.type === 'string' ? raw.type.trim() : null;
      if (!issueType) continue;

      const severity =
        typeof raw.severity === 'string' && validSeverities.includes(raw.severity)
          ? (raw.severity as QualityIssue['severity'])
          : 'medium';

      qwenIssues.push({
        type: issueType,
        severity,
        confidence: QWEN_ISSUE_CONFIDENCE,
        source: 'qwen_visual',
        marketplace,
        affected_image_indexes: [],
        evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
        operator_note:
          typeof raw.operator_note === 'string'
            ? raw.operator_note
            : `Qwen flagged: ${issueType}`,
        requires_human_approval: true,
        suggested_owner: null,
        expected_impact: null,
      });
    }

    if (qwenIssues.length === 0) {
      await markQwenApplied(resultId);
      return { issuesEnriched: 0, error: null };
    }

    // 5. Merge Qwen issues with existing issues.
    const existingIssues = (
      Array.isArray(reviewResult.issues_json)
        ? reviewResult.issues_json
        : []
    ) as QualityIssue[];

    const mergedIssues = [...existingIssues, ...qwenIssues];

    // 6. Determine updated review_completeness.
    const currentCompleteness = reviewResult.review_completeness as string | null;
    const newCompleteness = upgradeReviewCompleteness(currentCompleteness);

    // 7. Update score_completeness_json to mark Qwen as complete.
    const currentScoreCompleteness = (
      reviewResult.score_completeness_json &&
      typeof reviewResult.score_completeness_json === 'object'
        ? (reviewResult.score_completeness_json as Record<string, unknown>)
        : {}
    );

    const updatedScoreCompleteness = {
      ...currentScoreCompleteness,
      qwen_visual: true,
    };

    // 8. Persist the updates.
    const { error: updateErr } = await supabase
      .from('listing_review_results')
      .update({
        issues_json: mergedIssues as unknown as Record<string, unknown>[],
        review_completeness: newCompleteness,
        score_completeness_json: updatedScoreCompleteness,
      })
      .eq('id', resultId);

    if (updateErr) {
      throw new Error(`Update review result ${resultId}: ${updateErr.message}`);
    }

    return {
      issuesEnriched: qwenIssues.length,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`applyQwenFindings: ${message}`);
    return { issuesEnriched: 0, error: message };
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Upgrade review_completeness to include Qwen when appropriate.
 *
 * Rules:
 *   - 'technical_ocr' → 'technical_ocr_qwen'
 *   - 'technical_ocr_marketplace' → 'technical_ocr_qwen'
 *   - 'technical_only' → 'technical_ocr_qwen'
 *   - Already includes qwen or full_review → unchanged
 *   - Unknown/null → 'technical_ocr_qwen'
 */
function upgradeReviewCompleteness(current: string | null): string {
  const qwenIncluded = ['technical_ocr_qwen', 'full_review'];
  if (current && qwenIncluded.includes(current)) {
    return current; // Already includes Qwen
  }
  if (
    current === 'technical_ocr' ||
    current === 'technical_ocr_marketplace' ||
    current === 'technical_only' ||
    current === null
  ) {
    return 'technical_ocr_qwen';
  }
  return current ?? 'technical_ocr_qwen';
}

/**
 * Mark a review result's Qwen visual score completeness as applied (no-op when
 * there are no Qwen issues to enrich). Used when the Qwen review completed but
 * returned no actionable issues.
 */
async function markQwenApplied(resultId: string): Promise<void> {
  try {
    // Fetch current score_completeness
    const { data, error } = await supabase
      .from('listing_review_results')
      .select('score_completeness_json')
      .eq('id', resultId)
      .single();

    if (error || !data) return;

    const current = (data as { score_completeness_json: Record<string, unknown> })
      .score_completeness_json;

    await supabase
      .from('listing_review_results')
      .update({
        score_completeness_json: {
          ...current,
          qwen_visual: true,
        },
      })
      .eq('id', resultId);
  } catch {
    // Non-fatal
  }
}

// ─── Pending Qwen Discovery ────────────────────────────────────────────────────

/**
 * Find review results that have a Qwen review request enqueued but whose Qwen
 * findings have not yet been applied.
 *
 * This queries `listing_review_results` where:
 *   - `raw_outputs_json->>qwen_review_request_id` is set
 *   - `score_completeness_json->>qwen_visual` is NOT true
 *
 * Returns up to `limit` pairs of `{ resultId, requestId }` for completed
 * Qwen requests that are ready to be applied.
 */
export async function findPendingQwenReviewResults(
  limit: number,
): Promise<Array<{ resultId: string; requestId: string }>> {
  // Fetch review results that have a qwen_review_request_id stored.
  const { data, error } = await supabase
    .from('listing_review_results')
    .select('id, raw_outputs_json, score_completeness_json')
    .not('raw_outputs_json', 'is', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Fetch review results: ${error.message}`);

  const candidates: Array<{ resultId: string; requestId: string }> = [];

  for (const row of data ?? []) {
    if (candidates.length >= limit * 2) break;

    const r = row as Record<string, unknown>;
    const rawOutputs = r.raw_outputs_json as Record<string, unknown> | null;

    if (!rawOutputs || typeof rawOutputs.qwen_review_request_id !== 'string') {
      continue;
    }

    const requestId = rawOutputs.qwen_review_request_id;

    // Skip if Qwen findings have already been applied.
    const scoreCompleteness = r.score_completeness_json as Record<string, unknown> | null;
    if (scoreCompleteness?.qwen_visual === true) continue;

    candidates.push({ resultId: r.id as string, requestId });
  }

  if (candidates.length === 0) return [];

  // Batch-check which Qwen requests have completed.
  const requestIds = candidates.map((c) => c.requestId);
  const { data: requests, error: reqErr } = await supabase
    .from('listing_qwen_review_requests')
    .select('id, status')
    .in('id', requestIds);

  if (reqErr) throw new Error(`Fetch Qwen request statuses: ${reqErr.message}`);

  const completedIds = new Set(
    ((requests ?? []) as Array<{ id: string; status: string }>)
      .filter((r) => r.status === 'completed')
      .map((r) => r.id),
  );

  const pending: Array<{ resultId: string; requestId: string }> = [];
  for (const c of candidates) {
    if (completedIds.has(c.requestId)) {
      pending.push(c);
      if (pending.length >= limit) break;
    }
  }

  return pending;
}

// Review runner — orchestrates the technical/OCR review pipeline.
//
// Phase 1: snapshot → health check → OCR → duplicate detection → result.
// Phase 2: + marketplace score engine → recommendations → work items.
// Qwen visual review is deferred to Phase 4.

import { captureSnapshot } from './snapshot-capture.js';
import { checkImageHealthBatch } from './image-health-check.js';
import { runOcrForImage, detectOcrKeywords } from './ocr-extraction.js';
import { runQwenVisualReview } from './qwen-pipeline.js';
import { detectDuplicates } from './duplicate-detection.js';
import { computeScores, scoreToGrade, gradeLabel } from './score-engine.js';
import { getIssueDefinition } from './issue-taxonomy.js';
import { createWorkItemsFromReview } from './work-item-factory.js';
import {
  getOrCreateCycle,
  updateCycleStatus,
  enqueueReReview,
} from './re-review-trigger.js';
import { supabase } from '../../lib/supabase.js';
import type { IssueType } from './issue-taxonomy.js';
import type {
  ReviewPolicy,
  ReviewJob,
  ReviewRunOutput,
  ReviewResult,
  SnapshotImage,
  ScoreCompleteness,
  ScoreEngineInput,
  QualityIssue,
  TechnicalReviewOptions,
  Marketplace,
  ReviewType,
  CycleStatus,
  ReReviewTriggerSource,
  ListingQualityCycle,
} from './types.js';

// ─── Scoring version ──────────────────────────────────────────────────────────

const SCORING_VERSION = '2.0.0';

// ─── Policy-based listing selection ───────────────────────────────────────────

interface ListingRef {
  id: string;
  platform: string;
  shop_code: string | null;
  product_spu_id: string | null;
  listing_status: string | null;
}

/**
 * Get listing IDs that have at least one image row in platform_listing_images.
 * Filters by an optional list of candidate listing IDs to avoid global scans.
 * Paginates properly — no 1000-row truncation.
 *
 * If candidateIds is empty or null, returns an empty set — never falls back to
 * a broad unfiltered scan.
 */
async function getListingIdsWithImages(
  candidateIds: string[] | null,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const effectiveCandidateIds = candidateIds ?? [];

  if (effectiveCandidateIds.length === 0) {
    return ids; // empty — no broad scan
  }

  // Query images filtered by candidate listing IDs, batched to avoid
  // URL-length errors and paginated to avoid 1000-row truncation.
  const batchSize = 500;
  const pageSize = 1000;

  for (let i = 0; i < effectiveCandidateIds.length; i += batchSize) {
    const batch = effectiveCandidateIds.slice(i, i + batchSize);
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('platform_listing_images')
        .select('listing_id')
        .in('listing_id', batch)
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(`Fetch images for candidate batch: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) ids.add(r.listing_id as string);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  return ids;
}

/**
 * Execute the final listing query, batching the IN clause when the ID list
 * is large to avoid hitting PostgREST URL/query limits (cap ~500 IDs per batch).
 */
async function fetchListingsWithBatchedIds(
  platform: string,
  listingStatus: string,
  idFilter: string[] | null,
  spuIdFilter: string[] | null,
  limit: number,
): Promise<ListingRef[]> {
  const COLS = 'id,platform,shop_code,product_spu_id,listing_status';

  // Small or no ID filter → single query
  if (!idFilter || idFilter.length <= 500) {
    let query = supabase
      .from('platform_listings')
      .select(COLS)
      .eq('platform', platform)
      .eq('listing_status', listingStatus);

    if (idFilter && idFilter.length > 0) {
      query = query.in('id', idFilter);
    }
    if (spuIdFilter && spuIdFilter.length > 0) {
      query = query.in('product_spu_id', spuIdFilter);
    }

    const { data, error } = await query
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Select listings: ${error.message}`);
    return (data ?? []) as unknown as ListingRef[];
  }

  // Large ID list — batch queries to stay under PostgREST limits
  const sorted = [...idFilter].sort();
  const results: ListingRef[] = [];

  for (let i = 0; i < sorted.length && results.length < limit; i += 500) {
    const batch = sorted.slice(i, i + 500);
    let batchQuery = supabase
      .from('platform_listings')
      .select(COLS)
      .eq('platform', platform)
      .eq('listing_status', listingStatus)
      .in('id', batch);

    if (spuIdFilter && spuIdFilter.length > 0) {
      batchQuery = batchQuery.in('product_spu_id', spuIdFilter);
    }

    const { data, error } = await batchQuery
      .order('id', { ascending: true })
      .limit(limit - results.length);
    if (error) throw new Error(`Select listings batch: ${error.message}`);
    if (data) results.push(...(data as unknown as ListingRef[]));
  }

  return results;
}

async function selectListingsForPolicy(
  policy: ReviewPolicy,
  limit: number,
  platform?: Marketplace,
): Promise<ListingRef[]> {
  const targetPlatform = platform ?? policy.marketplace;

  switch (policy.scope_type) {
    case 'hero_products': {
      const { data: heroSpus, error: heroErr } = await supabase
        .from('merchandising_focus_items')
        .select('product_spu_id')
        .eq('focus_type', 'hero')
        .eq('status', 'active');
      if (heroErr) throw new Error(`Fetch hero SPUs: ${heroErr.message}`);

      if (!heroSpus || heroSpus.length === 0) return [];
      const spuIds = heroSpus.map((r) => r.product_spu_id);
      return fetchListingsWithBatchedIds(targetPlatform, 'active', null, spuIds, limit);
    }

    case 'all_active': {
      return fetchListingsWithBatchedIds(targetPlatform, 'active', null, null, limit);
    }

    case 'active_with_images': {
      const { data: activeListings, error: activeErr } = await supabase
        .from('platform_listings')
        .select('id')
        .eq('platform', targetPlatform)
        .eq('listing_status', 'active');
      if (activeErr) throw new Error(`Fetch active listings: ${activeErr.message}`);

      const candidateIds = (activeListings ?? []).map((r) => r.id as string);
      if (candidateIds.length === 0) return [];

      const idsWithImages = await getListingIdsWithImages(candidateIds);
      if (idsWithImages.size === 0) return [];

      return fetchListingsWithBatchedIds(targetPlatform, 'active', [...idsWithImages], null, limit);
    }

    case 'curated':
    default: {
      // Curated = hero products + active + with images
      const { data: heroSpus, error: heroErr } = await supabase
        .from('merchandising_focus_items')
        .select('product_spu_id')
        .eq('focus_type', 'hero')
        .eq('status', 'active');
      if (heroErr) throw new Error(`Fetch hero SPUs: ${heroErr.message}`);

      const spuIds = (heroSpus ?? []).map((r) => r.product_spu_id);

      // Get candidate listing IDs (active + optionally hero-filtered)
      let candidateQuery = supabase
        .from('platform_listings')
        .select('id')
        .eq('platform', targetPlatform)
        .eq('listing_status', 'active');

      if (spuIds.length > 0) {
        candidateQuery = candidateQuery.in('product_spu_id', spuIds);
      }

      const { data: candidateListings, error: candErr } = await candidateQuery;
      if (candErr) throw new Error(`Fetch curated candidates: ${candErr.message}`);

      const candidateIds = (candidateListings ?? []).map((r) => r.id as string);
      if (candidateIds.length === 0) return [];

      const idsWithImages = await getListingIdsWithImages(candidateIds);
      if (idsWithImages.size === 0) return [];

      // spuIds already applied via candidateQuery, but pass as safety double-filter
      return fetchListingsWithBatchedIds(
        targetPlatform, 'active', [...idsWithImages],
        spuIds.length > 0 ? spuIds : null, limit,
      );
    }
  }
}

// ─── Issue generation from technical findings ─────────────────────────────────
//
// Phase 2: each issue type is registered in the taxonomy (issue-taxonomy.ts).
// The generation functions look up default severity, source, and operator note
// from the registry, then override as needed for the specific context.

function makeIssue(
  type: IssueType,
  marketplace: Marketplace,
  overrides: Partial<Pick<QualityIssue, 'severity' | 'confidence' | 'affected_image_indexes' | 'evidence' | 'operator_note' | 'expected_impact'>> & {
    requires_human_approval?: boolean;
    suggested_owner?: string | null;
  },
): QualityIssue {
  const def = getIssueDefinition(type);
  return {
    type,
    severity: overrides.severity ?? def.defaultSeverity,
    confidence: overrides.confidence ?? 1.0,
    source: def.defaultSource,
    marketplace,
    affected_image_indexes: overrides.affected_image_indexes ?? [],
    evidence: overrides.evidence ?? '',
    operator_note: overrides.operator_note ?? def.operatorNoteTemplate,
    requires_human_approval: overrides.requires_human_approval ?? false,
    suggested_owner: overrides.suggested_owner ?? null,
    expected_impact: overrides.expected_impact ?? null,
  };
}

function generateTechnicalIssues(
  snapshotImages: SnapshotImage[],
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // Broken images
  const broken = snapshotImages.filter((img) => !img.loaded);
  if (broken.length > 0) {
    const mainBroken = broken.some((img) => img.is_main_image);
    issues.push(makeIssue('broken_image_url', marketplace, {
      severity: mainBroken ? 'critical' : 'high',
      affected_image_indexes: broken.map((img) => img.image_index),
      evidence: `${broken.length} image(s) failed to load: ${broken.map((img) => img.image_url).join(', ')}`,
      operator_note: mainBroken
        ? 'Main image is broken — listing may not display correctly.'
        : 'Some listing images failed to load.',
    }));

    // If main image is broken, also flag as missing_main_image
    if (mainBroken) {
      issues.push(makeIssue('missing_main_image', marketplace, {
        severity: 'critical',
        affected_image_indexes: broken.filter((img) => img.is_main_image).map((img) => img.image_index),
        evidence: 'Main image failed to load.',
        operator_note: 'No main image detected. Listing may not display correctly.',
      }));
    }
  }

  // Low-resolution images
  const lowRes = snapshotImages.filter(
    (img) => img.loaded && img.width !== null && img.height !== null &&
      (img.width < 200 || img.height < 200),
  );
  if (lowRes.length > 0) {
    issues.push(makeIssue('image_low_resolution', marketplace, {
      affected_image_indexes: lowRes.map((img) => img.image_index),
      evidence: `Images below 200px dimension: ${lowRes.map((img) => `${img.image_index} (${img.width}x${img.height})`).join(', ')}`,
    }));
  }

  // Weak main image: loaded but low resolution
  const mainImg = snapshotImages.find((img) => img.is_main_image);
  if (mainImg && mainImg.loaded && mainImg.width !== null && mainImg.height !== null) {
    if (mainImg.width < 500 || mainImg.height < 500) {
      issues.push(makeIssue('weak_main_image', marketplace, {
        affected_image_indexes: [mainImg.image_index],
        evidence: `Main image is low resolution: ${mainImg.width}x${mainImg.height}`,
      }));
    }
  }

  // Image count low
  const loadedCount = snapshotImages.filter((img) => img.loaded).length;
  if (loadedCount < 3) {
    issues.push(makeIssue('image_count_low', marketplace, {
      severity: loadedCount === 0 ? 'critical' : loadedCount === 1 ? 'high' : 'medium',
      affected_image_indexes: snapshotImages.map((img) => img.image_index),
      evidence: `Only ${loadedCount} loaded image(s) out of ${snapshotImages.length} total.`,
      operator_note: `Only ${loadedCount} image(s) — marketplace recommends more. Add more images.`,
    }));
  }

  return issues;
}

function generateDuplicateIssues(
  snapshotImages: SnapshotImage[],
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  const healthResults = snapshotImages.map((img) => ({
    image_index: img.image_index,
    image_url: img.image_url ?? '',
    loaded: img.loaded,
    http_status: img.http_status,
    width: img.width,
    height: img.height,
    byte_size: img.byte_size,
    content_hash: img.content_hash,
    url_hash: img.url_hash ?? '',
    load_error: img.load_error,
  }));

  const { urlDuplicates, contentDuplicates } = detectDuplicates(healthResults);

  for (const group of urlDuplicates) {
    issues.push(makeIssue('duplicate_url', marketplace, {
      affected_image_indexes: group.image_indexes,
      evidence: `Same URL used at positions: ${group.image_indexes.join(', ')}`,
    }));
  }

  for (const group of contentDuplicates) {
    issues.push(makeIssue('duplicate_content', marketplace, {
      affected_image_indexes: group.image_indexes,
      evidence: `Identical image content at different URLs, positions: ${group.image_indexes.join(', ')}`,
    }));
  }

  return issues;
}

function generateOcrIssues(
  snapshotImages: SnapshotImage[],
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const img of snapshotImages) {
    if (!img.ocr_text || img.ocr_text.length === 0) continue;

    const keywords = detectOcrKeywords(img.ocr_text);

    if (keywords.has_claim_words) {
      issues.push(makeIssue('forbidden_claims', marketplace, {
        severity: 'medium',
        confidence: 0.6,
        affected_image_indexes: [img.image_index],
        evidence: `Potentially risky claims detected in image ${img.image_index} OCR text.`,
        operator_note: 'Listing may contain forbidden claims. Review and remove if confirmed.',
      }));
    }
  }

  return issues;
}

// ─── Recommendation generation ────────────────────────────────────────────────

interface FixRecommendation {
  fix_type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  affected_image_indexes: number[];
  requires_human_approval: boolean;
}

function generateRecommendations(
  issues: QualityIssue[],
  finalScore: number,
  marketplace: Marketplace,
): FixRecommendation[] {
  const recs: FixRecommendation[] = [];
  const seenTypes = new Set<string>();

  for (const issue of issues) {
    // One recommendation per unique issue type
    if (seenTypes.has(issue.type)) continue;
    seenTypes.add(issue.type);

    const def = getIssueDefinition(issue.type as IssueType);

    switch (def.category) {
      case 'image_technical':
        recs.push({
          fix_type: 'replace_broken_image',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: issue.affected_image_indexes,
          requires_human_approval: issue.severity === 'critical',
        });
        break;
      case 'image_content':
        recs.push({
          fix_type: issue.type === 'image_count_low' ? 'add_lifestyle_image' : 'reorder_images',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: issue.affected_image_indexes,
          requires_human_approval: false,
        });
        break;
      case 'image_compliance':
      case 'compliance':
        recs.push({
          fix_type: 'human_review',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: issue.affected_image_indexes,
          requires_human_approval: true,
        });
        break;
      case 'content_quality':
        recs.push({
          fix_type: issue.type.includes('title') ? 'rewrite_title' : 'rewrite_description',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: [],
          requires_human_approval: false,
        });
        break;
      case 'conversion':
        recs.push({
          fix_type: issue.type === 'weak_main_image' ? 'replace_weak_main_image' : 'add_lifestyle_image',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: issue.affected_image_indexes,
          requires_human_approval: false,
        });
        break;
      case 'operational':
        recs.push({
          fix_type: 'human_review',
          priority: issue.severity as FixRecommendation['priority'],
          reason: issue.evidence,
          affected_image_indexes: [],
          requires_human_approval: true,
        });
        break;
    }
  }

  // If score is critical, always add a human review recommendation
  if (finalScore < 40) {
    const grade = scoreToGrade(finalScore, marketplace);
    recs.push({
      fix_type: 'human_review',
      priority: 'critical',
      reason: `Overall listing quality is ${grade}: score ${finalScore}/100. Manual review recommended.`,
      affected_image_indexes: [],
      requires_human_approval: true,
    });
  }

  return recs;
}

// ─── Main review runner ───────────────────────────────────────────────────────

/**
 * Run the Phase 1 technical/OCR review pipeline for a single listing.
 *
 * Pipeline: snapshot capture → image health check (GET) → OCR → duplicate
 * detection → insert result. Returns the full output.
 */
export async function runTechnicalReview(
  listingRef: ListingRef,
  policy: ReviewPolicy,
  options?: { skipWorkItems?: boolean; skipQwen?: boolean; verbose?: boolean; cycleId?: string },
): Promise<ReviewRunOutput> {
  const marketplace = listingRef.platform as Marketplace;

  // 1. Capture snapshot (idempotent via source_hash)
  const { snapshot, images: snapshotImages, isExisting } = await captureSnapshot({
    listingId: listingRef.id,
  });

  // 1b. If snapshot is unchanged and already has a completed result for the
  // same review_type AND scoring_version, skip. Without these filters a
  // daily_technical review could block a future weekly_quality review or a
  // re-review after scoring logic changes.
  if (isExisting) {
    const { data: existingResult, error: resultErr } = await supabase
      .from('listing_review_results')
      .select('id')
      .eq('snapshot_id', snapshot.id)
      .eq('review_type', policy.review_type)
      .eq('scoring_version', SCORING_VERSION)
      .limit(1);

    if (resultErr) throw new Error(`Check existing result: ${resultErr.message}`);

    if (existingResult && existingResult.length > 0) {
      return {
        snapshot,
        snapshotImages,
        result: null,
        job: null,
        skipped: true,
      };
    }
  }

  // 2. Create job record
  const { data: jobRow, error: jobErr } = await supabase
    .from('listing_review_jobs')
    .insert({
      snapshot_id: snapshot.id,
      cycle_id: options?.cycleId ?? null,
      trigger_source: 'scheduled',
      trigger_policy_id: policy.id,
      marketplace,
      review_type: policy.review_type,
      status: 'running',
      priority: policy.priority,
      ocr_engine: 'tesseract',
      attempt_count: 1,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (jobErr) throw new Error(`Create job: ${jobErr.message}`);
  const job = jobRow as unknown as ReviewJob;

  try {
    // 3. Run image health checks (GET each URL)
    const imageUrls = snapshotImages
      .filter((img) => img.image_url)
      .map((img) => ({ url: img.image_url as string, index: img.image_index }));

    const healthResults = await checkImageHealthBatch(imageUrls, { concurrency: 2 });

    // 4. Update snapshot images with health check results
    for (const health of healthResults) {
      const img = snapshotImages.find((si) => si.image_index === health.image_index);
      if (!img) continue;

      await supabase
        .from('listing_review_snapshot_images')
        .update({
          http_status: health.http_status,
          width: health.width,
          height: health.height,
          byte_size: health.byte_size,
          content_hash: health.content_hash,
          url_hash: health.url_hash,
          loaded: health.loaded,
          load_error: health.load_error,
          ocr_engine: 'tesseract',
        })
        .eq('id', img.id);

      // Update in-memory objects for downstream use
      img.loaded = health.loaded;
      img.http_status = health.http_status;
      img.width = health.width;
      img.height = health.height;
      img.byte_size = health.byte_size;
      img.content_hash = health.content_hash;
      img.url_hash = health.url_hash;
      img.load_error = health.load_error;
      img.ocr_engine = 'tesseract';
    }

    // 5. Run OCR on loaded images
    let ocrSucceeded = false;
    for (const health of healthResults) {
      if (!health.loaded) continue;
      const img = snapshotImages.find((si) => si.image_index === health.image_index);
      if (!img) continue;

      try {
        // Re-fetch image buffer for OCR
        const { defaultFetcher } = await import('./image-health-check.js');
        const { buffer } = await defaultFetcher.fetch(health.image_url);
        const ocrResult = await runOcrForImage(buffer, health.image_index);
        ocrSucceeded = true;

        await supabase
          .from('listing_review_snapshot_images')
          .update({
            ocr_text: ocrResult.ocr_text,
            ocr_blocks_json: ocrResult.ocr_blocks,
          })
          .eq('id', img.id);

        img.ocr_text = ocrResult.ocr_text;
        img.ocr_blocks_json = ocrResult.ocr_blocks;
      } catch {
        // OCR failure on a single image is non-fatal
      }
    }

    // 5b. Run Qwen visual review if enabled by policy (Phase 3)
    let qwenIssues: QualityIssue[] = [];
    let qwenSucceeded = false;
    let qwenRawOutput: Record<string, unknown> | undefined;

    if (policy.qwen_enabled && !options?.skipQwen) {
      const ocrTextByIndex: Record<number, string> = {};
      for (const img of snapshotImages) {
        if (img.ocr_text) {
          ocrTextByIndex[img.image_index] = img.ocr_text;
        }
      }

      const qwenOutput = await runQwenVisualReview({
        snapshotImages,
        marketplace,
        title: snapshot.title,
        description: snapshot.description,
        ocrTextByIndex,
      });

      qwenIssues = qwenOutput.issues;
      qwenSucceeded = qwenOutput.succeeded;
      qwenRawOutput = qwenOutput.rawOutput;

      if (options?.verbose) {
        console.log(`  Qwen review: ${qwenOutput.succeeded ? "succeeded" : "failed"} (${qwenOutput.durationMs}ms, ${qwenOutput.issues.length} issues)`);
      }
    }

    // 6. Generate all issues (technical + duplicate + OCR keyword detection)
    const technicalIssues = generateTechnicalIssues(snapshotImages, marketplace);
    const duplicateIssues = generateDuplicateIssues(snapshotImages, marketplace);
    const ocrIssues = generateOcrIssues(snapshotImages, marketplace);
    const allIssues = [...technicalIssues, ...duplicateIssues, ...ocrIssues, ...qwenIssues];

    // 7. Compute scores via deterministic score engine
    const scoreInput: ScoreEngineInput = {
      snapshotImages,
      issues: allIssues,
      marketplace,
      ocrSucceeded,
      qwenSucceeded,
      title: snapshot.title,
      description: snapshot.description,
      price: snapshot.price,
    };
    const scores = computeScores(scoreInput);

    // 8. Generate fix recommendations from issues
    const recommendations = generateRecommendations(allIssues, scores.finalScore, marketplace);

    // 9. Insert review result with all 6 sub-scores
    const reviewCompleteness = qwenSucceeded ? 'technical_ocr_qwen' : ocrSucceeded ? 'technical_ocr_marketplace' : 'technical_only';
    const { data: resultRow, error: resultErr } = await supabase
      .from('listing_review_results')
      .insert({
        snapshot_id: snapshot.id,
        job_id: job.id,
        review_type: policy.review_type,
        ocr_engine: 'tesseract',
        scoring_version: SCORING_VERSION,
        technical_score: scores.technicalScore,
        content_score: scores.contentScore,
        image_score: scores.imageScore,
        compliance_score: scores.complianceScore,
        conversion_score: scores.conversionScore,
        operational_risk_score: scores.operationalRiskScore,
        final_score: scores.finalScore,
        confidence: ocrSucceeded ? 'medium' : 'low',
        score_status: scores.scoreStatus,
        score_completeness_json: scores.scoreCompleteness as unknown as Record<string, unknown>,
        review_completeness: reviewCompleteness,
        issues_json: allIssues as unknown as Record<string, unknown>[],
        recommendations_json: recommendations as unknown as Record<string, unknown>[],
        raw_outputs_json: (() => { const ro: Record<string, unknown> = {}; if (qwenRawOutput) ro["qwen_review"] = qwenRawOutput; return ro; })(),
      })
      .select('*')
      .single();

    if (resultErr) throw new Error(`Insert result: ${resultErr.message}`);
    const result = resultRow as unknown as ReviewResult;

    // 10. Create/update work item from review result (Phase 2)
    let workItemResult: { created: number; updated: number; skipped: number; errors: number; errorMessages: string[] } = {
      created: 0, updated: 0, skipped: 0, errors: 0, errorMessages: [],
    };

    if (options?.skipWorkItems) {
      // Skipped by explicit flag — not an error
    } else {
      workItemResult = await createWorkItemsFromReview(result, snapshot);
      if (workItemResult.errors > 0) {
        console.error(
          `Work item errors: ${workItemResult.errorMessages.join('; ')}`,
        );
      }
    }

    // 11. Mark job completed (with work item error note if applicable)
    const jobUpdate: Record<string, unknown> = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (workItemResult.errors > 0) {
      jobUpdate.error_message = `Work item creation had ${workItemResult.errors} error(s): ${workItemResult.errorMessages.join('; ')}`;
    }

    await supabase
      .from('listing_review_jobs')
      .update(jobUpdate)
      .eq('id', job.id);

    return {
      snapshot,
      snapshotImages,
      result,
      job: { ...job, ...jobUpdate } as ReviewJob,
      workItemsCreated: workItemResult.created + workItemResult.updated,
      workItemErrors: workItemResult.errors,
      cycle_id: options?.cycleId ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Mark job failed
    await supabase
      .from('listing_review_jobs')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .throwOnError();

    throw err;
  }
}

// ─── Phase 3: Event-Triggered Re-review ─────────────────────────────────────

/**
 * Run a re-review for a listing, managing the quality cycle lifecycle.
 *
 * Pipeline: get/create cycle → set cycle to review_queued → run full
 * technical review → update cycle with latest snapshot/score/delta →
 * set cycle status to 'reviewed' or 'fix_needed'.
 *
 * @returns The review run output augmented with cycle info.
 */
export async function runReReview(
  listingRef: ListingRef,
  trigger: ReReviewTriggerSource,
  options?: { skipWorkItems?: boolean; verbose?: boolean },
): Promise<ReviewRunOutput & { cycle: ListingQualityCycle; scoreDelta: number | null }> {
  const marketplace = listingRef.platform as Marketplace;

  // 1. Get or create a quality cycle for this listing
  const cycle = await getOrCreateCycle(listingRef.id, marketplace, trigger);

  // 2. Set cycle to review_queued
  await updateCycleStatus(cycle.id, 'review_queued');

  // 3. Create a minimal policy-like object for the review pipeline
  //    We use the trigger source as the review_type and default settings.
  const reReviewPolicy: ReviewPolicy = {
    id: 're-review-' + cycle.id,
    name: `Re-review (${trigger})`,
    marketplace,
    scope_type: 'custom',
    scope_filter_json: {},
    review_type: 'event_triggered',
    schedule_cron: null,
    priority: 100,
    qwen_enabled: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 4. Run the full technical review pipeline with cycle_id
  const output = await runTechnicalReview(listingRef, reReviewPolicy, {
    skipWorkItems: options?.skipWorkItems ?? false,
    skipQwen: true, // No Qwen on auto re-review
    verbose: options?.verbose,
    cycleId: cycle.id,
  });

  // 5. Compute score delta
  const cycleScoreDelta: number | null =
    output.result != null
      ? (output.result.final_score ?? 0) - (cycle.latest_score ?? cycle.baseline_score ?? 0)
      : null;

  // 6. Determine next cycle status
  const nextStatus: CycleStatus =
    output.result != null && output.result.issues_json.length > 0
      ? 'fix_needed'
      : 'reviewed';

  // 7. Update cycle with latest result
  await updateCycleStatus(cycle.id, nextStatus, {
    latestSnapshotId: output.snapshot.id,
    latestScore: output.result?.final_score ?? undefined,
    scoreDelta: cycleScoreDelta != null ? cycleScoreDelta : undefined,
  });

  // 8. Fetch the updated cycle to return
  const { data: updatedCycle, error: fetchErr } = await supabase
    .from('listing_quality_cycles')
    .select('*')
    .eq('id', cycle.id)
    .single();

  if (fetchErr) throw new Error(`Fetch updated cycle: ${fetchErr.message}`);

  return {
    ...output,
    cycle: updatedCycle as unknown as ListingQualityCycle,
    scoreDelta: cycleScoreDelta,
  } as ReviewRunOutput & { cycle: ListingQualityCycle; scoreDelta: number | null };
}

export interface PolicyReviewResult {
  outputs: ReviewRunOutput[];
  reviewed: number;
  skipped: number;
  errors: number;
  /** Total work items created/updated across all reviewed listings (Phase 2). */
  workItemsCreated: number;
  /** Unexpcted work item creation errors (should exit nonzero). */
  workItemErrors: number;
}

/**
 * Run technical review for all listings matching a policy.
 * Returns detailed counts so the job runner can report and exit correctly.
 */
export async function runPolicyReview(
  policy: ReviewPolicy,
  options: TechnicalReviewOptions,
): Promise<PolicyReviewResult> {
  const listings = await selectListingsForPolicy(policy, options.limit, options.platform);

  if (options.verbose) {
    console.log(`Policy "${policy.name}": selected ${listings.length} listings`);
  }

  const outputs: ReviewRunOutput[] = [];
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];

    if (options.dryRun) {
      console.log(`[dry-run] [${i + 1}/${listings.length}] Would review listing ${listing.id}`);
      continue;
    }

    if (options.verbose) {
      console.log(`[${i + 1}/${listings.length}] Reviewing listing ${listing.id}...`);
    }

    try {
      const output = await runTechnicalReview(listing, policy, {
        skipWorkItems: options.skipWorkItems,
        skipQwen: options.skipQwen,
        verbose: options.verbose,
      });
      outputs.push(output);

      if (output.skipped) {
        skipped++;
        if (options.verbose) {
          console.log(`  Skipped: snapshot unchanged and already reviewed`);
        }
      } else {
        // Phase 3: Create/reuse quality cycle for first-time scheduled reviews
        try {
          const marketplace = listing.platform as Marketplace;
          const cycle = await getOrCreateCycle(
            listing.id,
            marketplace,
            'new_listing_imported',
          );

          const cycleStatus: CycleStatus =
            output.result != null && output.result.issues_json.length > 0
              ? 'fix_needed'
              : 'reviewed';

          await updateCycleStatus(cycle.id, cycleStatus, {
            latestSnapshotId: output.snapshot.id,
            latestScore: output.result?.final_score ?? undefined,
            scoreDelta: undefined,
          });
        } catch (cycleErr) {
          console.error(`  Cycle update error for ${listing.id}: ${cycleErr instanceof Error ? cycleErr.message : String(cycleErr)}`);
        }

        if (options.verbose) {
          const imagesOk = output.snapshotImages.filter((img) => img.loaded).length;
          console.log(
            `  Done: ${imagesOk}/${output.snapshotImages.length} images loaded, ` +
            `score=${output.result?.final_score ?? 'N/A'}, confidence=${output.result?.confidence ?? 'N/A'}`,
          );
        }
      }
    } catch (err) {
      errors++;
      console.error(`  [${i + 1}/${listings.length}] Error reviewing ${listing.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const workItemsCreated = outputs.reduce((sum, o) => sum + (o.workItemsCreated ?? 0), 0);
  const workItemErrors = outputs.reduce((sum, o) => sum + (o.workItemErrors ?? 0), 0);
  return {
    outputs,
    reviewed: outputs.filter(o => !o.skipped).length,
    skipped,
    errors,
    workItemsCreated,
    workItemErrors,
  };
}

// Review runner — orchestrates the Phase 1 technical/OCR review pipeline.
//
// Pipeline: snapshot → health check (GET) → OCR → duplicate detection → result.
// Qwen visual review is deferred to Phase 4. Marketplace scoring starts Phase 2.

import { captureSnapshot } from './snapshot-capture.js';
import { checkImageHealthBatch } from './image-health-check.js';
import { runOcrForImage, detectOcrKeywords } from './ocr-extraction.js';
import { detectDuplicates } from './duplicate-detection.js';
import { supabase } from '../../lib/supabase.js';
import type {
  ReviewPolicy,
  ReviewJob,
  ReviewRunOutput,
  ReviewResult,
  SnapshotImage,
  ScoreCompleteness,
  QualityIssue,
  TechnicalReviewOptions,
  Marketplace,
  ReviewType,
} from './types.js';

// ─── Scoring version ──────────────────────────────────────────────────────────

const SCORING_VERSION = '1.0.0';

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
 */
async function getListingIdsWithImages(
  candidateIds: string[] | null,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  const effectiveCandidateIds = candidateIds ?? [];

  if (effectiveCandidateIds.length === 0) {
    // No candidates — query broadly but paginate
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('platform_listing_images')
        .select('listing_id')
        .range(offset, offset + pageSize - 1)
        .order('listing_id');

      if (!data || data.length === 0) break;
      for (const r of data) ids.add(r.listing_id as string);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    return ids;
  }

  // Query images filtered by candidate listing IDs, batched to avoid URL-length errors
  const batchSize = 500;
  for (let i = 0; i < effectiveCandidateIds.length; i += batchSize) {
    const batch = effectiveCandidateIds.slice(i, i + batchSize);
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('platform_listing_images')
        .select('listing_id')
        .in('listing_id', batch)
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      for (const r of data) ids.add(r.listing_id as string);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  return ids;
}

async function selectListingsForPolicy(
  policy: ReviewPolicy,
  limit: number,
  platform?: Marketplace,
): Promise<ListingRef[]> {
  const targetPlatform = platform ?? policy.marketplace;

  // Base: platform filter
  let query = supabase
    .from('platform_listings')
    .select('id,platform,shop_code,product_spu_id,listing_status')
    .eq('platform', targetPlatform);

  switch (policy.scope_type) {
    case 'hero_products': {
      // Active hero product listings
      query = query.eq('listing_status', 'active');
      const { data: heroSpus } = await supabase
        .from('merchandising_focus_items')
        .select('product_spu_id')
        .eq('focus_type', 'hero')
        .eq('status', 'active');

      if (heroSpus && heroSpus.length > 0) {
        const spuIds = heroSpus.map((r) => r.product_spu_id);
        query = query.in('product_spu_id', spuIds);
      }
      break;
    }
    case 'active_with_images': {
      query = query.eq('listing_status', 'active');
      // Get active listing IDs first, then filter to those with images
      const { data: activeListings } = await supabase
        .from('platform_listings')
        .select('id')
        .eq('platform', targetPlatform)
        .eq('listing_status', 'active');

      const candidateIds = (activeListings ?? []).map((r) => r.id as string);
      const idsWithImages = await getListingIdsWithImages(candidateIds);
      if (idsWithImages.size > 0) {
        query = query.in('id', [...idsWithImages]);
      } else {
        query = query.eq('id', '__none__'); // force empty
      }
      break;
    }
    case 'all_active': {
      query = query.eq('listing_status', 'active');
      break;
    }
    case 'curated':
    default: {
      // Curated = hero products + active with images.
      // Apply BOTH hero SPU filter AND has-images filter.
      query = query.eq('listing_status', 'active');

      // Get hero SPU IDs
      const { data: heroSpus } = await supabase
        .from('merchandising_focus_items')
        .select('product_spu_id')
        .eq('focus_type', 'hero')
        .eq('status', 'active');

      // Get candidate listing IDs to scope the image query
      let candidateQuery = supabase
        .from('platform_listings')
        .select('id')
        .eq('platform', targetPlatform)
        .eq('listing_status', 'active');

      if (heroSpus && heroSpus.length > 0) {
        const spuIds = heroSpus.map((r) => r.product_spu_id);
        candidateQuery = candidateQuery.in('product_spu_id', spuIds);
        // Apply hero SPU filter to the main query too
        query = query.in('product_spu_id', spuIds);
      }

      const { data: candidateListings } = await candidateQuery;
      const candidateIds = (candidateListings ?? []).map((r) => r.id as string);
      const idsWithImages = await getListingIdsWithImages(candidateIds);

      if (idsWithImages.size > 0) {
        query = query.in('id', [...idsWithImages]);
      } else {
        query = query.eq('id', '__none__');
      }
      break;
    }
  }

  query = query.limit(limit).order('id', { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`Select listings: ${error.message}`);

  return (data ?? []) as unknown as ListingRef[];
}

// ─── Issue generation from technical findings ─────────────────────────────────

function generateTechnicalIssues(
  snapshotImages: SnapshotImage[],
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // Broken images — use is_main_image flag, not raw position
  const broken = snapshotImages.filter((img) => !img.loaded);
  if (broken.length > 0) {
    const mainBroken = broken.some((img) => img.is_main_image);
    issues.push({
      type: 'broken_image_url',
      severity: mainBroken ? 'critical' : 'high',
      confidence: 1.0,
      source: 'technical',
      marketplace,
      affected_image_indexes: broken.map((img) => img.image_index),
      evidence: `${broken.length} image(s) failed to load: ${broken.map((img) => img.image_url).join(', ')}`,
      operator_note: mainBroken
        ? 'Main image is broken — listing may not display correctly.'
        : 'Some listing images failed to load.',
      requires_human_approval: false,
      suggested_owner: null,
      expected_impact: 'high',
    });
  }

  // Low-resolution images (width < 200 or height < 200 and loaded)
  const lowRes = snapshotImages.filter(
    (img) => img.loaded && img.width !== null && img.height !== null && (img.width < 200 || img.height < 200),
  );
  if (lowRes.length > 0) {
    issues.push({
      type: 'image_low_resolution',
      severity: 'medium',
      confidence: 0.9,
      source: 'technical',
      marketplace,
      affected_image_indexes: lowRes.map((img) => img.image_index),
      evidence: `Images below 200px dimension: ${lowRes.map((img) => `${img.image_index} (${img.width}x${img.height})`).join(', ')}`,
      operator_note: 'Low resolution images may appear blurry on product pages.',
      requires_human_approval: false,
      suggested_owner: null,
      expected_impact: 'medium',
    });
  }

  return issues;
}

function generateDuplicateIssues(
  snapshotImages: SnapshotImage[],
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // Build minimal image health result shapes for duplicate detection
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
    issues.push({
      type: 'duplicate_url',
      severity: 'medium',
      confidence: 1.0,
      source: 'technical',
      marketplace,
      affected_image_indexes: group.image_indexes,
      evidence: `Same URL used at positions: ${group.image_indexes.join(', ')}`,
      operator_note: 'Duplicate image URLs found — remove duplicates or use different images.',
      requires_human_approval: false,
      suggested_owner: null,
      expected_impact: 'medium',
    });
  }

  for (const group of contentDuplicates) {
    issues.push({
      type: 'duplicate_content',
      severity: 'low',
      confidence: 1.0,
      source: 'technical',
      marketplace,
      affected_image_indexes: group.image_indexes,
      evidence: `Identical image content at different URLs, positions: ${group.image_indexes.join(', ')}`,
      operator_note: 'Same image content found at multiple positions — consolidate duplicates.',
      requires_human_approval: false,
      suggested_owner: null,
      expected_impact: 'low',
    });
  }

  return issues;
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
): Promise<ReviewRunOutput> {
  const marketplace = listingRef.platform as Marketplace;

  // 1. Capture snapshot (idempotent via source_hash)
  const { snapshot, images: snapshotImages, isExisting } = await captureSnapshot({
    listingId: listingRef.id,
  });

  // 1b. If snapshot is unchanged and already has a completed result, skip.
  if (isExisting) {
    const { data: existingResult } = await supabase
      .from('listing_review_results')
      .select('id')
      .eq('snapshot_id', snapshot.id)
      .limit(1);

    if (existingResult && existingResult.length > 0) {
      return {
        snapshot,
        snapshotImages,
        result: null as unknown as ReviewResult,
        job: null as unknown as ReviewJob,
        skipped: true,
      } as ReviewRunOutput;
    }
  }

  // 2. Create job record
  const { data: jobRow, error: jobErr } = await supabase
    .from('listing_review_jobs')
    .insert({
      snapshot_id: snapshot.id,
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

    // 6. Generate technical issues
    const technicalIssues = generateTechnicalIssues(snapshotImages, marketplace);
    const duplicateIssues = generateDuplicateIssues(snapshotImages, marketplace);
    const allIssues = [...technicalIssues, ...duplicateIssues];

    // 7. Compute score completeness
    const scoreCompleteness: ScoreCompleteness = {
      technical: true,
      ocr: ocrSucceeded,
      marketplace_rules: false,
      qwen_visual: false,
      human_review: false,
    };

    // 8. Calculate a simple technical score (full scoring in Phase 2)
    const loadedCount = snapshotImages.filter((img) => img.loaded).length;
    const totalCount = snapshotImages.length;
    const technicalScore = totalCount > 0 ? Math.round((loadedCount / totalCount) * 100) : 0;

    // 9. Insert review result
    const reviewCompleteness = ocrSucceeded ? 'technical_ocr' : 'technical_only';
    const { data: resultRow, error: resultErr } = await supabase
      .from('listing_review_results')
      .insert({
        snapshot_id: snapshot.id,
        job_id: job.id,
        review_type: policy.review_type,
        ocr_engine: 'tesseract',
        scoring_version: SCORING_VERSION,
        technical_score: technicalScore,
        final_score: technicalScore,
        confidence: ocrSucceeded ? 'medium' : 'low',
        score_status: 'partial',
        score_completeness_json: scoreCompleteness as unknown as Record<string, unknown>,
        review_completeness: reviewCompleteness,
        issues_json: allIssues as unknown as Record<string, unknown>[],
        recommendations_json: [],
        raw_outputs_json: {},
      })
      .select('*')
      .single();

    if (resultErr) throw new Error(`Insert result: ${resultErr.message}`);
    const result = resultRow as unknown as ReviewResult;

    // 10. Mark job completed
    await supabase
      .from('listing_review_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return { snapshot, snapshotImages, result, job: { ...job, status: 'completed', completed_at: new Date().toISOString() } };
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

export interface PolicyReviewResult {
  outputs: ReviewRunOutput[];
  reviewed: number;
  skipped: number;
  errors: number;
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
      const output = await runTechnicalReview(listing, policy);
      outputs.push(output);

      if (output.skipped) {
        skipped++;
        if (options.verbose) {
          console.log(`  Skipped: snapshot unchanged and already reviewed`);
        }
      } else if (options.verbose) {
        const imagesOk = output.snapshotImages.filter((img) => img.loaded).length;
        console.log(
          `  Done: ${imagesOk}/${output.snapshotImages.length} images loaded, ` +
          `score=${output.result.final_score}, confidence=${output.result.confidence}`,
        );
      }
    } catch (err) {
      errors++;
      console.error(`  [${i + 1}/${listings.length}] Error reviewing ${listing.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { outputs, reviewed: outputs.filter(o => !o.skipped).length, skipped, errors };
}

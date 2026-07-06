import { supabase } from '../../lib/supabase.js';
import { createHash } from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Row shape returned by listing_target_classification_v1 */
interface ClassificationRow {
  target_type: string;
  target_id: string;
  workflow_type: string;
  issue_type: string | null;
  recommended_action: string | null;
  platform: string | null;
  shop_code: string | null;
  product_family_id: string | null;
  product_spu_id: string | null;
  variant_id: string | null;
  bundle_id: string | null;
  listing_id: string | null;
  listing_sku_id: string | null;
  is_hero: boolean;
  hero_scope: string | null;
  hero_priority: number | null;
  hero_reason: string | null;
  target_platforms: string[] | null;
  listing_strategy_status: string | null;
  business_priority: string;
  issue_severity: string;
  mapping_status: string | null;
  listing_status: string | null;
  stock_status: string | null;
  image_status: string | null;
  content_status: string | null;
  price_status: string | null;
  human_input_level: string;
  source_context: Record<string, unknown>;
  source_snapshot_hash: string | null;
  classification_reasons: Array<Record<string, unknown>>;
  priority_score: number;
}

/** Upsert payload for listing_work_items — subset of columns the table accepts */
interface WorkItemUpsert {
  workflow_type: string;
  issue_type: string | null;
  recommended_action: string | null;
  target_type: string;
  target_id: string;
  platform: string | null;
  shop_code: string | null;
  product_family_id: string | null;
  product_spu_id: string | null;
  variant_id: string | null;
  bundle_id: string | null;
  listing_id: string | null;
  listing_sku_id: string | null;
  priority_score: number;
  business_priority: string;
  issue_severity: string;
  is_hero: boolean;
  hero_scope: string | null;
  hero_priority: number | null;
  hero_reason: string | null;
  target_platforms: string[] | null;
  listing_strategy_status: string | null;
  human_input_level: string;
  source_context: Record<string, unknown>;
  source_snapshot_hash: string;
  source_snapshot_version: number;
  classification_reasons: Array<Record<string, unknown>>;
  deterministic_findings: Array<Record<string, unknown>>;
}

export interface ClassifyResult {
  view_rows: number;
  upserted: number;
  errors: number;
  breakdown: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute a stable SHA-256 hash of the source_context JSON.
 * Used for source_snapshot_hash to detect changes across runs.
 */
function computeSnapshotHash(sourceContext: Record<string, unknown>): string {
  const stable = JSON.stringify(sourceContext, Object.keys(sourceContext).sort());
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Fetch all rows from listing_target_classification_v1.
 * Paginates past Supabase default 1000-row limit.
 */
async function fetchAllClassificationRows(): Promise<ClassificationRow[]> {
  const all: ClassificationRow[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('listing_target_classification_v1')
      .select('*')
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Fetch classification offset ${offset}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as ClassificationRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

function targetKeyFor(row: Pick<ClassificationRow, 'workflow_type' | 'platform' | 'shop_code' | 'target_type' | 'target_id'>): string {
  return [
    row.workflow_type,
    row.platform ?? '',
    row.shop_code ?? '',
    row.target_type,
    row.target_id,
  ].join(':');
}

function severityRank(value: string): number {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function priorityRank(value: string): number {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'normal') return 2;
  if (value === 'low') return 1;
  return 0;
}

function choosePrimaryRow(a: ClassificationRow, b: ClassificationRow): ClassificationRow {
  if (b.priority_score !== a.priority_score) return b.priority_score > a.priority_score ? b : a;
  const severityDiff = severityRank(b.issue_severity) - severityRank(a.issue_severity);
  if (severityDiff !== 0) return severityDiff > 0 ? b : a;
  const priorityDiff = priorityRank(b.business_priority) - priorityRank(a.business_priority);
  return priorityDiff > 0 ? b : a;
}

function buildPayloads(rows: ClassificationRow[]): WorkItemUpsert[] {
  const grouped = new Map<string, ClassificationRow[]>();
  for (const row of rows) {
    const key = targetKeyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.values()).map((group) => {
    const primary = group.reduce((best, row) => choosePrimaryRow(best, row));
    const sourceContext = primary.source_context ?? {};
    const snapshotHash = computeSnapshotHash(sourceContext);
    const classificationReasons = group.flatMap((row) => {
      return (row.classification_reasons ?? []).map((reason) => ({
        ...reason,
        issue_type: row.issue_type,
        recommended_action: row.recommended_action,
        priority_score: row.priority_score,
      }));
    });

    const findings = classificationReasons.map((reason) => ({
      ...reason,
      detected_at: new Date().toISOString(),
    }));

    return {
      workflow_type: primary.workflow_type,
      issue_type: primary.issue_type,
      recommended_action: primary.recommended_action,
      target_type: primary.target_type,
      target_id: primary.target_id,
      platform: primary.platform,
      shop_code: primary.shop_code,
      product_family_id: primary.product_family_id,
      product_spu_id: primary.product_spu_id,
      variant_id: primary.variant_id,
      bundle_id: primary.bundle_id,
      listing_id: primary.listing_id,
      listing_sku_id: primary.listing_sku_id,
      priority_score: Math.max(...group.map((row) => row.priority_score)),
      business_priority: primary.business_priority,
      issue_severity: primary.issue_severity,
      is_hero: group.some((row) => row.is_hero),
      hero_scope: primary.hero_scope,
      hero_priority: primary.hero_priority,
      hero_reason: primary.hero_reason,
      target_platforms: primary.target_platforms,
      listing_strategy_status: primary.listing_strategy_status,
      human_input_level: primary.human_input_level,
      source_context: sourceContext,
      source_snapshot_hash: snapshotHash,
      source_snapshot_version: 1,
      classification_reasons: classificationReasons,
      deterministic_findings: findings,
    };
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Classify listing targets: read the deterministic classification view
 * and upsert work items idempotently by target_key.
 */
export async function classifyListingTargets(): Promise<ClassifyResult> {
  console.log('\n=== Listing Target Classification ===\n');

  // 1. Fetch all classification rows from the view
  const rows = await fetchAllClassificationRows();
  console.log(`Fetched ${rows.length} classification rows from view`);

  if (rows.length === 0) {
    console.log('No classification rows found. Is data imported?');
    return { view_rows: 0, upserted: 0, errors: 0, breakdown: {} };
  }

  // 2. Build breakdown by workflow_type + issue_type
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.workflow_type}|${r.issue_type ?? 'none'}`;
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }
  console.log('Breakdown by workflow/issue:');
  for (const [k, v] of Object.entries(breakdown)) {
    console.log(`  ${k}: ${v}`);
  }

  // 3. Build one work-item payload per generated target_key.
  const payloads = buildPayloads(rows);
  const duplicateCount = rows.length - payloads.length;
  if (duplicateCount > 0) {
    console.log(`Collapsed ${duplicateCount} duplicate classification rows by target_key`);
  }

  // 4. Upsert in batches by target_key (generated column, unique)
  let upserted = 0;
  let errors = 0;
  const batchSize = 200;

  for (let offset = 0; offset < payloads.length; offset += batchSize) {
    const batch = payloads.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('listing_work_items')
      .upsert(batch, {
        onConflict: 'target_key',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Batch ${offset}: ${error.message}`);
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }

  console.log(`\nUpserted: ${upserted}, Errors: ${errors}`);
  console.log('=== Classification Complete ===\n');

  return { view_rows: rows.length, upserted, errors, breakdown };
}

/**
 * Stale status update: mark work items as 'stale' when their source_snapshot_hash
 * differs from what the current view would produce. This keeps the work queue
 * clean when underlying data changes.
 */
export async function markStaleWorkItems(): Promise<number> {
  const rows = await fetchAllClassificationRows();
  const payloads = buildPayloads(rows);

  // Build a map of target_key -> current snapshot hash
  const currentHashes = new Map<string, string>();
  for (const payload of payloads) {
    currentHashes.set(targetKeyFor(payload), payload.source_snapshot_hash);
  }

  // Fetch existing work items that are still 'open'
  const existing = await fetchAllWorkItems('open');
  let staleCount = 0;

  const batchSize = 200;
  const staleIds: string[] = [];

  for (const item of existing) {
    const currentHash = currentHashes.get(item.target_key);
    // If the item is no longer in the view, or its hash changed, mark stale
    if (!currentHash || currentHash !== item.source_snapshot_hash) {
      staleIds.push(item.id);
    }
  }

  // Batch update stale items
  for (let offset = 0; offset < staleIds.length; offset += batchSize) {
    const batch = staleIds.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('listing_work_items')
      .update({ status: 'stale', updated_at: new Date().toISOString() })
      .in('id', batch);

    if (error) {
      console.error(`Stale batch ${offset}: ${error.message}`);
    } else {
      staleCount += batch.length;
    }
  }

  if (staleCount > 0) {
    console.log(`Marked ${staleCount} work items as stale`);
  }
  return staleCount;
}

interface WorkItemRef {
  id: string;
  target_key: string;
  source_snapshot_hash: string | null;
}

async function fetchAllWorkItems(status: string): Promise<WorkItemRef[]> {
  const all: WorkItemRef[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('listing_work_items')
      .select('id,target_key,source_snapshot_hash')
      .eq('status', status)
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Fetch work items offset ${offset}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as WorkItemRef[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

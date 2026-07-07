// Work item factory — bridges listing_review_results → listing_work_items.
//
// Phase 2 creates ONE aggregated quality work item per listing review.
// All issues from the review are grouped by category+severity and stored
// inside deterministic_findings so the operator sees a complete picture.
//
// Upsert via target_key: if the same listing is re-reviewed with a new
// snapshot, the existing work item is refreshed rather than duplicated.

import { supabase } from '../../lib/supabase.js';
import { getIssueDefinition } from './issue-taxonomy.js';
import { scoreToGrade, gradeLabel } from './score-engine.js';
import type { IssueType } from './issue-taxonomy.js';
import type {
  Marketplace,
  QualityIssue,
  ReviewResult,
  ReviewSnapshot,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkItemCreateResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  workItemIds: string[];
  errorMessages: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface IssueGroup {
  category: string;
  severity: string;
  issues: QualityIssue[];
}

function groupIssues(issues: QualityIssue[]): IssueGroup[] {
  const groups = new Map<string, QualityIssue[]>();

  for (const issue of issues) {
    let category: string;
    try {
      const def = getIssueDefinition(issue.type as IssueType);
      category = def.category;
    } catch {
      category = 'unknown';
    }

    const key = `${category}::${issue.severity}`;
    const existing = groups.get(key) ?? [];
    existing.push(issue);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([key, groupIssues]) => {
    const [category, severity] = key.split('::');
    return { category, severity, issues: groupIssues };
  });
}

/**
 * Dominant severity across all groups. Used for the single work item's
 * issue_severity and business_priority.
 */
function dominantSeverity(
  groups: IssueGroup[],
): { severity: string; businessPriority: 'low' | 'normal' | 'high' | 'critical' } {
  const order: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  let worst = 'low';
  for (const g of groups) {
    if ((order[g.severity] ?? 0) > (order[worst] ?? 0)) worst = g.severity;
  }

  const bp: Record<string, 'low' | 'normal' | 'high' | 'critical'> = {
    critical: 'critical',
    high: 'high',
    medium: 'normal',
    low: 'low',
  };

  return { severity: worst, businessPriority: bp[worst] ?? 'normal' };
}

function computeWorkItemPriority(groups: IssueGroup[]): number {
  const allIssues = groups.flatMap((g) => g.issues);
  const maxSeverity = dominantSeverity(groups).severity;

  const severityBase: Record<string, number> = {
    critical: 90, high: 70, medium: 40, low: 15,
  };

  const base = severityBase[maxSeverity] ?? 30;
  const countBonus = Math.min(allIssues.length * 2, 20);
  const avgConfidence = allIssues.reduce((sum, i) => sum + i.confidence, 0) / allIssues.length;
  const confidenceBonus = Math.round(avgConfidence * 10);

  return Math.min(100, base + countBonus + confidenceBonus);
}

function pickRecommendedAction(groups: IssueGroup[]): string {
  // Prefer image tasks if any image-category issues exist
  const imageCategories = ['image_technical', 'image_content', 'image_compliance', 'conversion'];
  const hasImageIssues = groups.some((g) => imageCategories.includes(g.category));
  return hasImageIssues ? 'create_image_task' : 'create_task';
}

// ─── Main factory function ──────────────────────────────────────────────────

/**
 * Create or update ONE aggregated quality work item for a single listing review.
 *
 * All issues from the review are grouped and stored in deterministic_findings.
 * Upsert via target_key so re-reviews with a new snapshot refresh the existing
 * work item instead of creating a duplicate.
 */
export async function createWorkItemsFromReview(
  result: ReviewResult,
  snapshot: ReviewSnapshot,
): Promise<WorkItemCreateResult> {
  const issues = (result.issues_json ?? []) as QualityIssue[];
  if (issues.length === 0) {
    return { created: 0, updated: 0, skipped: 0, errors: 0, workItemIds: [], errorMessages: [] };
  }

  const groups = groupIssues(issues);

  // Build one aggregated findings list from all groups
  const deterministicFindings = groups.map((group) => ({
    category: group.category,
    severity: group.severity,
    issue_count: group.issues.length,
    issues: group.issues.map((issue) => ({
      type: issue.type,
      severity: issue.severity,
      confidence: issue.confidence,
      source: issue.source,
      evidence: issue.evidence,
      operator_note: issue.operator_note,
      affected_image_indexes: issue.affected_image_indexes,
    })),
  }));

  const domSev = dominantSeverity(groups);
  const priorityScore = computeWorkItemPriority(groups);
  const grade = scoreToGrade(result.final_score ?? 0, snapshot.marketplace as Marketplace);
  const totalIssueCount = groups.reduce((sum, g) => sum + g.issues.length, 0);

  const classificationReasons = [
    `Phase 2 quality scoring: ${gradeLabel(grade)} (${result.final_score}/100)`,
    `${totalIssueCount} issue(s) across ${groups.length} category group(s)`,
    ...groups.map((g) => `${g.category}/${g.severity}: ${g.issues.length} issue(s)`),
  ];

  const sourceContext: Record<string, unknown> = {
    snapshot_id: snapshot.id,
    listing_id: snapshot.listing_id,
    marketplace: snapshot.marketplace,
    title: snapshot.title,
    price: snapshot.price,
    status: snapshot.marketplace_status,
    review_type: result.review_type,
    scoring_version: result.scoring_version,
    final_score: result.final_score,
    grade,
    image_count: snapshot.image_urls_json?.length ?? 0,
  };

  const humanInputLevel =
    domSev.severity === 'critical' ? 'expert_review_required' :
    domSev.severity === 'high' ? 'confirm_only' :
    'none';

  // target_key is unique per (workflow, platform, shop, target_type, target_id).
  // Only one quality work item can exist per listing.
  const targetKey = [
    'audit_existing_listing',
    snapshot.marketplace,
    snapshot.shop_code ?? '',
    'listing',
    snapshot.listing_id,
  ].join(':');

  const workItemPayload = {
    workflow_type: 'audit_existing_listing',
    issue_type: 'title_quality', // general quality label; details in findings
    recommended_action: pickRecommendedAction(groups),
    target_type: 'listing',
    target_id: snapshot.listing_id,
    platform: snapshot.marketplace,
    shop_code: snapshot.shop_code,
    product_spu_id: snapshot.product_spu_id,
    product_family_id: snapshot.product_family_id,
    listing_id: snapshot.listing_id,
    priority_score: priorityScore,
    business_priority: domSev.businessPriority,
    issue_severity: domSev.severity,
    is_hero: snapshot.is_hero_product,
    human_input_level: humanInputLevel,
    status: 'open' as const,
    source_context: sourceContext,
    source_snapshot_hash: snapshot.source_hash,
    source_snapshot_version: 1,
    classification_reasons: classificationReasons,
    deterministic_findings: deterministicFindings,
    latest_result_id: result.id,
  };

  try {
    // Check for existing work item by target_key (unique constraint)
    const { data: existing, error: lookupErr } = await supabase
      .from('listing_work_items')
      .select('id, source_snapshot_hash')
      .eq('target_key', targetKey)
      .limit(1);

    if (lookupErr) {
      return {
        created: 0, updated: 0, skipped: 0, errors: 1,
        workItemIds: [],
        errorMessages: [`Lookup existing work item: ${lookupErr.message}`],
      };
    }

    if (existing && existing.length > 0) {
      const existingRow = existing[0] as { id: string; source_snapshot_hash: string | null };

      // Same snapshot → idempotent skip
      if (existingRow.source_snapshot_hash === snapshot.source_hash) {
        return {
          created: 0, updated: 0, skipped: 1, errors: 0,
          workItemIds: [existingRow.id],
          errorMessages: [],
        };
      }

      // Different snapshot → update the existing work item with fresh findings
      const { error: updateErr } = await supabase
        .from('listing_work_items')
        .update({
          ...workItemPayload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRow.id);

      if (updateErr) {
        return {
          created: 0, updated: 0, skipped: 0, errors: 1,
          workItemIds: [],
          errorMessages: [`Update work item ${existingRow.id}: ${updateErr.message}`],
        };
      }

      return {
        created: 0, updated: 1, skipped: 0, errors: 0,
        workItemIds: [existingRow.id],
        errorMessages: [],
      };
    }

    // No existing work item → insert new
    const { data: inserted, error: insertErr } = await supabase
      .from('listing_work_items')
      .insert(workItemPayload)
      .select('id')
      .single();

    if (insertErr) {
      // If unique violation slipped through (race), treat as error
      return {
        created: 0, updated: 0, skipped: 0, errors: 1,
        workItemIds: [],
        errorMessages: [`Insert work item: ${insertErr.message}`],
      };
    }

    return {
      created: 1, updated: 0, skipped: 0, errors: 0,
      workItemIds: [(inserted as { id: string }).id],
      errorMessages: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      created: 0, updated: 0, skipped: 0, errors: 1,
      workItemIds: [],
      errorMessages: [message],
    };
  }
}

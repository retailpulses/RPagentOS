// Work item factory — bridges listing_review_results → listing_work_items.
//
// After each review run, groups issues by category+severity and creates
// prioritized operator work items. Deduplicates against existing work items
// for the same listing+issue_type so repeated reviews don't create duplicates.

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
  skipped: number;
  errors: number;
  workItemIds: string[];
}

// ─── Severity → business_priority mapping ───────────────────────────────────

function severityToBusinessPriority(
  severity: string,
): 'low' | 'normal' | 'high' | 'critical' {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'normal';
    case 'low': return 'low';
    default: return 'normal';
  }
}

// ─── Severity → recommended_action mapping ──────────────────────────────────

function categoryToRecommendedAction(category: string): string {
  switch (category) {
    case 'image_technical':
    case 'image_content':
      return 'create_image_task';
    case 'image_compliance':
      return 'create_image_task';
    case 'content_quality':
      return 'create_task';
    case 'compliance':
      return 'create_task';
    case 'conversion':
      return 'create_image_task';
    case 'operational':
      return 'create_task';
    default:
      return 'create_task';
  }
}

// ─── Issue grouping ─────────────────────────────────────────────────────────

interface IssueGroup {
  category: string;
  severity: string;
  issues: QualityIssue[];
}

/**
 * Group issues by category + severity so each group becomes one work item.
 * An operator can then triage all "image_technical/high" issues together.
 */
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

// ─── Priority score computation ─────────────────────────────────────────────

/**
 * Compute a priority_score for a work item from its issues.
 * Higher = more urgent. Formula:
 *   base = severity weight (critical=90, high=70, medium=40, low=15)
 *   + issue count * 3 (more issues = higher priority within same severity)
 *   + confidence bonus (avg confidence * 10)
 * Ceiling at 100.
 */
function computeWorkItemPriority(issues: QualityIssue[], severity: string): number {
  const severityBase: Record<string, number> = {
    critical: 90,
    high: 70,
    medium: 40,
    low: 15,
  };

  const base = severityBase[severity] ?? 30;
  const countBonus = Math.min(issues.length * 3, 15);
  const avgConfidence = issues.reduce((sum, i) => sum + i.confidence, 0) / issues.length;
  const confidenceBonus = Math.round(avgConfidence * 10);

  return Math.min(100, base + countBonus + confidenceBonus);
}

// ─── Main factory function ──────────────────────────────────────────────────

/**
 * Create listing_work_items from a completed review result.
 *
 * Groups issues by category+severity, creates one work item per group,
 * and deduplicates against existing work items for the same listing+issue_type.
 *
 * Sets workflow_type to 'audit_existing_listing' since these come from the
 * daily_technical and weekly_quality review pipelines.
 */
export async function createWorkItemsFromReview(
  result: ReviewResult,
  snapshot: ReviewSnapshot,
): Promise<WorkItemCreateResult> {
  const issues = (result.issues_json ?? []) as QualityIssue[];
  if (issues.length === 0) {
    return { created: 0, skipped: 0, errors: 0, workItemIds: [] };
  }

  const groups = groupIssues(issues);
  const created: string[] = [];
  let skipped = 0;
  let errors = 0;

  for (const group of groups) {
    try {
      // Determine the dominant issue type for this group (most severe first)
      const primaryIssue = group.issues[0];
      const issueType = primaryIssue.type;
      const priorityScore = computeWorkItemPriority(group.issues, group.severity);
      const grade = scoreToGrade(result.final_score ?? 0, snapshot.marketplace as Marketplace);

      // Build deterministic_findings: structured issue data for operator UI
      const deterministicFindings = group.issues.map((issue) => ({
        type: issue.type,
        severity: issue.severity,
        confidence: issue.confidence,
        source: issue.source,
        evidence: issue.evidence,
        operator_note: issue.operator_note,
        affected_image_indexes: issue.affected_image_indexes,
      }));

      // Build classification_reasons: why was this work item created?
      const classificationReasons = [
        `Phase 2 scoring: ${gradeLabel(grade)}`,
        `Final score: ${result.final_score}`,
        `${group.issues.length} issue(s) in category "${group.category}" at severity "${group.severity}"`,
      ];

      // Build source_context from snapshot for the operator to understand context
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

      // Determine human_input_level from severity
      const humanInputLevel =
        group.severity === 'critical' ? 'expert_review_required' :
        group.severity === 'high' ? 'confirm_only' :
        'none';

      // Upsert: skip if a work item already exists for this listing+issue_type
      // with the same snapshot (idempotent via source_snapshot_hash).
      const targetKey = [
        'audit_existing_listing',
        snapshot.marketplace,
        snapshot.shop_code ?? '',
        'listing',
        snapshot.listing_id,
      ].join(':');

      // Check for existing work item with same target_key + issue_type
      const { data: existing } = await supabase
        .from('listing_work_items')
        .select('id')
        .eq('target_key', targetKey)
        .eq('issue_type', issueType)
        .eq('source_snapshot_hash', snapshot.source_hash)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        created.push((existing[0] as { id: string }).id);
        continue;
      }

      // Insert new work item
      const { data: inserted, error: insertErr } = await supabase
        .from('listing_work_items')
        .insert({
          workflow_type: 'audit_existing_listing',
          issue_type: issueType,
          recommended_action: categoryToRecommendedAction(group.category),
          target_type: 'listing',
          target_id: snapshot.listing_id,
          platform: snapshot.marketplace,
          shop_code: snapshot.shop_code,
          product_spu_id: snapshot.product_spu_id,
          product_family_id: snapshot.product_family_id,
          listing_id: snapshot.listing_id,
          priority_score: priorityScore,
          business_priority: severityToBusinessPriority(group.severity),
          issue_severity: group.severity,
          is_hero: snapshot.is_hero_product,
          human_input_level: humanInputLevel,
          status: 'open',
          source_context: sourceContext,
          source_snapshot_hash: snapshot.source_hash,
          source_snapshot_version: 1,
          classification_reasons: classificationReasons,
          deterministic_findings: deterministicFindings,
          latest_result_id: result.id,
        })
        .select('id')
        .single();

      if (insertErr) {
        errors++;
        console.error(`Work item insert error: ${insertErr.message}`);
        continue;
      }

      created.push((inserted as { id: string }).id);
    } catch (err) {
      errors++;
      console.error(`Work item creation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { created: created.length, skipped, errors, workItemIds: created };
}

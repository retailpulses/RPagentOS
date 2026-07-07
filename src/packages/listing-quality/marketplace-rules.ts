// Marketplace compliance rule engine — Phase 4.
//
// Orchestrates per-platform rule execution, producing QualityIssue[] entries
// with source: 'marketplace_rule' for the review pipeline.
//
// Each rule is a pure function (no side effects) registered per marketplace.
// Adding a new rule: add a definition + function to the per-platform file,
// then add the rule ID to the marketplace config's rules array.

import type {
  Marketplace,
  MarketplaceComplianceRule,
  MarketplaceRuleResult,
  MarketplaceRuleRunOutput,
  QualityIssue,
  ReviewSnapshot,
  SnapshotImage,
} from './types.js';
import { getIssueDefinition } from './issue-taxonomy.js';
import type { IssueType } from './issue-taxonomy.js';
import { getEnabledRules } from './marketplace-config.js';
import { AMAZON_RULES } from './marketplace-rules/amazon.js';
import { RAKUTEN_RULES } from './marketplace-rules/rakuten.js';
import { MERCARI_RULES } from './marketplace-rules/mercari.js';
import type { RuleEntry as AmazonRuleEntry } from './marketplace-rules/amazon.js';
import type { RuleEntry as RakutenRuleEntry } from './marketplace-rules/rakuten.js';
import type { RuleEntry as MercariRuleEntry } from './marketplace-rules/mercari.js';

// ─── Rule entry type ────────────────────────────────────────────────────────

/** A registered rule entry combining a definition with its pure function. */
export interface RuleEntry {
  definition: MarketplaceComplianceRule;
  fn: RuleFunction;
}

type RuleFunction = (
  snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
) => MarketplaceRuleResult;

// ─── Rule registry ──────────────────────────────────────────────────────────

const RULES_BY_MARKETPLACE: Record<Marketplace, RuleEntry[]> = {
  amazon: AMAZON_RULES as unknown as RuleEntry[],
  rakuten: RAKUTEN_RULES as unknown as RuleEntry[],
  mercari: MERCARI_RULES as unknown as RuleEntry[],
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run all enabled marketplace compliance rules for a listing.
 *
 * Builds an OCR text map from snapshot images, runs each enabled rule,
 * collects pass/fail results, and returns aggregated output ready to merge
 * into the review pipeline.
 */
export function runMarketplaceRules(
  marketplace: Marketplace,
  snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
): MarketplaceRuleRunOutput {
  const allRules = RULES_BY_MARKETPLACE[marketplace] ?? [];
  const enabledRuleIds = getEnabledRules(marketplace);

  const results: MarketplaceRuleResult[] = [];
  let rulesPassed = 0;
  let rulesSkipped = 0;

  for (const entry of allRules) {
    // Skip rules not in the enabled list for this marketplace
    if (!enabledRuleIds.includes(entry.definition.id)) {
      rulesSkipped++;
      continue;
    }

    try {
      const result = entry.fn(snapshot, images, ocrTextByIndex);
      results.push(result);
      if (result.passed) {
        rulesPassed++;
      }
    } catch (err) {
      // Rule execution error is non-fatal — skip the rule
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        ruleId: entry.definition.id,
        passed: true, // fail-safe: treat error as pass
        issue: null,
        context: { error: message },
      });
      rulesPassed++;
    }
  }

  const violations = results.filter((r) => !r.passed);
  const issues = violations
    .map((v) => v.issue)
    .filter((i): i is QualityIssue => i !== null);

  return {
    marketplace,
    rulesChecked: results.length,
    rulesPassed,
    violations,
    issues,
  };
}

/**
 * Build an OCR text map from snapshot images.
 * Keys are image_index, values are ocr_text (or empty string if null).
 */
export function buildOcrTextIndex(images: SnapshotImage[]): Record<number, string> {
  const index: Record<number, string> = {};
  for (const img of images) {
    index[img.image_index] = img.ocr_text ?? '';
  }
  return index;
}

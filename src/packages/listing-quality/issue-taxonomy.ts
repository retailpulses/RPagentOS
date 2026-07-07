// Issue taxonomy — formal registry of quality issue types replacing Phase 1's
// freeform strings. Each issue type belongs to a category, has a default
// severity and source, and carries an operator-facing note template.
//
// New issue types should be registered here, not hardcoded in the review runner.

import type { Marketplace } from './types.js';

// ─── Category & type definitions ────────────────────────────────────────────

export const ISSUE_CATEGORIES = {
  image_technical: [
    'broken_image_url',
    'image_slow_load',
    'image_low_resolution',
  ],
  image_content: [
    'duplicate_url',
    'duplicate_content',
    'missing_main_image',
    'image_count_low',
    'image_gap',
  ],
  image_compliance: [
    'image_text_overlay',
    'image_watermark',
    'image_size_noncompliant',
  ],
  content_quality: [
    'title_too_short',
    'title_spammy',
    'description_missing',
    'description_too_short',
    'missing_dimensions',
    'missing_material',
  ],
  compliance: [
    'missing_required_fields',
    'forbidden_claims',
    'category_mismatch',
  ],
  conversion: [
    'weak_main_image',
    'no_lifestyle_image',
    'no_scale_reference',
    'no_detail_closeup',
  ],
  operational: [
    'price_anomaly',
    'stock_mismatch',
    'status_inconsistent',
  ],
} as const;

export type IssueCategory = keyof typeof ISSUE_CATEGORIES;
export type IssueType = typeof ISSUE_CATEGORIES[IssueCategory][number];

// ─── Severity ───────────────────────────────────────────────────────────────

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueSource = 'technical' | 'ocr' | 'marketplace_rule' | 'qwen_visual' | 'human';

// ─── Issue definition ───────────────────────────────────────────────────────

export interface IssueDefinition {
  type: IssueType;
  category: IssueCategory;
  defaultSeverity: IssueSeverity;
  defaultSource: IssueSource;
  /** Template for operator-facing guidance. Use {n} for positional placeholders. */
  operatorNoteTemplate: string;
  /** What this issue type affects in the score engine. */
  affectsScores: (keyof MarketplaceScoreWeights)[];
}

// Re-use the weights key type
import type { MarketplaceScoreWeights } from './marketplace-config.js';

// ─── Registry ───────────────────────────────────────────────────────────────

const REGISTRY: Record<IssueType, IssueDefinition> = {
  // ── image_technical ──
  broken_image_url: {
    type: 'broken_image_url',
    category: 'image_technical',
    defaultSeverity: 'high',
    defaultSource: 'technical',
    operatorNoteTemplate: '{count} image(s) failed to load. Check URLs or re-upload.',
    affectsScores: ['technical', 'operationalRisk'],
  },
  image_slow_load: {
    type: 'image_slow_load',
    category: 'image_technical',
    defaultSeverity: 'low',
    defaultSource: 'technical',
    operatorNoteTemplate: '{count} image(s) loaded slowly. Consider compressing or using a CDN.',
    affectsScores: ['technical'],
  },
  image_low_resolution: {
    type: 'image_low_resolution',
    category: 'image_technical',
    defaultSeverity: 'medium',
    defaultSource: 'technical',
    operatorNoteTemplate: '{count} image(s) below minimum dimension. Replace with higher resolution.',
    affectsScores: ['technical', 'image'],
  },

  // ── image_content ──
  duplicate_url: {
    type: 'duplicate_url',
    category: 'image_content',
    defaultSeverity: 'medium',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Same URL used at positions {positions}. Remove duplicates.',
    affectsScores: ['image'],
  },
  duplicate_content: {
    type: 'duplicate_content',
    category: 'image_content',
    defaultSeverity: 'low',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Identical image content at positions {positions}. Consolidate.',
    affectsScores: ['image'],
  },
  missing_main_image: {
    type: 'missing_main_image',
    category: 'image_content',
    defaultSeverity: 'critical',
    defaultSource: 'technical',
    operatorNoteTemplate: 'No main image detected. Listing may not display correctly.',
    affectsScores: ['image', 'conversion', 'operationalRisk'],
  },
  image_count_low: {
    type: 'image_count_low',
    category: 'image_content',
    defaultSeverity: 'high',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Only {count} image(s) — marketplace recommends {recommended}. Add more images.',
    affectsScores: ['image', 'conversion'],
  },
  image_gap: {
    type: 'image_gap',
    category: 'image_content',
    defaultSeverity: 'low',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Gap in image sequence at positions {positions}. Check image ordering.',
    affectsScores: ['image'],
  },

  // ── image_compliance ──
  image_text_overlay: {
    type: 'image_text_overlay',
    category: 'image_compliance',
    defaultSeverity: 'medium',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'Image at position {pos} contains text overlay — may violate marketplace guidelines.',
    affectsScores: ['compliance'],
  },
  image_watermark: {
    type: 'image_watermark',
    category: 'image_compliance',
    defaultSeverity: 'high',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'Image at position {pos} may contain a watermark. Remove or replace.',
    affectsScores: ['compliance'],
  },
  image_size_noncompliant: {
    type: 'image_size_noncompliant',
    category: 'image_compliance',
    defaultSeverity: 'medium',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Image at position {pos} ({w}x{h}) does not meet size requirements.',
    affectsScores: ['compliance', 'technical'],
  },

  // ── content_quality ──
  title_too_short: {
    type: 'title_too_short',
    category: 'content_quality',
    defaultSeverity: 'high',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Title is too short ({chars} chars). Add product identifiers and key features.',
    affectsScores: ['content', 'conversion'],
  },
  title_spammy: {
    type: 'title_spammy',
    category: 'content_quality',
    defaultSeverity: 'medium',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Title may contain spammy patterns. Rewrite for clarity.',
    affectsScores: ['content'],
  },
  description_missing: {
    type: 'description_missing',
    category: 'content_quality',
    defaultSeverity: 'high',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'No product description found. Add description with specs and features.',
    affectsScores: ['content', 'conversion'],
  },
  description_too_short: {
    type: 'description_too_short',
    category: 'content_quality',
    defaultSeverity: 'medium',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Description is too short ({chars} chars). Add details to help buyers.',
    affectsScores: ['content'],
  },
  missing_dimensions: {
    type: 'missing_dimensions',
    category: 'content_quality',
    defaultSeverity: 'medium',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'No dimension/size information found in listing images or text.',
    affectsScores: ['content', 'compliance'],
  },
  missing_material: {
    type: 'missing_material',
    category: 'content_quality',
    defaultSeverity: 'low',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'No material information found. Add material/spec details.',
    affectsScores: ['content'],
  },

  // ── compliance ──
  missing_required_fields: {
    type: 'missing_required_fields',
    category: 'compliance',
    defaultSeverity: 'high',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Required fields missing: {fields}. Complete before publish.',
    affectsScores: ['compliance', 'operationalRisk'],
  },
  forbidden_claims: {
    type: 'forbidden_claims',
    category: 'compliance',
    defaultSeverity: 'critical',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Listing may contain forbidden claims. Review and remove if confirmed.',
    affectsScores: ['compliance', 'operationalRisk'],
  },
  category_mismatch: {
    type: 'category_mismatch',
    category: 'compliance',
    defaultSeverity: 'high',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Product category may not match listing content. Verify categorization.',
    affectsScores: ['compliance', 'conversion'],
  },

  // ── conversion ──
  weak_main_image: {
    type: 'weak_main_image',
    category: 'conversion',
    defaultSeverity: 'high',
    defaultSource: 'technical',
    operatorNoteTemplate: 'Main image may be weak (low res, not product-focused). Replace with a clear hero shot.',
    affectsScores: ['conversion', 'image'],
  },
  no_lifestyle_image: {
    type: 'no_lifestyle_image',
    category: 'conversion',
    defaultSeverity: 'medium',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'No lifestyle/in-context image found. Add a "product in use" photo.',
    affectsScores: ['conversion'],
  },
  no_scale_reference: {
    type: 'no_scale_reference',
    category: 'conversion',
    defaultSeverity: 'low',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'No scale reference image found. Add an image showing product size.',
    affectsScores: ['conversion'],
  },
  no_detail_closeup: {
    type: 'no_detail_closeup',
    category: 'conversion',
    defaultSeverity: 'low',
    defaultSource: 'ocr',
    operatorNoteTemplate: 'No detail/closeup image found. Add zoomed-in detail shots.',
    affectsScores: ['conversion'],
  },

  // ── operational ──
  price_anomaly: {
    type: 'price_anomaly',
    category: 'operational',
    defaultSeverity: 'high',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Price ({price}) is outside expected range. Verify pricing.',
    affectsScores: ['operationalRisk', 'compliance'],
  },
  stock_mismatch: {
    type: 'stock_mismatch',
    category: 'operational',
    defaultSeverity: 'medium',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Stock/quantity data is inconsistent. Verify inventory.',
    affectsScores: ['operationalRisk'],
  },
  status_inconsistent: {
    type: 'status_inconsistent',
    category: 'operational',
    defaultSeverity: 'medium',
    defaultSource: 'marketplace_rule',
    operatorNoteTemplate: 'Listing status is inconsistent with available data. Review status.',
    affectsScores: ['operationalRisk'],
  },
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function getIssueDefinition(type: IssueType): IssueDefinition {
  const def = REGISTRY[type];
  if (!def) throw new Error(`Unknown issue type: ${type}`);
  return def;
}

export function getIssueTypesForCategory(category: IssueCategory): IssueType[] {
  return [...ISSUE_CATEGORIES[category]];
}

export function getCategoryForIssueType(type: IssueType): IssueCategory {
  return getIssueDefinition(type).category;
}

export function getAllIssueTypes(): IssueType[] {
  return Object.keys(REGISTRY) as IssueType[];
}

export function getAllCategories(): IssueCategory[] {
  return Object.keys(ISSUE_CATEGORIES) as IssueCategory[];
}

/**
 * Returns the score dimensions affected by a set of issue types.
 * Used by the score engine to determine which dimensions to compute.
 */
export function getAffectedScoreDimensions(types: IssueType[]): (keyof MarketplaceScoreWeights)[] {
  const dims = new Set<keyof MarketplaceScoreWeights>();
  for (const t of types) {
    for (const d of getIssueDefinition(t).affectsScores) {
      dims.add(d);
    }
  }
  return [...dims];
}

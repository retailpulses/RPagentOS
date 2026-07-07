// Mercari Shops marketplace compliance rules — Phase 4.
//
// Pure functions — no side effects, no DB calls.
// Each rule takes (snapshot, images, ocrTextByIndex) and returns a MarketplaceRuleResult.

import type { MarketplaceComplianceRule, MarketplaceRuleResult, QualityIssue, ReviewSnapshot, SnapshotImage } from '../types.js';
import { getIssueDefinition } from '../issue-taxonomy.js';
import type { IssueType } from '../issue-taxonomy.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuleEntry {
  definition: MarketplaceComplianceRule;
  fn: RuleFunction;
}

type RuleFunction = (
  snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
) => MarketplaceRuleResult;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRuleIssue(
  issueType: string,
  marketplace: 'mercari',
  overrides: Partial<Pick<QualityIssue, 'severity' | 'confidence' | 'affected_image_indexes' | 'evidence' | 'operator_note' | 'expected_impact'>> & {
    requires_human_approval?: boolean;
    suggested_owner?: string | null;
  },
): QualityIssue {
  const def = getIssueDefinition(issueType as IssueType);
  return {
    type: issueType,
    severity: overrides.severity ?? def.defaultSeverity,
    confidence: overrides.confidence ?? 0.8,
    source: 'marketplace_rule',
    marketplace: 'mercari',
    affected_image_indexes: overrides.affected_image_indexes ?? [],
    evidence: overrides.evidence ?? '',
    operator_note: overrides.operator_note ?? def.operatorNoteTemplate,
    requires_human_approval: overrides.requires_human_approval ?? true,
    suggested_owner: overrides.suggested_owner ?? 'listing_team',
    expected_impact: overrides.expected_impact ?? null,
  };
}

function makeResult(
  ruleId: string,
  passed: boolean,
  issue: QualityIssue | null,
  context: Record<string, unknown>,
): MarketplaceRuleResult {
  return { ruleId, passed, issue, context };
}

// ─── Rule: mercari_image_count_3plus ─────────────────────────────────────────

const definitionImageCount3: MarketplaceComplianceRule = {
  id: 'mercari_image_count_3plus',
  marketplace: 'mercari',
  category: 'image_compliance',
  issueType: 'image_count_low',
  defaultSeverity: 'medium',
  description: 'Mercari minimum is 1, recommends 3+ images',
  operatorNoteTemplate: 'Only {count} image(s) — Mercari recommends at least 3 images.',
  requiresHumanApproval: false,
};

function checkImageCount3Plus(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const loadedCount = images.filter((img) => img.loaded).length;
  if (loadedCount < 3) {
    const issue = makeRuleIssue('image_count_low', 'mercari', {
      severity: loadedCount === 1 ? 'high' : 'medium',
      affected_image_indexes: images.map((img) => img.image_index),
      evidence: `Only ${loadedCount} loaded image(s). Mercari recommends 3+.`,
      operator_note: `Only ${loadedCount} image(s) loaded — Mercari recommends at least 3 images.`,
    });
    return makeResult('mercari_image_count_3plus', false, issue, {
      loaded_count: loadedCount,
      total_images: images.length,
      recommended: 3,
    });
  }

  return makeResult('mercari_image_count_3plus', true, null, { loaded_count: loadedCount });
}

// ─── Rule: mercari_no_external_links ─────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s\]"'<>(){}]+/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const definitionNoExternalLinks: MarketplaceComplianceRule = {
  id: 'mercari_no_external_links',
  marketplace: 'mercari',
  category: 'compliance',
  issueType: 'external_link_in_description',
  defaultSeverity: 'high',
  description: 'Check description for URLs/external links',
  operatorNoteTemplate: 'Description contains external URL(s) or contact information. Remove to avoid policy violations.',
  requiresHumanApproval: true,
};

function checkNoExternalLinks(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const description = snapshot.description ?? '';
  const title = snapshot.title ?? '';
  const combined = `${title} ${description}`;

  const urls = combined.match(URL_PATTERN);
  const emails = combined.match(EMAIL_PATTERN);

  if ((urls && urls.length > 0) || (emails && emails.length > 0)) {
    const links = [...(urls ?? []), ...(emails ?? [])];
    const issue = makeRuleIssue('external_link_in_description', 'mercari', {
      evidence: `Found external links or contacts: ${links.join(', ')}.`,
      operator_note: 'Description contains external URL(s) or contact information. Remove to avoid Mercari policy violations.',
    });
    return makeResult('mercari_no_external_links', false, issue, {
      urls_found: urls ?? [],
      emails_found: emails ?? [],
    });
  }

  return makeResult('mercari_no_external_links', true, null, { checked: true });
}

// ─── Rule: mercari_used_item_condition_photo ─────────────────────────────────

const USED_KEYWORDS = [
  'used', '中古', 'second hand', 'secondhand', 'pre-owned', 'preowned',
  'vintage', '古着', '中古品', '中古商品', 'used item', 'used goods',
];

const definitionUsedConditionPhoto: MarketplaceComplianceRule = {
  id: 'mercari_used_item_condition_photo',
  marketplace: 'mercari',
  category: 'conversion',
  issueType: 'used_item_no_condition_photo',
  defaultSeverity: 'medium',
  description: 'If used/中古, should have 3+ images showing condition',
  operatorNoteTemplate: 'Listing is for used/中古 item but lacks sufficient condition photos. Add close-up shots showing actual condition.',
  requiresHumanApproval: false,
};

function checkUsedItemConditionPhoto(
  snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const status = snapshot.marketplace_status ?? '';
  const title = snapshot.title ?? '';
  const description = snapshot.description ?? '';
  const combined = `${status} ${title} ${description}`.toLowerCase();

  const isUsed = USED_KEYWORDS.some((kw) => combined.includes(kw));
  if (!isUsed) {
    return makeResult('mercari_used_item_condition_photo', true, null, { is_used_item: false });
  }

  const loadedCount = images.filter((img) => img.loaded).length;
  if (loadedCount < 3) {
    const issue = makeRuleIssue('used_item_no_condition_photo', 'mercari', {
      evidence: `Used/中古 listing with only ${loadedCount} loaded image(s). Add condition photos.`,
      operator_note: 'Listing is for used/中古 item but has only {count} image(s). Add close-up shots showing actual item condition.',
    });
    return makeResult('mercari_used_item_condition_photo', false, issue, {
      is_used_item: true,
      loaded_images: loadedCount,
      recommended: 3,
      status_keywords: USED_KEYWORDS.filter((kw) => combined.includes(kw)),
    });
  }

  return makeResult('mercari_used_item_condition_photo', true, null, {
    is_used_item: true,
    loaded_images: loadedCount,
  });
}

// ─── Rule: mercari_shipping_info ─────────────────────────────────────────────

const SHIPPING_KEYWORDS = [
  '配送', '発送', 'shipping', 'delivery', 'ship', '発送方法',
  '配送方法', '送料', '発送目安', 'shipping method',
  'delivery time', 'shipping time', '発送期間',
];

const definitionShippingInfo: MarketplaceComplianceRule = {
  id: 'mercari_shipping_info',
  marketplace: 'mercari',
  category: 'content_quality',
  issueType: 'shipping_info_missing',
  defaultSeverity: 'low',
  description: 'Description should mention shipping method/time',
  operatorNoteTemplate: 'Description does not mention shipping or delivery information. Consider adding shipping method and delivery time.',
  requiresHumanApproval: false,
};

function checkShippingInfo(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const description = snapshot.description ?? '';
  if (description.length === 0) {
    return makeResult('mercari_shipping_info', true, null, { reason: 'No description to check' });
  }

  const hasShippingInfo = SHIPPING_KEYWORDS.some((kw) => description.includes(kw));
  if (!hasShippingInfo) {
    const issue = makeRuleIssue('shipping_info_missing', 'mercari', {
      evidence: 'Description does not mention shipping information.',
      operator_note: 'Description does not mention shipping method or delivery time. Consider adding shipping info for buyer confidence.',
    });
    return makeResult('mercari_shipping_info', false, issue, {
      description_length: description.length,
    });
  }

  return makeResult('mercari_shipping_info', true, null, {
    description_length: description.length,
    matched_keywords: SHIPPING_KEYWORDS.filter((kw) => description.includes(kw)),
  });
}

// ─── Rule: mercari_title_brand_model ─────────────────────────────────────────

/** Common brand keyword indicators for Mercari listings. */
const BRAND_INDICATORS = [
  // Common Japanese brand prefixes/suffixes
  'ブランド', 'brand', 'メーカー', 'maker',
  // Known brand patterns — brand followed by model/type
  /【.+】/,
  /\(.+\)/,
  /[A-Z][a-z]+\s+[A-Z]/, // "Nike Air" pattern
];

const definitionTitleBrandModel: MarketplaceComplianceRule = {
  id: 'mercari_title_brand_model',
  marketplace: 'mercari',
  category: 'content_quality',
  issueType: 'title_format_noncompliant',
  defaultSeverity: 'low',
  description: 'Title should include brand + model',
  operatorNoteTemplate: 'Title may not include brand + model information. Consider adding brand and product model for better searchability.',
  requiresHumanApproval: true,
};

function checkTitleBrandModel(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const title = snapshot.title;
  if (!title || title.trim().length === 0) {
    return makeResult('mercari_title_brand_model', true, null, { reason: 'No title to check' });
  }

  // Heuristic: check for brand indicators in title
  const hasBrandIndicator = BRAND_INDICATORS.some((indicator) => {
    if (typeof indicator === 'string') {
      return title.toLowerCase().includes(indicator);
    }
    return indicator.test(title);
  });

  const wordCount = title.split(/[\s,，、.．]+/).filter(Boolean).length;

  if (!hasBrandIndicator && wordCount < 4) {
    const issue = makeRuleIssue('title_format_noncompliant', 'mercari', {
      severity: 'low',
      evidence: `Title "${title}" has only ${wordCount} words and no brand indicator.`,
      operator_note: 'Title may not include brand + model information. Consider adding brand name and product model for better searchability.',
    });
    return makeResult('mercari_title_brand_model', false, issue, {
      title,
      word_count: wordCount,
      has_brand_indicator: hasBrandIndicator,
    });
  }

  return makeResult('mercari_title_brand_model', true, null, {
    word_count: wordCount,
    has_brand_indicator: hasBrandIndicator,
  });
}

// ─── Export: All Mercari rules ───────────────────────────────────────────────

export const MERCARI_RULES: RuleEntry[] = [
  { definition: definitionImageCount3, fn: checkImageCount3Plus },
  { definition: definitionNoExternalLinks, fn: checkNoExternalLinks },
  { definition: definitionUsedConditionPhoto, fn: checkUsedItemConditionPhoto },
  { definition: definitionShippingInfo, fn: checkShippingInfo },
  { definition: definitionTitleBrandModel, fn: checkTitleBrandModel },
];

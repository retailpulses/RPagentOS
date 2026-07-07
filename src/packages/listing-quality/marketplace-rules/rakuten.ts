// Rakuten Ichiba marketplace compliance rules — Phase 4.
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
  marketplace: 'rakuten',
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
    marketplace: 'rakuten',
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

// ─── Rule: rakuten_image_count_5plus ─────────────────────────────────────────

const definitionImageCount5: MarketplaceComplianceRule = {
  id: 'rakuten_image_count_5plus',
  marketplace: 'rakuten',
  category: 'image_compliance',
  issueType: 'image_count_low',
  defaultSeverity: 'medium',
  description: 'Rakuten recommends 5+ images',
  operatorNoteTemplate: 'Only {count} image(s) — Rakuten recommends at least 5 images.',
  requiresHumanApproval: false,
};

function checkImageCount5Plus(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const loadedCount = images.filter((img) => img.loaded).length;
  if (loadedCount < 5) {
    const issue = makeRuleIssue('image_count_low', 'rakuten', {
      severity: 'medium',
      affected_image_indexes: images.map((img) => img.image_index),
      evidence: `Only ${loadedCount} loaded image(s). Rakuten recommends 5+.`,
      operator_note: `Only ${loadedCount} image(s) loaded — Rakuten recommends at least 5 images.`,
    });
    return makeResult('rakuten_image_count_5plus', false, issue, {
      loaded_count: loadedCount,
      total_images: images.length,
      recommended: 5,
    });
  }

  return makeResult('rakuten_image_count_5plus', true, null, { loaded_count: loadedCount });
}

// ─── Rule: rakuten_no_price_in_image ─────────────────────────────────────────

/** Price pattern regex checking for currency symbols in OCR text. */
const PRICE_PATTERNS = [
  /[¥￥]\s*\d+/,           // ¥1000 or ￥1000
  /\d+\s*[円¥￥]/,         // 1000円, 1000¥, 1000￥
  /\bJPY\s*\d+/i,          // JPY 1000
  /\$\s*\d+(?:[,.]\d+)?/,  // $1000.00
];

const definitionNoPriceInImage: MarketplaceComplianceRule = {
  id: 'rakuten_no_price_in_image',
  marketplace: 'rakuten',
  category: 'compliance',
  issueType: 'forbidden_claims',
  defaultSeverity: 'high',
  description: 'Check OCR text for price patterns in images',
  operatorNoteTemplate: 'Image at position {pos} may contain price information. Rakuten discourages price displays in images.',
  requiresHumanApproval: true,
};

function checkNoPriceInImage(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const imageIndexesWithPrices: number[] = [];

  for (const img of images) {
    if (!img.loaded) continue;
    const text = ocrTextByIndex[img.image_index] ?? '';
    if (text.length === 0) continue;

    const hasPrice = PRICE_PATTERNS.some((pattern) => pattern.test(text));
    if (hasPrice) {
      imageIndexesWithPrices.push(img.image_index);
    }
  }

  if (imageIndexesWithPrices.length > 0) {
    const issue = makeRuleIssue('forbidden_claims', 'rakuten', {
      severity: 'high',
      confidence: 0.6,
      affected_image_indexes: imageIndexesWithPrices,
      evidence: `Price pattern detected in image(s) at positions: ${imageIndexesWithPrices.join(', ')}.`,
      operator_note: `Image(s) at position(s) ${imageIndexesWithPrices.join(', ')} may contain price information. Rakuten discourages price displays in images.`,
    });
    return makeResult('rakuten_no_price_in_image', false, issue, {
      image_indexes_with_price: imageIndexesWithPrices,
    });
  }

  return makeResult('rakuten_no_price_in_image', true, null, { images_checked: images.length });
}

// ─── Rule: rakuten_category_fields ───────────────────────────────────────────

/** Key product fact fields expected for Rakuten listings. */
const RAKUTEN_REQUIRED_FIELDS = [
  'brand', 'メーカー', 'メーカー名',
  'material', '素材', '素材名',
  'size', 'サイズ',
  'color', 'カラー',
  'origin', '原産国', '生産国',
];

const definitionCategoryFields: MarketplaceComplianceRule = {
  id: 'rakuten_category_fields',
  marketplace: 'rakuten',
  category: 'compliance',
  issueType: 'missing_category_fields',
  defaultSeverity: 'medium',
  description: 'Check product_facts for category-specific required fields',
  operatorNoteTemplate: 'Missing product fact fields: {fields}. Add category-specific information.',
  requiresHumanApproval: false,
};

function checkCategoryFields(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const facts = snapshot.product_facts_json;
  if (!facts || Object.keys(facts).length === 0) {
    const issue = makeRuleIssue('missing_category_fields', 'rakuten', {
      evidence: 'No product facts found. Category-specific fields are missing.',
      operator_note: 'No product fact fields found. Add category-specific information like brand, material, and size.',
    });
    return makeResult('rakuten_category_fields', false, issue, {
      facts_keys: [],
      missing_fields: RAKUTEN_REQUIRED_FIELDS,
    });
  }

  const factKeysLower = Object.keys(facts).map((k) => k.toLowerCase());
  const missingFields: string[] = [];

  for (const field of RAKUTEN_REQUIRED_FIELDS) {
    const fieldLower = field.toLowerCase();
    const found = factKeysLower.some(
      (k) => k === fieldLower || k.includes(fieldLower) || fieldLower.includes(k),
    );
    if (!found) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    const issue = makeRuleIssue('missing_category_fields', 'rakuten', {
      evidence: `Missing fields: ${missingFields.join(', ')}.`,
      operator_note: `Missing category-specific product fact fields: ${missingFields.join(', ')}. Add required information.`,
    });
    return makeResult('rakuten_category_fields', false, issue, {
      fact_keys: Object.keys(facts),
      missing_fields: missingFields,
    });
  }

  return makeResult('rakuten_category_fields', true, null, { fact_keys: Object.keys(facts) });
}

// ─── Rule: rakuten_title_length ──────────────────────────────────────────────

const definitionTitleLength: MarketplaceComplianceRule = {
  id: 'rakuten_title_length',
  marketplace: 'rakuten',
  category: 'content_quality',
  issueType: 'title_format_noncompliant',
  defaultSeverity: 'medium',
  description: 'Title should be 20-80 chars for Rakuten',
  operatorNoteTemplate: 'Title is {length} chars. Rakuten recommends title length of 20-80 characters.',
  requiresHumanApproval: false,
};

function checkTitleLength(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const title = snapshot.title;
  if (!title) {
    return makeResult('rakuten_title_length', true, null, { reason: 'No title to check' });
  }

  const length = title.length;
  if (length < 20) {
    const issue = makeRuleIssue('title_format_noncompliant', 'rakuten', {
      severity: 'medium',
      evidence: `Title is too short: ${length} chars. Minimum 20 chars recommended for Rakuten.`,
      operator_note: `Title is only ${length} characters. Rakuten recommends 20-80 characters for better discoverability.`,
    });
    return makeResult('rakuten_title_length', false, issue, {
      title_length: length,
      min_recommended: 20,
      max_recommended: 80,
    });
  }

  if (length > 80) {
    const issue = makeRuleIssue('title_format_noncompliant', 'rakuten', {
      severity: 'low',
      evidence: `Title is long: ${length} chars. Consider keeping under 80 chars for Rakuten.`,
      operator_note: `Title is ${length} characters. Rakuten typically recommends titles under 80 characters.`,
    });
    return makeResult('rakuten_title_length', false, issue, {
      title_length: length,
      min_recommended: 20,
      max_recommended: 80,
    });
  }

  return makeResult('rakuten_title_length', true, null, { title_length: length });
}

// ─── Rule: rakuten_description_min_200 ───────────────────────────────────────

const definitionDescriptionMin200: MarketplaceComplianceRule = {
  id: 'rakuten_description_min_200',
  marketplace: 'rakuten',
  category: 'content_quality',
  issueType: 'description_too_short',
  defaultSeverity: 'medium',
  description: 'Description should be 200+ chars for Rakuten',
  operatorNoteTemplate: 'Description is {length} chars. Rakuten recommends at least 200 characters.',
  requiresHumanApproval: false,
};

function checkDescriptionMin200(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const description = snapshot.description;
  if (!description || description.trim().length === 0) {
    const issue = makeRuleIssue('description_too_short', 'rakuten', {
      severity: 'high',
      evidence: 'No description found.',
      operator_note: 'No product description found. Rakuten recommends at least 200 characters.',
    });
    return makeResult('rakuten_description_min_200', false, issue, {
      description_length: 0,
      recommended: 200,
    });
  }

  const length = description.length;
  if (length < 200) {
    const issue = makeRuleIssue('description_too_short', 'rakuten', {
      severity: length < 50 ? 'high' : 'medium',
      evidence: `Description is ${length} chars. Rakuten recommends 200+ chars.`,
      operator_note: `Description is ${length} characters. Rakuten recommends at least 200 characters for product descriptions.`,
    });
    return makeResult('rakuten_description_min_200', false, issue, {
      description_length: length,
      recommended: 200,
    });
  }

  return makeResult('rakuten_description_min_200', true, null, { description_length: length });
}

// ─── Export: All Rakuten rules ───────────────────────────────────────────────

export const RAKUTEN_RULES: RuleEntry[] = [
  { definition: definitionImageCount5, fn: checkImageCount5Plus },
  { definition: definitionNoPriceInImage, fn: checkNoPriceInImage },
  { definition: definitionCategoryFields, fn: checkCategoryFields },
  { definition: definitionTitleLength, fn: checkTitleLength },
  { definition: definitionDescriptionMin200, fn: checkDescriptionMin200 },
];

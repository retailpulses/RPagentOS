// Amazon JP marketplace compliance rules — Phase 4.
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
  marketplace: 'amazon',
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
    marketplace: 'amazon',
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

function findMainImage(images: SnapshotImage[]): SnapshotImage | undefined {
  return images.find((img) => img.is_main_image);
}

/** Prohibited claims/phrases for Amazon JP. */
const PROHIBITED_PHRASES = [
  'best', '#1', 'guaranteed', '100%', 'perfect', 'top rated',
  'number one', '#1 seller', 'bestseller', 'best seller',
  'no.1', 'no 1', 'safe', 'organic', 'natural',
  'cure', 'treatment', 'guarantee', 'money back',
  'miracle', 'magic', 'instant', 'overnight',
];

/** Common Japanese brand-like indicators or product name separators. */
const BRAND_PRODUCT_PATTERNS = [
  /【.+】/,  // 【Brand Name】
  /\(.+\)/, // (Brand Name)
  /[／／]/, // slash separator
  /[◆◇■□]/, // bullet markers
  /[A-Z][a-z]+/, // at least one capitalized word (brand)
];

// ─── Rule: amazon_main_image_white_bg ────────────────────────────────────────

const definitionWhiteBg: MarketplaceComplianceRule = {
  id: 'amazon_main_image_white_bg',
  marketplace: 'amazon',
  category: 'image_compliance',
  issueType: 'non_white_background',
  defaultSeverity: 'high',
  description: 'Main image should have white/RGB(255,255,255) background',
  operatorNoteTemplate: 'Main image background may not be pure white. Amazon requires white background for main image.',
  requiresHumanApproval: true,
};

function checkWhiteBackground(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const mainImg = findMainImage(images);
  if (!mainImg) {
    return makeResult('amazon_main_image_white_bg', true, null, { reason: 'No main image to check' });
  }

  const mainOcrText = ocrTextByIndex[mainImg.image_index] ?? '';

  if (mainOcrText.length > 0) {
    const nonWhiteBgHints = /背景|background|色|カラー|blue|red|green|black/i.test(mainOcrText);
    if (nonWhiteBgHints) {
      const issue = makeRuleIssue('non_white_background', 'amazon', {
        affected_image_indexes: [mainImg.image_index],
        evidence: `Main image OCR text suggests non-white background.`,
        operator_note: 'Main image background may not be pure white. Amazon requires pure white (RGB 255,255,255) for main image.',
      });
      return makeResult('amazon_main_image_white_bg', false, issue, {
        image_index: mainImg.image_index,
        ocr_hint: 'non-white-background-keywords',
      });
    }
  }

  return makeResult('amazon_main_image_white_bg', true, null, { image_index: mainImg.image_index, ocr_text_present: mainOcrText.length > 0 });
}

// ─── Rule: amazon_main_image_no_text ─────────────────────────────────────────

const definitionNoText: MarketplaceComplianceRule = {
  id: 'amazon_main_image_no_text',
  marketplace: 'amazon',
  category: 'image_compliance',
  issueType: 'main_image_text_overlay',
  defaultSeverity: 'high',
  description: 'Main image should not contain text/logos/watermarks',
  operatorNoteTemplate: 'Main image contains text or graphics overlay — may violate Amazon main image guidelines.',
  requiresHumanApproval: true,
};

function checkMainImageNoText(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const mainImg = findMainImage(images);
  if (!mainImg) {
    return makeResult('amazon_main_image_no_text', true, null, { reason: 'No main image to check' });
  }

  const mainOcrText = ocrTextByIndex[mainImg.image_index] ?? '';
  const stripped = mainOcrText.replace(/[\s\n\r\t]+/g, '').trim();

  if (stripped.length > 20) {
    const issue = makeRuleIssue('main_image_text_overlay', 'amazon', {
      affected_image_indexes: [mainImg.image_index],
      evidence: `Main image contains text: "${mainOcrText.substring(0, 100)}"`,
      operator_note: 'Main image contains text overlay — Amazon requires text-free main images.',
    });
    return makeResult('amazon_main_image_no_text', false, issue, {
      image_index: mainImg.image_index,
      ocr_text_length: stripped.length,
    });
  }

  return makeResult('amazon_main_image_no_text', true, null, {
    image_index: mainImg.image_index,
    ocr_length: stripped.length,
  });
}

// ─── Rule: amazon_main_image_min_1600px ──────────────────────────────────────

const definitionMin1600: MarketplaceComplianceRule = {
  id: 'amazon_main_image_min_1600px',
  marketplace: 'amazon',
  category: 'image_compliance',
  issueType: 'image_size_noncompliant',
  defaultSeverity: 'high',
  description: 'Main image must be at least 1600px on longest side',
  operatorNoteTemplate: 'Main image is {w}x{h} — Amazon requires 1600px+ on the longest side.',
  requiresHumanApproval: false,
};

function checkMainImageMin1600(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const mainImg = findMainImage(images);
  if (!mainImg || mainImg.width === null || mainImg.height === null) {
    return makeResult('amazon_main_image_min_1600px', true, null, { reason: 'No main image or dimensions unavailable' });
  }

  const longestSide = Math.max(mainImg.width, mainImg.height);
  if (longestSide < 1600) {
    const issue = makeRuleIssue('image_size_noncompliant', 'amazon', {
      severity: 'high',
      affected_image_indexes: [mainImg.image_index],
      evidence: `Main image size: ${mainImg.width}x${mainImg.height}. Longest side is ${longestSide}px, required minimum is 1600px.`,
      operator_note: `Main image is ${mainImg.width}x${mainImg.height}. Amazon requires at least 1600px on longest side.`,
    });
    return makeResult('amazon_main_image_min_1600px', false, issue, {
      image_index: mainImg.image_index,
      width: mainImg.width,
      height: mainImg.height,
      longest_side: longestSide,
      required: 1600,
    });
  }

  return makeResult('amazon_main_image_min_1600px', true, null, {
    image_index: mainImg.image_index,
    width: mainImg.width,
    height: mainImg.height,
    longest_side: longestSide,
  });
}

// ─── Rule: amazon_image_count_6plus ──────────────────────────────────────────

const definitionImageCount6: MarketplaceComplianceRule = {
  id: 'amazon_image_count_6plus',
  marketplace: 'amazon',
  category: 'image_compliance',
  issueType: 'image_count_low',
  defaultSeverity: 'medium',
  description: 'Amazon recommends 6+ images',
  operatorNoteTemplate: 'Only {count} image(s) — Amazon recommends at least 6 images.',
  requiresHumanApproval: false,
};

function checkImageCount6Plus(
  _snapshot: ReviewSnapshot,
  images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const loadedCount = images.filter((img) => img.loaded).length;
  if (loadedCount < 6) {
    const issue = makeRuleIssue('image_count_low', 'amazon', {
      severity: 'medium',
      affected_image_indexes: images.map((img) => img.image_index),
      evidence: `Only ${loadedCount} loaded image(s). Amazon recommends 6+.`,
      operator_note: `Only ${loadedCount} image(s) loaded — Amazon recommends at least 6 images.`,
    });
    return makeResult('amazon_image_count_6plus', false, issue, {
      loaded_count: loadedCount,
      total_images: images.length,
      recommended: 6,
    });
  }

  return makeResult('amazon_image_count_6plus', true, null, { loaded_count: loadedCount });
}

// ─── Rule: amazon_title_format ───────────────────────────────────────────────

const definitionTitleFormat: MarketplaceComplianceRule = {
  id: 'amazon_title_format',
  marketplace: 'amazon',
  category: 'content_quality',
  issueType: 'title_format_noncompliant',
  defaultSeverity: 'medium',
  description: 'Title format should include brand + product name pattern',
  operatorNoteTemplate: 'Title format may not follow Amazon guidelines. Include brand + product name pattern.',
  requiresHumanApproval: true,
};

function checkTitleFormat(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const title = snapshot.title;
  if (!title || title.trim().length === 0) {
    return makeResult('amazon_title_format', true, null, { reason: 'No title to check' });
  }

  // Heuristic: check for brand-like patterns in the title
  const hasBrandIndicator = BRAND_PRODUCT_PATTERNS.some((pattern) => pattern.test(title));
  const hasSpaceSeparatedWords = title.split(/\s+/).length >= 3;

  if (!hasBrandIndicator && !hasSpaceSeparatedWords) {
    const issue = makeRuleIssue('title_format_noncompliant', 'amazon', {
      evidence: `Title "${title}" may not include brand + product name pattern.`,
      operator_note: 'Title format may not follow Amazon guidelines. Include brand + product name pattern.',
    });
    return makeResult('amazon_title_format', false, issue, {
      title,
      title_length: title.length,
      has_brand_indicator: hasBrandIndicator,
      word_count: title.split(/\s+/).length,
    });
  }

  return makeResult('amazon_title_format', true, null, {
    title_length: title.length,
    has_brand_indicator: hasBrandIndicator,
    word_count: title.split(/\s+/).length,
  });
}

// ─── Rule: amazon_bullet_points_count ────────────────────────────────────────

const definitionBulletPoints: MarketplaceComplianceRule = {
  id: 'amazon_bullet_points_count',
  marketplace: 'amazon',
  category: 'compliance',
  issueType: 'bullet_points_insufficient',
  defaultSeverity: 'medium',
  description: 'Should have 5 bullet points',
  operatorNoteTemplate: 'Only {count} bullet point(s) provided. Amazon recommends 5 bullet points.',
  requiresHumanApproval: false,
};

function checkBulletPointsCount(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const bulletPoints = snapshot.bullet_points_json;
  const count = bulletPoints ? bulletPoints.length : 0;

  if (count < 5) {
    const issue = makeRuleIssue('bullet_points_insufficient', 'amazon', {
      evidence: `Only ${count} bullet point(s) provided. Amazon recommends 5.`,
      operator_note: `Only ${count} bullet point(s) provided. Amazon recommends 5 bullet points.`,
    });
    return makeResult('amazon_bullet_points_count', false, issue, {
      bullet_count: count,
      recommended: 5,
    });
  }

  return makeResult('amazon_bullet_points_count', true, null, { bullet_count: count });
}

// ─── Rule: amazon_prohibited_claims ──────────────────────────────────────────

const definitionProhibitedClaims: MarketplaceComplianceRule = {
  id: 'amazon_prohibited_claims',
  marketplace: 'amazon',
  category: 'compliance',
  issueType: 'prohibited_claims_detected',
  defaultSeverity: 'high',
  description: 'Check for prohibited phrases in title/description',
  operatorNoteTemplate: 'Title or description may contain prohibited claims or phrases: {phrases}. Review and remove.',
  requiresHumanApproval: true,
};

function checkProhibitedClaims(
  snapshot: ReviewSnapshot,
  _images: SnapshotImage[],
  _ocrTextByIndex: Record<number, string>,
): MarketplaceRuleResult {
  const title = snapshot.title ?? '';
  const description = snapshot.description ?? '';
  const combined = `${title} ${description}`.toLowerCase();

  const foundPhrases: string[] = [];
  for (const phrase of PROHIBITED_PHRASES) {
    if (combined.includes(phrase.toLowerCase())) {
      foundPhrases.push(phrase);
    }
  }

  if (foundPhrases.length > 0) {
    const issue = makeRuleIssue('prohibited_claims_detected', 'amazon', {
      evidence: `Found prohibited phrases: ${foundPhrases.join(', ')} in title/description.`,
      operator_note: `Title or description may contain prohibited phrases: ${foundPhrases.join(', ')}. Review and remove.`,
    });
    return makeResult('amazon_prohibited_claims', false, issue, {
      found_phrases: foundPhrases,
      in_title: foundPhrases.some((p) => title.toLowerCase().includes(p)),
      in_description: foundPhrases.some((p) => (description ?? '').toLowerCase().includes(p)),
    });
  }

  return makeResult('amazon_prohibited_claims', true, null, { checked_phrases_count: PROHIBITED_PHRASES.length });
}

// ─── Export: All Amazon rules ─────────────────────────────────────────────────

export const AMAZON_RULES: RuleEntry[] = [
  { definition: definitionWhiteBg, fn: checkWhiteBackground },
  { definition: definitionNoText, fn: checkMainImageNoText },
  { definition: definitionMin1600, fn: checkMainImageMin1600 },
  { definition: definitionImageCount6, fn: checkImageCount6Plus },
  { definition: definitionTitleFormat, fn: checkTitleFormat },
  { definition: definitionBulletPoints, fn: checkBulletPointsCount },
  { definition: definitionProhibitedClaims, fn: checkProhibitedClaims },
];

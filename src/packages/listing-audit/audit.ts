import type {
  ListingAuditActionType,
  ListingAuditBatchResult,
  ListingAuditInput,
  ListingAuditPlatform,
  ListingAuditPriority,
  ListingAuditResult,
} from './types.js';

const TITLE_MIN_LENGTH = 18;
const DESCRIPTION_MIN_LENGTH = 80;
const REASONABLE_MIN_PRICE = 300;
const REASONABLE_MAX_PRICE = 500_000;

export function auditListings(listings: ListingAuditInput[], auditedAt = new Date().toISOString()): ListingAuditBatchResult {
  const results = listings.map(listing => auditListing(listing, auditedAt));
  const totalScore = results.reduce((sum, result) => sum + result.overallScore, 0);

  return {
    summary: {
      total: listings.length,
      audited: results.length,
      actionCounts: countBy(results, result => result.actionRecommendation.type, [
        'no_action',
        'rewrite',
        'manual_review',
        'price_check',
        'image_fix',
      ]),
      priorityCounts: countBy(results, result => result.actionRecommendation.priority, ['low', 'medium', 'high']),
      averageScore: results.length > 0 ? Math.round(totalScore / results.length) : 0,
    },
    results,
  };
}

export function auditListing(listing: ListingAuditInput, auditedAt = new Date().toISOString()): ListingAuditResult {
  const titleQuality = auditTitle(listing);
  const descriptionQuality = auditDescription(listing);
  const imageQuality = auditImages(listing);
  const pricingRisk = auditPricing(listing);

  const overallScore = clampScore(Math.round(
    titleQuality.score * 0.3
    + descriptionQuality.score * 0.3
    + imageQuality.score * 0.2
    + pricingScore(pricingRisk.level) * 0.2,
  ));

  const actionRecommendation = chooseAction({
    titleScore: titleQuality.score,
    descriptionScore: descriptionQuality.score,
    imageScore: imageQuality.score,
    pricingRisk: pricingRisk.level,
    overallScore,
    listingStatus: listing.listingStatus,
  });

  return {
    listingId: listing.listingId,
    platform: listing.platform,
    shopCode: listing.shopCode,
    sku: listing.sku,
    overallScore,
    titleQuality,
    descriptionQuality,
    imageQuality,
    pricingRisk,
    actionRecommendation,
    humanReviewRequired: actionRecommendation.type !== 'no_action' || actionRecommendation.priority !== 'low',
    sourceSnapshot: listing,
    auditedAt,
  };
}

export function normalizePlatform(value: unknown): ListingAuditPlatform {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'mercari' || normalized === 'rakuten' || normalized === 'amazon' || normalized === 'shopify') {
    return normalized;
  }
  return 'unknown';
}

function auditTitle(listing: ListingAuditInput) {
  const title = listing.title.trim();
  const issues: string[] = [];
  let score = 100;

  if (!title) {
    issues.push('missing title');
    score -= 80;
  } else {
    if (title.length < TITLE_MIN_LENGTH) {
      issues.push(`title is short (${title.length} chars)`);
      score -= 25;
    }
    if (!containsProductIdentifier(title, listing)) {
      issues.push('title may be missing SKU, color, size, or category signal');
      score -= 15;
    }
    if (hasSpammyTitlePattern(title)) {
      issues.push('title contains repeated promotional punctuation or keyword stuffing');
      score -= 20;
    }
  }

  return {
    score: clampScore(score),
    issues,
    suggestedTitle: suggestTitle(listing),
  };
}

function auditDescription(listing: ListingAuditInput) {
  const description = (listing.description ?? '').trim();
  const issues: string[] = [];
  let score = 100;

  if (!description) {
    issues.push('missing description');
    score -= 55;
  } else {
    if (description.length < DESCRIPTION_MIN_LENGTH) {
      issues.push(`description is short (${description.length} chars)`);
      score -= 30;
    }
    if (!mentionsShippingOrCondition(description, listing.raw)) {
      issues.push('description may be missing condition or shipping details');
      score -= 15;
    }
    if (!mentionsSpecs(description, listing.raw)) {
      issues.push('description may be missing product specs');
      score -= 15;
    }
  }

  return {
    score: clampScore(score),
    issues,
    suggestedDescription: suggestDescription(listing),
  };
}

function auditImages(listing: ListingAuditInput) {
  const imageUrls = listing.imageUrls ?? [];
  const issues: string[] = [];
  let score = 100;

  if (imageUrls.length === 0) {
    issues.push('no image URLs or paths provided for audit');
    score -= 35;
  } else if (imageUrls.length === 1) {
    issues.push('only one image provided');
    score -= 20;
  }

  const invalidUrls = imageUrls.filter(url => !isLikelyImageReference(url));
  if (invalidUrls.length > 0) {
    issues.push(`${invalidUrls.length} image reference(s) look invalid`);
    score -= 15;
  }

  return {
    score: clampScore(score),
    issues,
  };
}

function auditPricing(listing: ListingAuditInput): { level: ListingAuditPriority; reason: string } {
  if (listing.price === undefined || Number.isNaN(listing.price)) {
    return { level: 'high', reason: 'missing or invalid price' };
  }

  if (listing.price < REASONABLE_MIN_PRICE) {
    return { level: 'high', reason: `price ${listing.price} is below normal ecommerce floor` };
  }

  if (listing.price > REASONABLE_MAX_PRICE) {
    return { level: 'medium', reason: `price ${listing.price} is unusually high and should be checked` };
  }

  if (listing.stockQty !== undefined && listing.stockQty <= 0 && listing.listingStatus === 'active') {
    return { level: 'medium', reason: 'active listing has zero stock' };
  }

  return { level: 'low', reason: 'price and stock do not trigger deterministic risk rules' };
}

function chooseAction(input: {
  titleScore: number;
  descriptionScore: number;
  imageScore: number;
  pricingRisk: ListingAuditPriority;
  overallScore: number;
  listingStatus?: string;
}): { type: ListingAuditActionType; priority: ListingAuditPriority; reason: string } {
  if (input.pricingRisk === 'high') {
    return { type: 'price_check', priority: 'high', reason: 'pricing issue can create direct margin or order risk' };
  }

  if (input.imageScore < 70) {
    return { type: 'image_fix', priority: input.overallScore < 60 ? 'high' : 'medium', reason: 'image coverage is weak for buyer review' };
  }

  if (input.titleScore < 75 || input.descriptionScore < 75) {
    return { type: 'rewrite', priority: input.overallScore < 65 ? 'high' : 'medium', reason: 'listing content is likely suppressing conversion or search quality' };
  }

  if (input.pricingRisk === 'medium' || input.listingStatus === 'active') {
    return { type: 'manual_review', priority: 'medium', reason: 'listing is acceptable but has operational review signals' };
  }

  return { type: 'no_action', priority: 'low', reason: 'no deterministic audit issue found' };
}

function pricingScore(level: ListingAuditPriority): number {
  if (level === 'high') return 35;
  if (level === 'medium') return 70;
  return 100;
}

function containsProductIdentifier(title: string, listing: ListingAuditInput): boolean {
  const haystack = `${title} ${listing.category ?? ''}`.toLowerCase();
  const sku = listing.sku?.toLowerCase();
  if (sku && haystack.includes(sku)) return true;
  if (listing.category && haystack.includes(listing.category.toLowerCase())) return true;

  const color = stringFromRaw(listing.raw, ['color', 'カラー']);
  const size = stringFromRaw(listing.raw, ['size_text', 'size', 'サイズ']);
  return Boolean((color && haystack.includes(color.toLowerCase())) || (size && haystack.includes(size.toLowerCase())));
}

function hasSpammyTitlePattern(title: string): boolean {
  return /([!！★☆♪])\1{1,}/.test(title) || /(送料無料|新品|セール).*(送料無料|新品|セール).*(送料無料|新品|セール)/.test(title);
}

function mentionsShippingOrCondition(description: string, raw: Record<string, unknown>): boolean {
  const text = `${description} ${JSON.stringify(raw)}`;
  return /(送料|配送|発送|shipping|condition|状態|新品|中古)/i.test(text);
}

function mentionsSpecs(description: string, raw: Record<string, unknown>): boolean {
  const text = `${description} ${JSON.stringify(raw)}`;
  return /(サイズ|寸法|素材|カラー|色|重量|sku|spu|material|size|color)/i.test(text);
}

function suggestTitle(listing: ListingAuditInput): string {
  const parts = [
    listing.title.trim(),
    stringFromRaw(listing.raw, ['color', 'カラー']),
    stringFromRaw(listing.raw, ['size_text', 'size', 'サイズ']),
  ].filter(Boolean);

  return dedupeWords(parts.join(' ')).slice(0, 80);
}

function suggestDescription(listing: ListingAuditInput): string {
  const description = listing.description?.trim();
  if (description && description.length >= DESCRIPTION_MIN_LENGTH) {
    return description;
  }

  const facts = [
    listing.category ? `カテゴリ: ${listing.category}` : null,
    listing.sku ? `SKU: ${listing.sku}` : null,
    stringFromRaw(listing.raw, ['condition', '状態']) ? `状態: ${stringFromRaw(listing.raw, ['condition', '状態'])}` : null,
    stringFromRaw(listing.raw, ['shipping_paid_by']) ? `配送負担: ${stringFromRaw(listing.raw, ['shipping_paid_by'])}` : null,
  ].filter(Boolean);

  return [description, ...facts].filter(Boolean).join('\n');
}

function stringFromRaw(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isLikelyImageReference(value: string): boolean {
  return /^(https?:\/\/|\.{0,2}\/|\/).+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(value);
}

function dedupeWords(value: string): string {
  const seen = new Set<string>();
  return value
    .split(/\s+/)
    .filter(word => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

function countBy<T extends string>(results: ListingAuditResult[], getter: (result: ListingAuditResult) => T, keys: T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;
  for (const result of results) {
    counts[getter(result)]++;
  }
  return counts;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

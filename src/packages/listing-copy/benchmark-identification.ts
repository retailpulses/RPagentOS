import {
  benchmarkScopeKeyForQuery,
  extractSuitcaseSizes,
  type BenchmarkCaptureResult,
} from './benchmark-capture.js';
import type { ListingRow } from './types.js';

export interface BenchmarkScope {
  scopeKey: string;
  query: string;
  categoryId: string | null;
  categoryName: string | null;
  relevanceTerms: string[];
  assortmentStrategy: 'single_size' | 'multi_size' | 'unknown';
  offeredSizes: string[];
}

export interface BenchmarkCandidateQuality {
  valid: boolean;
  itemCount: number;
  uniqueShopCount: number;
  relevantItemCount: number;
  relevanceRatio: number;
  errors: string[];
}

export function isBenchmarkReusable(
  capturedAt: string,
  selectionMode: 'automatic' | 'operator',
  ttlDays: number,
  nowMs = Date.now(),
): boolean {
  if (selectionMode === 'operator') return true;
  const capturedAtMs = Date.parse(capturedAt);
  return Number.isFinite(capturedAtMs) && capturedAtMs >= nowMs - ttlDays * 24 * 60 * 60 * 1_000;
}

const SEGMENT_PATTERNS = [
  /(?:1|2|3|一|二|三)人掛け/u,
  /(?:シングル|セミダブル|ダブル|クイーン|キング)/u,
  /(?:電動|手動|コンセント式|充電式|コードレス)/u,
  /(?:折りたたみ|大型|小型|業務用|家庭用)/u,
  /(?:ファブリック|本革|合皮|スチール|木製)/u,
];

const FALLBACK_STOPWORDS = new Set([
  '付き', 'セット', 'カラー', 'グレー', 'ホワイト', 'ブラック', 'ブラウン',
  'おしゃれ', 'おすすめ', '商品', '完成品',
]);

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function trustedTitle(listing: ListingRow): string | null {
  const product = listing.trusted_facts.product;
  if (product && typeof product === 'object' && typeof (product as Record<string, unknown>).title === 'string') {
    return String((product as Record<string, unknown>).title);
  }
  const family = listing.trusted_facts.family;
  if (family && typeof family === 'object' && typeof (family as Record<string, unknown>).family_name === 'string') {
    return String((family as Record<string, unknown>).family_name);
  }
  return listing.title;
}

function fallbackCategoryTerms(value: string): string[] {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  const result: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(value)) {
    const term = segment.normalize('NFKC').trim();
    if (!isWordLike || term.length < 2 || /\d|%/.test(term) || FALLBACK_STOPWORDS.has(term)) continue;
    result.push(term);
    if (result.length >= 3) break;
  }
  return result;
}

export function identifyBenchmarkScope(listing: ListingRow): BenchmarkScope | null {
  const sourceTitle = trustedTitle(listing)?.trim() ?? '';
  const isSuitcase = /スーツケース|キャリーケース|キャリーバッグ|suitcase/i.test(sourceTitle);
  const assortment = listing.trusted_facts.assortment;
  const assortmentRecord = assortment && typeof assortment === 'object'
    ? assortment as Record<string, unknown>
    : {};
  const offeredSizes = Array.isArray(assortmentRecord.sizes)
    ? assortmentRecord.sizes.filter((size): size is string => typeof size === 'string')
    : extractSuitcaseSizes(sourceTitle);
  const assortmentStrategy = offeredSizes.length >= 2 ? 'multi_size'
    : offeredSizes.length === 1 ? 'single_size' : 'unknown';

  if (isSuitcase) {
    const sizeTerms = assortmentStrategy === 'multi_size'
      ? offeredSizes.map((size) => `${size}サイズ`)
      : offeredSizes.length === 1 ? [`${offeredSizes[0]}サイズ`] : [];
    const featureTerms = /TSA(?:ロック)?/i.test(sourceTitle) ? ['TSAロック'] : [];
    const query = ['スーツケース', ...sizeTerms, 'キャリーケース', ...featureTerms].join(' ');
    const hash = benchmarkScopeKeyForQuery(query).slice('query:'.length);
    const sizeKey = offeredSizes.length > 0 ? offeredSizes.join('-').toLowerCase() : 'unknown';
    return {
      scopeKey: `suitcase:${assortmentStrategy.replace('_', '-')}:${sizeKey}:${hash}`,
      query,
      categoryId: listing.category_id,
      categoryName: listing.category_name?.trim() || 'スーツケース',
      relevanceTerms: ['スーツケース', ...sizeTerms, 'キャリーケース']
        .map((term) => normalized(term)),
      assortmentStrategy,
      offeredSizes,
    };
  }
  const category = listing.category_name?.trim() || fallbackCategoryTerms(sourceTitle).join(' ');
  if (!category) return null;

  const segments: string[] = [];
  for (const pattern of SEGMENT_PATTERNS) {
    const match = sourceTitle.match(pattern)?.[0];
    if (match && !normalized(category).includes(normalized(match))) segments.push(match);
  }
  const queryTerms = [category, ...segments.slice(0, 3)];
  const query = [...new Set(queryTerms)].join(' ').trim();
  const scopeKey = benchmarkScopeKeyForQuery(query);
  return {
    scopeKey,
    query,
    categoryId: listing.category_id,
    categoryName: listing.category_name?.trim() || category,
    relevanceTerms: query.split(/\s+/).map((term) => normalized(term)).filter((term) => term.length >= 2),
    assortmentStrategy,
    offeredSizes,
  };
}

export function assessBenchmarkCandidates(
  capture: BenchmarkCaptureResult,
  scope: BenchmarkScope,
  minimumItems = 5,
  minimumShops = 3,
  minimumRelevanceRatio = 0.7,
): BenchmarkCandidateQuality {
  const relevantItemCount = capture.items.filter((item) => {
    const title = normalized(item.title);
    if (scope.scopeKey.startsWith('suitcase:')) {
      const hasProductType = ['スーツケース', 'キャリーケース', 'キャリーバッグ']
        .some((term) => title.includes(normalized(term)));
      const matchedSizes = scope.offeredSizes.filter((size) =>
        title.includes(normalized(`${size}サイズ`)) ||
        title.includes(normalized(`${size} size`)));
      const requiredSizeMatches = scope.assortmentStrategy === 'multi_size'
        ? Math.min(2, scope.offeredSizes.length) : scope.offeredSizes.length > 0 ? 1 : 0;
      return hasProductType && matchedSizes.length >= requiredSizeMatches;
    }
    const matches = scope.relevanceTerms.filter((term) => title.includes(term)).length;
    return scope.relevanceTerms.length === 0 || matches >= Math.ceil(scope.relevanceTerms.length * 0.67);
  }).length;
  const itemCount = capture.items.length;
  const uniqueShopCount = new Set(capture.items.map((item) => item.shop).filter(Boolean)).size;
  const relevanceRatio = itemCount === 0 ? 0 : relevantItemCount / itemCount;
  const errors: string[] = [];
  if (itemCount < minimumItems) errors.push(`benchmark has ${itemCount} items; requires at least ${minimumItems}`);
  if (uniqueShopCount < minimumShops) errors.push(`benchmark has ${uniqueShopCount} shops; requires at least ${minimumShops}`);
  if (relevanceRatio < minimumRelevanceRatio) {
    errors.push(`benchmark relevance ratio ${relevanceRatio.toFixed(2)} is below ${minimumRelevanceRatio.toFixed(2)}`);
  }
  return {
    valid: errors.length === 0,
    itemCount,
    uniqueShopCount,
    relevantItemCount,
    relevanceRatio,
    errors,
  };
}

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RakutenCaptureInput {
  query: string;
  scopeKey?: string;
  categoryId?: string;
  categoryName?: string;
  limit?: number;
}

export interface RakutenResultItem {
  externalListingId: string;
  listingUrl: string;
  shop: string | null;
  rankPosition: number;
  title: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  isSponsored: boolean;
}

export interface BenchmarkTargetProfile {
  titleTerms: string[];
  descriptionTopics: ReadonlyArray<{ name: string; terms: string[] }>;
  assortment: {
    strategy: 'single_size' | 'multi_size' | 'unknown';
    observedSizes: string[];
    multiSizeListingCount: number;
    multiSizeListingRatio: number;
  };
}

export interface BenchmarkCaptureResult {
  marketplace: 'rakuten';
  scopeKey: string;
  categoryId: string | null;
  categoryName: string | null;
  sourceKind: 'rakuten_search_organic';
  sourceQuery: { query: string };
  capturedAt: string;
  items: RakutenResultItem[];
  targetProfile: BenchmarkTargetProfile;
}

const SEARCH_BASE = 'https://search.rakuten.co.jp/search/mall/';
const USER_AGENT = 'Mozilla/5.0 (compatible; RPagentOSBenchmark/1.0; bounded internal category research)';
const MAX_RETRIES = 2;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const METHODOLOGY_VERSION = '1.0.0';
const RE_PRICE = /[¥￥]\s*([\d,]+)/;
const RE_REVIEW_COUNT = /[（(]\s*(\d[\d,]*)\s*件?\s*[)）]/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function cleanAnchorText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export function parseRakutenResults(html: string, limit: number): RakutenResultItem[] {
  const seen = new Set<string>();
  const items: RakutenResultItem[] = [];
  const cardPattern = /<div\s+class="[^"]*\bsearchresultitem\b[^"]*"([^>]*)>/gi;
  const cards: Array<{ index: number; end: number; tag: string; attrs: string }> = [];
  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = cardPattern.exec(html)) !== null) {
    cards.push({ index: cardMatch.index, end: cardPattern.lastIndex, tag: cardMatch[0], attrs: cardMatch[1] });
  }

  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex];
    const contextEnd = cards[cardIndex + 1]?.index ?? html.length;
    const context = html.slice(card.end, contextEnd);
    if (/\bsponsored\b/i.test(card.tag)) continue;

    const anchorPattern = /<a\s+([^>]*href="(https:\/\/item\.rakuten\.co\.jp\/([^\/]+)\/([^\/\s"'?#]+)\/[^\"]*)"[^>]*)>([\s\S]*?)<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;
    let selected: { url: string; shopCode: string; itemCode: string; title: string } | null = null;
    while ((anchorMatch = anchorPattern.exec(context)) !== null) {
      const title = cleanAnchorText(anchorMatch[5]);
      if (!title) continue;
      const candidate = {
        url: decodeHtml(anchorMatch[2]),
        shopCode: anchorMatch[3],
        itemCode: anchorMatch[4],
        title,
      };
      const attrs = anchorMatch[1];
      if (attrs.includes('data-rpp-url-copy="title"') || /title-link|class="[^"]*title/i.test(attrs)) {
        selected = candidate;
        break;
      }
      selected ??= candidate;
    }
    if (!selected || /^(?:\[PR\]|【PR】|【広告】)/i.test(selected.title)) continue;

    const externalListingId = `${selected.shopCode}/${selected.itemCode}`;
    if (seen.has(externalListingId)) continue;
    seen.add(externalListingId);

    const priceAttribute = card.tag.match(/data-track-price="(\d+)"/i);
    const contextText = cleanAnchorText(context);
    const priceText = contextText.match(RE_PRICE);
    const price = priceAttribute
      ? Number(priceAttribute[1])
      : priceText ? Number(priceText[1].replace(/,/g, '')) : null;
    const ratingText = context.match(/class="score"[^>]*>\s*(\d+(?:\.\d+)?)/i);
    const ratingCandidate = ratingText ? Number(ratingText[1]) : null;
    const rating = ratingCandidate !== null && ratingCandidate >= 0 && ratingCandidate <= 5
      ? ratingCandidate
      : null;
    const reviewText = context.match(RE_REVIEW_COUNT);
    const reviewCount = reviewText ? Number(reviewText[1].replace(/,/g, '')) : null;
    const observedPosition = card.attrs.match(/data-position-absolute="(\d+)"/i);

    items.push({
      externalListingId,
      listingUrl: selected.url,
      shop: selected.shopCode,
      rankPosition: observedPosition ? Number(observedPosition[1]) : cardIndex + 1,
      title: selected.title,
      price,
      rating,
      reviewCount,
      isSponsored: false,
    });
    if (items.length >= Math.min(Math.max(limit, 1), MAX_LIMIT)) break;
  }

  return items;
}

const TITLE_TERM_STOPWORDS = new Set([
  'off', 'オフ', 'クーポン', 'セール', 'エントリー', 'ポイント', '対象', '期間中',
  '配布', '限定', '商品', '大型商品', '送料無料', 'レビュー', '報告', 'まで', '迄',
  '付き', '掛け', '人用', 'がけ', 'タイプ',
]);

export function deriveTargetProfile(titles: string[], seedTerms: string[] = []): BenchmarkTargetProfile {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  const counts = new Map<string, number>();
  for (const title of titles) {
    const seen = new Set<string>();
    for (const { segment } of segmenter.segment(title)) {
      const word = segment.normalize('NFKC').trim();
      if (word.length < 2 || /\d|%/.test(word) ||
        /^[\d,.、。，．・「」『』【】（）()\[\]\s]+$/.test(word) ||
        TITLE_TERM_STOPWORDS.has(word.toLowerCase()) || seen.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
      seen.add(word);
    }
  }
  const minimumOccurrences = Math.max(2, Math.ceil(titles.length * 0.3));
  const frequentTerms = [...counts.entries()]
      .filter(([, count]) => count >= minimumOccurrences)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .slice(0, 20)
      .map(([term]) => term);
  const seeded = seedTerms
    .map((term) => term.normalize('NFKC').trim())
    .filter((term) => term.length >= 2 && !TITLE_TERM_STOPWORDS.has(term.toLowerCase()));
  return {
    titleTerms: [...new Set([...seeded, ...frequentTerms])].slice(0, 20),
    descriptionTopics: [{ name: 'unavailable_in_search_capture_v1', terms: [] }],
    assortment: deriveSuitcaseAssortment(titles),
  };
}

export function extractSuitcaseSizes(value: string): string[] {
  const normalized = value.normalize('NFKC').toUpperCase();
  const sizes = ['SS', 'S', 'M', 'L', 'XL'].filter((size) => {
    const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Z])${escaped}\\s*(?:サイズ|SIZE)(?:$|[^A-Z])`, 'u').test(normalized);
  });
  return sizes;
}

export function deriveSuitcaseAssortment(titles: string[]): BenchmarkTargetProfile['assortment'] {
  const sizeSets = titles.map(extractSuitcaseSizes);
  const observedSizes = [...new Set(sizeSets.flat())];
  const multiSizeListingCount = sizeSets.filter((sizes) => sizes.length >= 2).length;
  const multiSizeListingRatio = titles.length === 0 ? 0 : multiSizeListingCount / titles.length;
  return {
    strategy: multiSizeListingRatio >= 0.5 ? 'multi_size'
      : observedSizes.length > 0 ? 'single_size' : 'unknown',
    observedSizes,
    multiSizeListingCount,
    multiSizeListingRatio,
  };
}

export function computeContentHash(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function benchmarkScopeKeyForQuery(query: string): string {
  const normalized = query.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return `query:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

async function fetchRakutenSearchPage(query: string, fetchFn: typeof fetch): Promise<string> {
  const url = `${SEARCH_BASE}${encodeURIComponent(query)}/`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchFn(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja-JP,ja;q=0.9',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Rakuten search returned HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to fetch Rakuten search results after ${MAX_RETRIES + 1} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('unreachable');
}

export async function captureRakutenBenchmark(
  input: RakutenCaptureInput,
  fetchFn: typeof fetch = fetch,
): Promise<BenchmarkCaptureResult> {
  if (!input.query.trim()) throw new Error('--query is required and must not be empty');
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const items = parseRakutenResults(await fetchRakutenSearchPage(input.query, fetchFn), limit);
  if (items.length === 0) throw new Error('Rakuten search returned no usable non-sponsored benchmark listings');
  return {
    marketplace: 'rakuten',
    scopeKey: input.scopeKey ?? benchmarkScopeKeyForQuery(input.query),
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
    sourceKind: 'rakuten_search_organic',
    sourceQuery: { query: input.query },
    capturedAt: new Date().toISOString(),
    items,
    targetProfile: deriveTargetProfile(
      items.map((item) => item.title),
      input.query.split(/\s+/),
    ),
  };
}

type ServerSupabaseClient = SupabaseClient<any, 'public', any, any, any>;

export async function persistBenchmarkSet(
  client: ServerSupabaseClient,
  result: BenchmarkCaptureResult,
  options: { selectionMode: 'automatic' | 'operator'; designatedBy?: string },
): Promise<{ setId: string; version: number }> {
  let versionQuery = client.from('listing_copy_benchmark_sets').select('version').eq('marketplace', result.marketplace);
  versionQuery = versionQuery.eq('scope_key', result.scopeKey);
  versionQuery = result.categoryId ? versionQuery.eq('category_id', result.categoryId) : versionQuery.is('category_id', null);
  versionQuery = result.categoryName ? versionQuery.eq('category_name', result.categoryName) : versionQuery.is('category_name', null);
  const { data: versions, error: versionError } = await versionQuery.order('version', { ascending: false }).limit(1);
  if (versionError) throw new Error(`Failed to resolve benchmark version: ${versionError.message}`);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const targetProfileJson = {
    title_terms: result.targetProfile.titleTerms,
    description_topics: result.targetProfile.descriptionTopics,
    assortment: result.targetProfile.assortment,
    description_benchmark_status: 'unavailable_in_search_capture_v1',
  };
  const { data: set, error: setError } = await client.from('listing_copy_benchmark_sets').insert({
    marketplace: result.marketplace,
    category_id: result.categoryId,
    category_name: result.categoryName,
    scope_key: result.scopeKey,
    version,
    status: 'draft',
    selection_mode: options.selectionMode,
    source_kind: result.sourceKind,
    source_query_json: result.sourceQuery,
    target_profile_json: targetProfileJson,
    methodology_version: METHODOLOGY_VERSION,
    content_hash: computeContentHash({ items: result.items, profile: targetProfileJson }),
    captured_at: result.capturedAt,
    designated_by: options.designatedBy ?? null,
  }).select('id').single();
  if (setError) throw new Error(`Failed to insert benchmark set: ${setError.message}`);

  const { error: itemError } = await client.from('listing_copy_benchmark_items').insert(result.items.map((item) => ({
    benchmark_set_id: set.id,
    external_listing_id: item.externalListingId,
    listing_url: item.listingUrl,
    shop_code: item.shop,
    rank_position: item.rankPosition,
    is_sponsored: false,
    title: item.title,
    description: null,
    price: item.price,
    rating: item.rating,
    review_count: item.reviewCount,
    source_metadata_json: { description_status: 'not_captured' },
    content_hash: computeContentHash(item),
    captured_at: result.capturedAt,
  })));
  if (itemError) throw new Error(`Failed to insert benchmark items: ${itemError.message}`);
  return { setId: String(set.id), version };
}

export async function activateBenchmarkSet(client: ServerSupabaseClient, setId: string): Promise<void> {
  const { error } = await client.rpc('activate_listing_copy_benchmark_set', { p_set_id: setId });
  if (error) throw new Error(`Failed to activate benchmark set ${setId}: ${error.message}`);
}

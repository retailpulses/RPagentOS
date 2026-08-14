import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessBenchmarkCandidates,
  identifyBenchmarkScope,
  isBenchmarkReusable,
  type BenchmarkScope,
} from './benchmark-identification.js';
import type { BenchmarkCaptureResult, RakutenResultItem } from './benchmark-capture.js';
import type { ListingRow } from './types.js';

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'listing-1', platform: 'rakuten', shop_code: 'shop4',
    title: '電動リクライニングソファ 2人掛け ファブリック', description: null,
    variant_id: null, product_spu_id: 'spu-1', product_family_id: null,
    category_id: '566180', category_name: 'リクライニングソファ',
    content_revision: 1, is_hero: false,
    trusted_facts: { product: { title: '電動リクライニングソファ 2人掛け ファブリック' } },
    ...overrides,
  };
}

function item(index: number, title: string, shop = `shop-${index}`): RakutenResultItem {
  return {
    externalListingId: `${shop}/item-${index}`,
    listingUrl: `https://item.rakuten.co.jp/${shop}/item-${index}/`,
    shop,
    rankPosition: index,
    title,
    price: 10_000,
    rating: 4.5,
    reviewCount: 10,
    isSponsored: false,
  };
}

function capture(scope: BenchmarkScope, items: RakutenResultItem[]): BenchmarkCaptureResult {
  return {
    marketplace: 'rakuten', scopeKey: scope.scopeKey,
    categoryId: scope.categoryId, categoryName: scope.categoryName,
    sourceKind: 'rakuten_search_organic', sourceQuery: { query: scope.query },
    capturedAt: '2026-08-11T00:00:00Z', items,
    targetProfile: {
      titleTerms: [], descriptionTopics: [],
      assortment: {
        strategy: 'unknown', observedSizes: [], multiSizeListingCount: 0,
        multiSizeListingRatio: 0,
      },
    },
  };
}

test('benchmark scope is deterministic and includes category segment traits', () => {
  const first = identifyBenchmarkScope(listing());
  const second = identifyBenchmarkScope(listing({ id: 'listing-2' }));
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.match(first.query, /リクライニングソファ/);
  assert.match(first.query, /2人掛け/);
  assert.match(first.query, /電動/);
  assert.match(first.query, /ファブリック/);
  assert.match(first.scopeKey, /^query:[a-f0-9]{16}$/);
});

test('trusted product title determines scope instead of current listing copy', () => {
  const scope = identifyBenchmarkScope(listing({ title: 'セール 送料無料 おすすめ' }));
  assert.ok(scope);
  assert.match(scope.query, /電動/);
  assert.doesNotMatch(scope.query, /セール/);
});

test('scope supplies a fallback category name when catalog category is missing', () => {
  const scope = identifyBenchmarkScope(listing({ category_id: null, category_name: null }));
  assert.ok(scope?.categoryName);
});

test('suitcase scope preserves the verified SPU size and assortment strategy', () => {
  const scope = identifyBenchmarkScope(listing({
    category_id: '301577', category_name: null,
    trusted_facts: {
      product: { title: 'Sサイズ スーツケース キャリーケース TSAロック搭載' },
      assortment: { strategy: 'single_size', sizes: ['S'], child_variant_count: 14 },
    },
  }));
  assert.ok(scope);
  assert.equal(scope.assortmentStrategy, 'single_size');
  assert.deepEqual(scope.offeredSizes, ['S']);
  assert.equal(scope.query, 'スーツケース Sサイズ キャリーケース TSAロック');
  assert.match(scope.scopeKey, /^suitcase:single-size:s:[a-f0-9]{16}$/);
});

test('fresh automatic benchmarks are reusable and stale ones are not', () => {
  const now = Date.parse('2026-08-11T00:00:00Z');
  assert.equal(isBenchmarkReusable('2026-07-13T00:00:00Z', 'automatic', 30, now), true);
  assert.equal(isBenchmarkReusable('2026-07-11T23:59:59Z', 'automatic', 30, now), false);
});

test('operator benchmarks do not automatically expire', () => {
  const now = Date.parse('2026-08-11T00:00:00Z');
  assert.equal(isBenchmarkReusable('2020-01-01T00:00:00Z', 'operator', 30, now), true);
});

test('candidate quality accepts a relevant multi-shop result set', () => {
  const scope = identifyBenchmarkScope(listing())!;
  const title = 'リクライニングソファ 2人掛け 電動 ファブリック';
  const quality = assessBenchmarkCandidates(capture(scope, [
    item(1, title, 'a'), item(2, title, 'b'), item(3, title, 'c'),
    item(4, title, 'a'), item(5, title, 'b'),
  ]), scope);
  assert.equal(quality.valid, true);
  assert.equal(quality.uniqueShopCount, 3);
  assert.equal(quality.relevanceRatio, 1);
});

test('candidate quality rejects thin, concentrated, or irrelevant results', () => {
  const scope = identifyBenchmarkScope(listing())!;
  const quality = assessBenchmarkCandidates(capture(scope, [
    item(1, '収納ボックス', 'a'), item(2, '収納ボックス', 'a'),
    item(3, '収納ボックス', 'a'), item(4, '収納ボックス', 'a'),
  ]), scope);
  assert.equal(quality.valid, false);
  assert.equal(quality.errors.length, 3);
});

test('single-size suitcase scope accepts leaders using case or bag synonyms', () => {
  const scope = identifyBenchmarkScope(listing({
    category_id: '301577', category_name: null,
    trusted_facts: {
      product: { title: 'Sサイズ スーツケース TSAロック' },
      assortment: { sizes: ['S'] },
    },
  }))!;
  const quality = assessBenchmarkCandidates(capture(scope, [
    item(1, 'スーツケース Sサイズ Mサイズ Lサイズ', 'a'),
    item(2, 'キャリーケース Sサイズ 軽量', 'b'),
    item(3, 'キャリーバッグ Sサイズ TSAロック', 'c'),
    item(4, 'スーツケース Sサイズ 小型', 'a'),
    item(5, 'キャリーケース Sサイズ 機内持込', 'b'),
  ]), scope);
  assert.equal(quality.valid, true);
  assert.equal(quality.relevanceRatio, 1);
});

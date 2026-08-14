import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConfig,
  validateConfigForMode,
  parseLimit,
  validateProposal,
  parseProposalFromLLM,
  generateProposal,
  callDeepSeek,
  applyContentUpdate,
  idempotencyKey,
  type OllamaCallFn,
} from './improve-copy.js';
import { evaluateAgainstBenchmark, findBenchmarkCopyOverlap } from './benchmark.js';
import { type CopyBenchmark, type CopyProposal, type ListingRow, type CopyImproveConfig } from './types.js';

const testConfig: CopyImproveConfig = {
  enabled: true,
  autoShops: new Set(['shop1', 'shop2']),
  confidenceThreshold: 0.85,
  provider: 'ollama',
  model: 'qwen3.5:9b',
  ollamaUrl: 'http://127.0.0.1:11434',
  promptProfile: 'rakuten_copy_improvement_v1',
  promptVersion: 'v1',
};

function makeListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    platform: 'rakuten',
    shop_code: 'shop1',
    title: 'テスト商品 便利グッズ 収納ボックス 大容量 おしゃれ',
    description: '大容量の収納ボックスです。サイズは30cm×20cm×15cmです。お部屋をすっきり片付けられます。',
    variant_id: 'variant-1',
    product_spu_id: 'spu-1',
    product_family_id: 'family-1',
    category_id: '100001',
    category_name: '収納用品',
    content_revision: 2,
    is_hero: false,
    trusted_facts: { material: 'ポリエステル', width: '30cm', depth: '20cm', height: '15cm' },
    verified_claim_pack: {
      parentSpu: { spuCode: 'SPU-1', productTypes: ['収納ボックス'], sizes: [], tripDuration: null, features: ['大容量'] },
      selectedVariant: {
        itemCode: 'ITEM-1', weightKg: null, packageQuantity: null,
        countryOfOrigin: null, assemblyStatus: null,
      },
      commonAcrossChildren: {
        weightKg: null, packageQuantity: null, countryOfOrigin: null, assemblyStatus: null,
      },
      assortment: { strategy: 'unknown', childCount: 1, sizes: [] },
      groundedNumericTokens: ['30cm', '20cm', '15cm'],
      unsupportedOrMissing: [],
    },
    ...overrides,
  };
}

function mockOllama(response: CopyProposal): OllamaCallFn {
  return async () => ({
    content: JSON.stringify({
      title_claim_ids: response.title === null ? [] : ['parent.product_types'],
      description_claim_ids: response.description === null ? [] : ['parent.product_types'],
      confidence: response.confidence,
      rationale: response.rationale,
    }),
    error: undefined,
  });
}

function mockOllamaError(message: string): OllamaCallFn {
  return async () => ({ content: '', error: message });
}

function mockOllamaRaw(content: string): OllamaCallFn {
  return async () => ({ content, error: undefined });
}

const sofaBenchmark: CopyBenchmark = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  marketplace: 'rakuten',
  categoryId: '566180',
  categoryName: '電動リクライニングソファ',
  scopeKey: 'query:test-sofa',
  selectionMode: 'automatic',
  version: 1,
  sourceKind: 'rakuten_search_organic',
  capturedAt: '2026-08-10T00:00:00Z',
  titleTerms: ['電動リクライニングソファ', '2人掛け', '左右独立'],
  descriptionTopics: [
    { name: '寸法・設置', terms: ['幅', '奥行', '設置'] },
    { name: '素材', terms: ['素材', 'ファブリック'] },
  ],
  assortment: {
    strategy: 'single_size', observedSizes: ['S'], multiSizeListingCount: 0,
    multiSizeListingRatio: 0,
  },
  items: [{
    externalListingId: 'shop/item-1', rankPosition: 1, isSponsored: false,
    title: '電動リクライニングソファ 2人掛け 左右独立 ファブリック',
    description: '独自の長い説明文をそのまま複製してはいけません。設置寸法をご確認ください。',
  }],
};

// ─── proposal parsing and deterministic validation ────────────────────

test('parseProposalFromLLM handles valid JSON', () => {
  const result = parseProposalFromLLM(JSON.stringify({
    title: '改良タイトル 便利グッズ 収納ボックス',
    description: '改良された説明文です。',
    confidence: 0.9,
    rationale: 'added keywords',
  }));
  assert.ok(result.proposal);
  assert.equal(result.proposal!.title, '改良タイトル 便利グッズ 収納ボックス');
  assert.equal(result.proposal!.description, '改良された説明文です。');
  assert.equal(result.proposal!.confidence, 0.9);
  assert.deepEqual(result.errors, []);
});

test('parseProposalFromLLM handles null title/description', () => {
  const result = parseProposalFromLLM(JSON.stringify({
    title: null,
    description: null,
    confidence: 0.9,
    rationale: 'no changes needed',
  }));
  assert.ok(result.proposal);
  assert.equal(result.proposal!.title, null);
  assert.equal(result.proposal!.description, null);
});

test('parseProposalFromLLM accepts deterministic claim-ID selection', () => {
  const result = parseProposalFromLLM(JSON.stringify({
    title_claim_ids: ['parent.product_types', 'parent.sizes'],
    description_claim_ids: ['parent.feature.tsa_lock'],
    confidence: 0.9,
    rationale: 'selected verified claims',
  }));
  assert.deepEqual(result.proposal?.claimSelection, {
    titleClaimIds: ['parent.product_types', 'parent.sizes'],
    descriptionClaimIds: ['parent.feature.tsa_lock'],
  });
});

test('parseProposalFromLLM handles markdown code fences', () => {
  const result = parseProposalFromLLM('```json\n{"title":"T","description":"D","confidence":0.8,"rationale":"R"}\n```');
  assert.ok(result.proposal);
  assert.equal(result.proposal!.title, 'T');
});

test('parseProposalFromLLM handles JSON embedded in text', () => {
  const result = parseProposalFromLLM('Here is my response: {"title":"T","description":"D","confidence":0.8,"rationale":"R"} done.');
  assert.ok(result.proposal);
  assert.equal(result.proposal!.title, 'T');
});

test('parseProposalFromLLM rejects invalid JSON', () => {
  const result = parseProposalFromLLM('not json at all');
  assert.equal(result.proposal, null);
  assert.ok(result.errors.length > 0);
});

test('parseProposalFromLLM rejects missing confidence', () => {
  const result = parseProposalFromLLM(JSON.stringify({ title: 'T', description: 'D', rationale: 'R' }));
  assert.equal(result.proposal, null);
  assert.ok(result.errors.some((e) => e.includes('confidence')));
});

test('parseProposalFromLLM rejects confidence out of range', () => {
  const result = parseProposalFromLLM(JSON.stringify({ title: 'T', description: 'D', confidence: 1.5, rationale: 'R' }));
  assert.equal(result.proposal, null);
});

test('parseProposalFromLLM rejects missing rationale', () => {
  const result = parseProposalFromLLM(JSON.stringify({ title: 'T', description: 'D', confidence: 0.8 }));
  assert.equal(result.proposal, null);
  assert.ok(result.errors.some((e) => e.includes('rationale')));
});

// ─── validateProposal: unsupported facts and prohibited claims ────────

test('validateProposal rejects blank title when non-null', () => {
  const errors = validateProposal({ title: '', description: 'D', confidence: 0.8, rationale: 'R' }, 'Old title', 'Old desc');
  assert.ok(errors.some((e) => e.includes('blank')));
});

test('validateProposal rejects blank description when non-null', () => {
  const errors = validateProposal({ title: 'T', description: '  ', confidence: 0.8, rationale: 'R' }, 'Old title', 'Old desc');
  assert.ok(errors.some((e) => e.includes('blank')));
});

test('validateProposal rejects unsourced numeric facts', () => {
  const errors = validateProposal(
    { title: '50cm ボックス', description: 'D', confidence: 0.8, rationale: 'R' },
    'テスト商品',
    'テスト説明',
  );
  assert.ok(errors.some((e) => e.includes('unsourced numeric fact') && e.includes('50cm')));
});

test('validateProposal rejects numeric facts present only in unverified current copy', () => {
  const sourceTitle = '30cm ボックス 大容量';
  const sourceDesc = 'サイズは30cmです。';
  const errors = validateProposal(
    { title: '30cm 大容量ボックス', description: '30cmの商品です。', confidence: 0.8, rationale: 'used existing fact' },
    sourceTitle,
    sourceDesc,
  );
  assert.ok(errors.some((e) => e.includes('unsourced numeric fact')));
});

test('validateProposal accepts numeric facts present in trusted facts', () => {
  const errors = validateProposal(
    { title: '30cm 大容量ボックス', description: '30cmの商品です。', confidence: 0.8, rationale: 'used verified fact' },
    'テスト商品',
    'テスト説明',
    JSON.stringify({ width: '30cm' }),
  );
  assert.equal(errors.filter((e) => e.includes('unsourced numeric fact')).length, 0);
});

test('validateProposal rejects prohibited claims', () => {
  const errors = validateProposal(
    { title: '最安値の商品', description: 'D', confidence: 0.8, rationale: 'R' },
    'テスト商品',
    'テスト説明',
  );
  assert.ok(errors.some((e) => e.includes('prohibited claim') && e.includes('最安')));
});

test('validateProposal rejects 医療 claim', () => {
  const errors = validateProposal(
    { title: '医療用グッズ', description: 'D', confidence: 0.8, rationale: 'R' },
    'テスト商品',
    'テスト説明',
  );
  assert.ok(errors.some((e) => e.includes('prohibited claim') && e.includes('医療')));
});

test('validateProposal blocks prohibited claims even when present in source', () => {
  const errors = validateProposal(
    { title: '最安値の商品', description: 'D', confidence: 0.8, rationale: 'R' },
    '最安値 テスト商品',
    'テスト説明',
  );
  assert.equal(errors.filter((e) => e.includes('prohibited claim')).length, 1);
});

test('validateProposal rejects high-risk commercial claims without trusted evidence', () => {
  const errors = validateProposal(
    { title: 'テスト商品', description: '厳しい品質基準を満たした安心の日本仕様です。', confidence: 0.8, rationale: 'R' },
    'テスト商品',
    '現在の説明にも日本仕様と書かれています。',
    JSON.stringify({ material: 'steel' }),
  );
  assert.ok(errors.some((error) => error.includes('日本仕様')));
  assert.ok(errors.some((error) => error.includes('品質基準')));
});

test('validateProposal rejects unsupported suitcase feature claims', () => {
  const errors = validateProposal(
    {
      title: 'スーツケース Sサイズ 機内持込',
      description: '360度キャスターとエンボス加工を採用。',
      confidence: 0.8,
      rationale: 'R',
    },
    'スーツケース Sサイズ',
    '既存説明',
    JSON.stringify({ size: 'S', product_weight_kg: 2.7 }),
  );
  assert.ok(errors.some((error) => error.includes('機内持込')));
  assert.ok(errors.some((error) => error.includes('360度')));
  assert.ok(errors.some((error) => error.includes('エンボス加工')));
});

test('validateProposal allows generic benefits when their hard features are evidenced', () => {
  const errors = validateProposal(
    {
      title: 'スーツケース Sサイズ 大容量',
      description: '360度キャスターで移動がスムーズ。TSAロックで海外旅行も安心。メッシュポケットで整理しやすく便利です。',
      confidence: 0.8,
      rationale: 'R',
    },
    'スーツケース Sサイズ',
    '既存説明',
    JSON.stringify({
      size: 'S', caster: '360度キャスター', lock: 'TSAロック',
      interior: 'メッシュポケット',
    }),
  );
  assert.deepEqual(errors, []);
});

test('validateProposal rejects invented TSA inspection mechanics but not generic reassurance', () => {
  const errors = validateProposal(
    {
      title: 'スーツケース Sサイズ TSAロック',
      description: 'TSAロックで海外旅行も安心。鍵を壊さずに検査が可能です。',
      confidence: 0.8,
      rationale: 'R',
    },
    'スーツケース Sサイズ',
    '既存説明',
    JSON.stringify({ size: 'S', lock: 'TSAロック' }),
  );
  assert.equal(errors.some((error) => error.includes('海外旅行')), false);
  assert.ok(errors.some((error) => error.includes('鍵を壊さず')));
  assert.ok(errors.some((error) => error.includes('検査が可能')));
});

test('validateProposal still rejects an invented hard feature wrapped in a generic benefit', () => {
  const errors = validateProposal(
    {
      title: 'スーツケース Sサイズ',
      description: '360度キャスターで移動がスムーズです。',
      confidence: 0.8,
      rationale: 'R',
    },
    'スーツケース Sサイズ',
    '既存説明',
    JSON.stringify({ size: 'S' }),
  );
  assert.ok(errors.some((error) => error.includes('360度')));
  assert.ok(errors.some((error) => error.includes('キャスター')));
  assert.equal(errors.some((error) => error.includes('スムーズ')), false);
});

test('enriched suitcase candidate passes when every hard fact is evidenced', () => {
  const errors = validateProposal(
    {
      title: 'スーツケース Sサイズ キャリーケース 旅行用 1～3泊 41.1L 2.7kg TSAロック 360度キャスター エンボス ABS+PC',
      description: '1～3泊の旅行に最適なSサイズのスーツケースです。容量は約41.1L、外寸は約56×37×24cm、重量は約2.7kg。直径50mmの360度回転キャスターと3段階調節可能なキャリーバーを搭載しています。TSAダイヤルロックでセキュリティも安心。内装にはクロスベルトとメッシュポケットが付き、荷物を整理しやすくなっています。表面はエンボス加工で、ABS+PC混合樹脂製です。Sサイズには側面ハンドルと底足がない点にご注意ください。',
      confidence: 0.9,
      rationale: 'Evidence-enriched commercial candidate',
    },
    'スーツケース Sサイズ',
    '既存説明',
    JSON.stringify({
      trip: '1～3泊', capacity: '41.1L', outer: '56×37×24cm', weight: '2.7kg',
      caster: '直径50mm 360度キャスター', bar: '3段階調節 キャリーバー',
      lock: 'TSAロック TSAダイヤルロック', interior: 'クロスベルト メッシュポケット',
      shell: 'エンボス加工 ABS+PC混合樹脂', absent: '側面ハンドル 底足',
    }),
  );
  assert.deepEqual(errors, []);
});

test('validateProposal blocks sizes outside a single-size SPU claim pack', () => {
  const listing = makeListing({
    verified_claim_pack: {
      parentSpu: { spuCode: 'PP298906', productTypes: ['スーツケース'], sizes: ['S'], tripDuration: '2～3泊', features: ['TSAロック'] },
      selectedVariant: {
        itemCode: 'PP298906DAA', weightKg: 2.7, packageQuantity: 1,
        countryOfOrigin: '中国', assemblyStatus: '要組立品',
      },
      commonAcrossChildren: {
        weightKg: 2.7, packageQuantity: 1, countryOfOrigin: '中国', assemblyStatus: '要組立品',
      },
      assortment: { strategy: 'single_size', childCount: 14, sizes: ['S'] },
      groundedNumericTokens: ['2.7kg', '1個', '2泊', '3泊', '2～3泊'],
      unsupportedOrMissing: ['M/L availability outside this SPU'],
    },
  });
  const errors = validateProposal(
    { title: 'スーツケース S/M/Lサイズ', description: '2～3泊向けです。', confidence: 0.8, rationale: 'R' },
    listing.title,
    listing.description,
    listing.verified_claim_pack,
  );
  assert.ok(errors.some((error) => error.includes('outside the verified SPU assortment: M')));
  assert.ok(errors.some((error) => error.includes('outside the verified SPU assortment: L')));
});

test('unsupportedOrMissing labels do not become claim evidence', () => {
  const listing = makeListing({
    verified_claim_pack: {
      parentSpu: { spuCode: 'PP298906', productTypes: ['スーツケース'], sizes: ['S'], tripDuration: null, features: [] },
      selectedVariant: {
        itemCode: 'PP298906DAA', weightKg: 2.7, packageQuantity: 1,
        countryOfOrigin: '中国', assemblyStatus: null,
      },
      commonAcrossChildren: {
        weightKg: 2.7, packageQuantity: 1, countryOfOrigin: '中国', assemblyStatus: null,
      },
      assortment: { strategy: 'single_size', childCount: 14, sizes: ['S'] },
      groundedNumericTokens: ['2.7kg', '1個'],
      unsupportedOrMissing: ['360度キャスター', '14色展開'],
    },
  });
  const errors = validateProposal(
    { title: 'Sサイズ スーツケース', description: '360度キャスター、14色展開です。', confidence: 0.8, rationale: 'R' },
    listing.title,
    listing.description,
    listing.verified_claim_pack,
  );
  assert.ok(errors.some((error) => error.includes('360度')));
  assert.ok(errors.some((error) => error.includes('14色')));
});

test('validateProposal requires material change', () => {
  const sourceTitle = '元のタイトル';
  const sourceDesc = '元の説明文';
  const errors = validateProposal(
    { title: sourceTitle, description: sourceDesc, confidence: 0.8, rationale: 'no change' },
    sourceTitle,
    sourceDesc,
  );
  assert.ok(errors.some((e) => e.includes('no material change')));
});

test('validateProposal accepts changed title', () => {
  const sourceTitle = '元のタイトル';
  const errors = validateProposal(
    { title: '新しいタイトル', description: null, confidence: 0.8, rationale: 'improved title' },
    sourceTitle,
    '元の説明',
  );
  assert.equal(errors.length, 0);
});

test('validateProposal rejects invalid confidence', () => {
  const errors = validateProposal(
    { title: 'New', description: 'D', confidence: 1.5, rationale: 'R' } as CopyProposal,
    'Old title',
    'Old desc',
  );
  assert.ok(errors.some((e) => e.includes('confidence')));
});

test('validateProposal enforces Rakuten title length', () => {
  const errors = validateProposal(
    { title: 'あ'.repeat(128), description: null, confidence: 0.9, rationale: 'R' },
    '元タイトル',
    '元説明',
  );
  assert.ok(errors.some((error) => error.includes('127 characters')));
});

test('benchmark evaluation compares before and proposal against one fixed version', () => {
  const listing = makeListing({
    title: '電動ソファ 2人掛け',
    description: 'ファブリック素材です。',
  });
  const result = evaluateAgainstBenchmark(listing, {
    title: '電動リクライニングソファ 2人掛け 左右独立',
    description: 'ファブリック素材です。設置前に幅と奥行をご確認ください。',
    confidence: 0.9,
    rationale: 'benchmark coverage improved',
  }, sofaBenchmark);
  assert.ok(result);
  assert.equal(result!.benchmarkId, sofaBenchmark.id);
  assert.ok(result!.scoreDelta > 0);
  assert.deepEqual(result!.regressions, []);
});

test('benchmark overlap detects copied distinctive competitor wording', () => {
  const overlap = findBenchmarkCopyOverlap({
    title: null,
    description: '独自の長い説明文をそのまま複製してはいけません。設置寸法をご確認ください。',
    confidence: 0.9,
    rationale: 'copied',
  }, sofaBenchmark, 20);
  assert.ok(overlap);
});

// ─── mode and approval-policy behavior ───────────────────────────────

test('validateConfigForMode allows dry_run when disabled', () => {
  const config = { ...testConfig, enabled: false };
  assert.equal(validateConfigForMode(config, 'dry_run'), null);
});

test('validateConfigForMode blocks approval when disabled', () => {
  const config = { ...testConfig, enabled: false };
  const error = validateConfigForMode(config, 'approval');
  assert.ok(error?.includes('COPY_IMPROVEMENT_ENABLED'));
});

test('validateConfigForMode blocks auto when disabled', () => {
  const config = { ...testConfig, enabled: false };
  const error = validateConfigForMode(config, 'auto');
  assert.ok(error?.includes('COPY_IMPROVEMENT_ENABLED'));
});

test('validateConfigForMode allows auto when enabled with shops', () => {
  const config = { ...testConfig, enabled: true, autoShops: new Set(['shop1']) };
  assert.equal(validateConfigForMode(config, 'auto'), null);
});

test('validateConfigForMode blocks auto with empty shops', () => {
  const config = { ...testConfig, enabled: true, autoShops: new Set<string>() };
  const error = validateConfigForMode(config, 'auto');
  assert.ok(error?.includes('COPY_IMPROVEMENT_AUTO_SHOPS'));
});

test('validateConfigForMode rejects an invalid confidence threshold', () => {
  const config = {
    ...testConfig,
    enabled: true,
    autoShops: new Set(['shop1']),
    confidenceThreshold: Number.NaN,
  };
  assert.ok(validateConfigForMode(config, 'auto')?.includes('between 0 and 1'));
});

// ─── shop allowlist ──────────────────────────────────────────────────

test('buildConfig parses auto shops from env', () => {
  process.env['COPY_IMPROVEMENT_AUTO_SHOPS'] = 'shop1,shop2, shop3';
  const config = buildConfig();
  assert.ok(config.autoShops.has('shop1'));
  assert.ok(config.autoShops.has('shop2'));
  assert.ok(config.autoShops.has('shop3'));
  assert.equal(config.autoShops.size, 3);
});

test('buildConfig defaults copywriting to DeepSeek without changing image configuration', () => {
  const previousProvider = process.env['LISTING_COPY_PROVIDER'];
  const previousModel = process.env['LISTING_COPY_MODEL'];
  delete process.env['LISTING_COPY_PROVIDER'];
  delete process.env['LISTING_COPY_MODEL'];
  try {
    const config = buildConfig();
    assert.equal(config.provider, 'deepseek');
    assert.equal(config.model, 'deepseek-chat');
  } finally {
    if (previousProvider === undefined) delete process.env['LISTING_COPY_PROVIDER'];
    else process.env['LISTING_COPY_PROVIDER'] = previousProvider;
    if (previousModel === undefined) delete process.env['LISTING_COPY_MODEL'];
    else process.env['LISTING_COPY_MODEL'] = previousModel;
  }
});

test('buildConfig handles empty auto shops', () => {
  process.env['COPY_IMPROVEMENT_AUTO_SHOPS'] = '';
  const config = buildConfig();
  assert.equal(config.autoShops.size, 0);
});

test('buildConfig handles whitespace-only auto shops', () => {
  process.env['COPY_IMPROVEMENT_AUTO_SHOPS'] = ' , , ';
  const config = buildConfig();
  assert.equal(config.autoShops.size, 0);
});

// ─── kill switch ─────────────────────────────────────────────────────

test('kill switch: enabled=false blocks non-dry-run modes', () => {
  const config = { ...testConfig, enabled: false };
  assert.ok(validateConfigForMode(config, 'auto') !== null);
  assert.ok(validateConfigForMode(config, 'approval') !== null);
});

test('kill switch: dry_run works when disabled', () => {
  const config = { ...testConfig, enabled: false };
  assert.equal(validateConfigForMode(config, 'dry_run'), null);
});

// ─── parsing limit ───────────────────────────────────────────────────

test('parseLimit returns default on missing', () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit(undefined, 5), 5);
});

test('parseLimit clamps to max', () => {
  assert.equal(parseLimit('100'), 20);
  assert.equal(parseLimit('100', 10, 50), 50);
});

test('parseLimit handles invalid input', () => {
  assert.equal(parseLimit('abc'), 10);
  assert.equal(parseLimit('0'), 10);
  assert.equal(parseLimit('-5'), 10);
});

test('parseLimit parses valid numbers', () => {
  assert.equal(parseLimit('1'), 1);
  assert.equal(parseLimit('15'), 15);
  assert.equal(parseLimit('20'), 20);
});

// ─── idempotency key stability ───────────────────────────────────────

test('idempotencyKey produces stable output', () => {
  const listingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const proposalHash = 'abc123def456';
  const k1 = idempotencyKey(listingId, proposalHash);
  const k2 = idempotencyKey(listingId, proposalHash);
  assert.equal(k1, k2);
  assert.ok(k1.includes(listingId));
  assert.ok(k1.includes(proposalHash));
});

test('idempotencyKey produces different keys for different inputs', () => {
  const listingId1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
  const listingId2 = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';
  assert.notEqual(
    idempotencyKey(listingId1, 'hash1'),
    idempotencyKey(listingId2, 'hash1'),
  );
});

// ─── generateProposal dependency injection ────────────────────────────

test('generateProposal returns valid proposal for good LLM response', async () => {
  const listing = makeListing();
  const result = await generateProposal(listing, testConfig, mockOllama({
    title: '改良 収納ボックス 大容量 おしゃれ',
    description: '30cm×20cm×15cmの大容量収納ボックス。お部屋をすっきり片付けられます。',
    confidence: 0.9,
    rationale: 'improved keyword placement',
  }));
  assert.equal(result.validationStatus, 'valid');
  assert.ok(result.proposal);
  assert.ok(result.inputHash.length > 0);
  assert.ok(result.outputHash.length > 0);
});

test('generateProposal handles LLM error', async () => {
  const listing = makeListing();
  const result = await generateProposal(listing, testConfig, mockOllamaError('Ollama connection refused'));
  assert.equal(result.validationStatus, 'failed');
  assert.equal(result.proposal, null);
});

test('generateProposal repairs invalid output', async () => {
  const listing = makeListing();
  let callCount = 0;
  const ollamaCall: OllamaCallFn = async (_prompt, _model) => {
    callCount++;
    if (callCount === 1) {
      return { content: JSON.stringify({ title_claim_ids: ['unknown.claim'], description_claim_ids: [], confidence: 0.9, rationale: 'R' }), error: undefined };
    }
    return { content: JSON.stringify({ title_claim_ids: ['parent.product_types'], description_claim_ids: ['parent.product_types'], confidence: 0.9, rationale: 'R' }), error: undefined };
  };
  const result = await generateProposal(listing, testConfig, ollamaCall);
  assert.equal(result.validationStatus, 'repaired');
  assert.equal(result.repairAttempts, 1);
  assert.equal(callCount, 2);
});

test('generateProposal returns invalid after failed repair', async () => {
  const listing = makeListing();
  const ollamaCall: OllamaCallFn = async () => ({
    content: JSON.stringify({ title: '50cm 商品', description: 'D', confidence: 0.9, rationale: 'R' }),
    error: undefined,
  });
  const result = await generateProposal(listing, testConfig, ollamaCall);
  assert.equal(result.validationStatus, 'invalid');
  assert.equal(result.repairAttempts, 1);
});

test('generateProposal rejects unavailable claim IDs and attempts repair', async () => {
  const listing = makeListing({ title: '普通の商品', description: '普通の説明' });
  let callCount = 0;
  const ollamaCall: OllamaCallFn = async (_prompt, _model) => {
    callCount++;
    if (callCount === 1) {
      return { content: JSON.stringify({ title_claim_ids: ['prohibited.cheapest'], description_claim_ids: [], confidence: 0.9, rationale: 'R' }), error: undefined };
    }
    return { content: JSON.stringify({ title_claim_ids: ['parent.product_types'], description_claim_ids: [], confidence: 0.9, rationale: 'R' }), error: undefined };
  };
  const result = await generateProposal(listing, testConfig, ollamaCall);
  assert.equal(result.validationStatus, 'repaired');
  assert.equal(callCount, 2);
});

// ─── applyContentUpdate ──────────────────────────────────────────────

test('applyContentUpdate returns stale_revision when revision mismatch', async () => {
  const mockFetch = async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Response.json({ outcome: 'stale_revision', content_revision: 6 }, { status: 409 });
  };
  const result = await applyContentUpdate(
    {
      listingId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: 'New Title',
      description: 'New Desc',
      expectedRevision: 5,
      idempotencyKey: 'ikey-1',
      model: 'qwen3.5:9b',
      promptVersion: 'v1',
    },
    'https://test.test',
    'key-123',
    mockFetch as typeof fetch,
  );
  assert.equal(result.outcome, 'stale_revision');
});

test('applyContentUpdate returns updated on success', async () => {
  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), 'https://test.test/listings/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content');
    assert.equal(init?.method, 'PATCH');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer key-123');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.expected_content_revision, 2);
    assert.equal(body.content_origin, 'ai_enhanced');
    assert.equal(body.idempotency_key, 'ikey-1');
    assert.equal(body.title, 'New Title');
    return Response.json({ outcome: 'updated', content_revision: 3 });
  };
  const result = await applyContentUpdate(
    {
      listingId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: 'New Title',
      description: 'New Desc',
      expectedRevision: 2,
      idempotencyKey: 'ikey-1',
      model: 'qwen3.5:9b',
      promptVersion: 'v1',
    },
    'https://test.test',
    'key-123',
    mockFetch as typeof fetch,
  );
  assert.equal(result.outcome, 'updated');
  assert.equal(result.contentRevision, 3);
});

test('applyContentUpdate handles fetch errors', async () => {
  const mockFetch = async (): Promise<Response> => {
    throw new Error('network error');
  };
  const result = await applyContentUpdate(
    {
      listingId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: 'New Title',
      description: null,
      expectedRevision: 1,
      idempotencyKey: 'ikey-1',
      model: 'qwen3.5:9b',
      promptVersion: 'v1',
    },
    'https://test.test',
    'key-123',
    mockFetch as typeof fetch,
  );
  assert.equal(result.outcome, 'error');
});

// ─── generateProposal with valid output rejected by validation ───────

test('generateProposal renders a description-only claim selection', async () => {
  const listing = makeListing({ title: '元タイトル', description: '元説明' });
  const ollamaCall = mockOllamaRaw(JSON.stringify({
    title_claim_ids: [], description_claim_ids: ['parent.product_types'], confidence: 0.9, rationale: 'R',
  }));
  const result = await generateProposal(listing, testConfig, ollamaCall);
  assert.equal(result.validationStatus, 'valid');
  assert.equal(result.proposal?.title, null);
});

test('generateProposal accepts an explicit no-op when no safe improvement exists', async () => {
  const listing = makeListing();
  const result = await generateProposal(listing, testConfig, mockOllama({
    title: null,
    description: null,
    confidence: 0.9,
    rationale: 'current copy is already optimal',
  }));
  assert.equal(result.validationStatus, 'valid');
  assert.deepEqual(result.validationErrors, []);
});

test('callDeepSeek requests JSON output and returns assistant content', async () => {
  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), 'https://api.deepseek.test/chat/completions');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer test-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.model, 'deepseek-chat');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return Response.json({ choices: [{ message: { content: '{"title":"ok"}' } }] });
  };
  const result = await callDeepSeek(
    'prompt', 'deepseek-chat', 'test-key', 'https://api.deepseek.test', 5000,
    mockFetch as typeof fetch,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.content, '{"title":"ok"}');
});

test('callDeepSeek reports provider errors without exposing the key', async () => {
  const mockFetch = async (): Promise<Response> => new Response('rate limited', { status: 429 });
  const result = await callDeepSeek(
    'prompt', 'deepseek-chat', 'secret-key', 'https://api.deepseek.test', 5000,
    mockFetch as typeof fetch,
  );
  assert.equal(result.error, 'DeepSeek 429: rate limited');
  assert.equal(result.error?.includes('secret-key'), false);
});

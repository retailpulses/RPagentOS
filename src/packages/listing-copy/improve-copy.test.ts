import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConfig,
  validateConfigForMode,
  parseLimit,
  validateProposal,
  parseProposalFromLLM,
  generateProposal,
  applyContentUpdate,
  idempotencyKey,
  type OllamaCallFn,
} from './improve-copy.js';
import { type CopyProposal, type ListingRow, type CopyImproveConfig } from './types.js';

const testConfig: CopyImproveConfig = {
  enabled: true,
  autoShops: new Set(['shop1', 'shop2']),
  confidenceThreshold: 0.85,
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
    content_revision: 2,
    is_hero: false,
    trusted_facts: { material: 'ポリエステル' },
    ...overrides,
  };
}

function mockOllama(response: CopyProposal): OllamaCallFn {
  return async () => ({ content: JSON.stringify(response), error: undefined });
}

function mockOllamaError(message: string): OllamaCallFn {
  return async () => ({ content: '', error: message });
}

function mockOllamaRaw(content: string): OllamaCallFn {
  return async () => ({ content, error: undefined });
}

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

test('validateProposal accepts numeric facts present in source', () => {
  const sourceTitle = '30cm ボックス 大容量';
  const sourceDesc = 'サイズは30cmです。';
  const errors = validateProposal(
    { title: '30cm 大容量ボックス', description: '30cmの商品です。', confidence: 0.8, rationale: 'used existing fact' },
    sourceTitle,
    sourceDesc,
  );
  const unsourced = errors.filter((e) => e.includes('unsourced numeric fact'));
  assert.equal(unsourced.length, 0);
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
      return { content: JSON.stringify({ title: '50cm 商品', description: 'D', confidence: 0.9, rationale: 'R' }), error: undefined };
    }
    return { content: JSON.stringify({ title: '30cm 商品', description: 'D', confidence: 0.9, rationale: 'R' }), error: undefined };
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

test('generateProposal detects prohibited claims and attempts repair', async () => {
  const listing = makeListing({ title: '普通の商品', description: '普通の説明' });
  let callCount = 0;
  const ollamaCall: OllamaCallFn = async (_prompt, _model) => {
    callCount++;
    if (callCount === 1) {
      return { content: JSON.stringify({ title: '最安 商品', description: 'D', confidence: 0.9, rationale: 'R' }), error: undefined };
    }
    return { content: JSON.stringify({ title: 'お得な商品', description: 'D', confidence: 0.9, rationale: 'R' }), error: undefined };
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

test('generateProposal trims blank title to null and validates', async () => {
  const listing = makeListing({ title: '元タイトル', description: '元説明' });
  const ollamaCall = mockOllamaRaw(JSON.stringify({ title: '  ', description: 'D', confidence: 0.9, rationale: 'R' }));
  const result = await generateProposal(listing, testConfig, ollamaCall);
  assert.equal(result.validationStatus, 'valid');
  assert.equal(result.proposal?.title, null);
});

test('generateProposal accepts all-null proposal as no material change', async () => {
  const listing = makeListing();
  const result = await generateProposal(listing, testConfig, mockOllama({
    title: null,
    description: null,
    confidence: 0.9,
    rationale: 'current copy is already optimal',
  }));
  assert.equal(result.validationStatus, 'invalid');
  assert.ok(result.validationErrors.some((e) => e.includes('no material change')));
});

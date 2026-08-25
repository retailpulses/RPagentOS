import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleMainImageAssetSave,
  handleMainImageAssetDelivery,
  handleMainImageCandidate,
  handleMainImageContext,
  handleMainImageSchema,
  handleOperatorMainImagePublish,
  type InternalCatalogEnv,
} from './internal-catalog.js';
import { hashCanonicalJson, signCandidateToken, type MainImageSchema } from '../packages/main-image/core.js';

const LISTING_ID = '11111111-1111-4111-8111-111111111111';
const SPU_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_VARIANT_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_ASSET_ID = '55555555-5555-4555-8555-555555555555';
const APPROVED_ASSET_ID = '66666666-6666-4666-8666-666666666666';

function jpegBytes(width = 1024, height = 1024): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe0, 0x00, 0x10], 2);
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00], 6);
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  bytes[25] = (height >>> 8) & 0xff; bytes[26] = height & 0xff;
  bytes[27] = (width >>> 8) & 0xff; bytes[28] = width & 0xff;
  bytes[29] = 0x03;
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer]).stream();
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function env(overrides: Partial<InternalCatalogEnv> = {}): InternalCatalogEnv {
  return {
    INTERNAL_CATALOG_API_TOKEN: 'internal-token',
    SUPABASE_URL: 'https://catalog.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_SCHEMA_MODEL: 'gpt-5.4',
    OPENAI_IMAGE_MODEL: 'gpt-image-2',
    MAIN_IMAGE_CANDIDATE_SIGNING_SECRET: 'signing-secret-with-sufficient-entropy',
    MAIN_IMAGE_ASSET_PUBLIC_BASE_URL: 'https://images.homesbliss.net',
    CATALOGSYNC_RELAY_URL: 'https://relay.test',
    CATALOGSYNC_RELAY_SECRET: 'relay-secret',
    ...overrides,
  };
}

function request(path: string, method: string, body?: unknown, token = 'internal-token'): Request {
  return new Request(`https://rpagentos.test${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function listingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LISTING_ID,
    platform: 'mercari',
    shop_code: 'shop2',
    external_listing_id: 'mercari-listing-1',
    listing_status: 'OPENED',
    product_family_id: null,
    product_spu_id: SPU_ID,
    variant_id: VARIANT_ID,
    title: '収納ワゴン ベージュ',
    description: '移動に便利な収納ワゴンです。',
    images: ['https://market.example/current-main.jpg', 'https://market.example/detail.jpg'],
    observed_images: null,
    content_revision: 3,
    lifecycle_stage: 'published',
    publish_claim_id: null,
    publish_idempotency_key: null,
    published_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function approvedAssetRow(): Record<string, unknown> {
  return {
    id: APPROVED_ASSET_ID,
    product_spu_id: SPU_ID,
    variant_id: VARIANT_ID,
    asset_type: 'image',
    asset_url: 'https://images.homesbliss.net/products/WAGON-BEIGE/main-images/approved/v1.jpg',
    asset_path: 'products/WAGON-BEIGE/main-images/approved/v1.jpg',
    source_system: 'rpagentos_main_image',
    metadata: { main_image: { listing_id: LISTING_ID } },
  };
}

interface MockState {
  listing?: Record<string, unknown>;
  approvedAsset?: Record<string, unknown>;
  openAiSchema?: MainImageSchema;
  calls: Array<{ url: string; method: string; body: unknown }>;
  relayFailure?: boolean;
  relayReadbackMismatch?: boolean;
  assetInsertFailure?: boolean;
  sourceAssetUrl?: string;
}

function schema(): MainImageSchema {
  return {
    schema_version: '1.0',
    canvas: { width: 1024, height: 1024, background_color: '#F7F4EE' },
    product: {
      scale_percent: 73,
      alignment: 'center-right',
      preserve_original_product: true,
      source_asset_ids: [SOURCE_ASSET_ID],
    },
    copy: { headline: '', headline_evidence_ids: [], supporting_text: '', supporting_evidence_ids: [] },
    feature_ids: [`variant.${VARIANT_ID}.color`],
    keyword_ids: [],
    variation_swatches: [],
    restrictions: {
      no_people: true,
      no_logo: true,
      no_fake_discount: true,
      no_fake_ranking: true,
      no_fake_certification: true,
      no_unverified_claims: true,
      no_product_modification: true,
    },
    notes: '',
  };
}

function mockFetch(state: MockState): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') parsedBody = JSON.parse(init.body);
    state.calls.push({ url: url.toString(), method, body: parsedBody });

    if (url.hostname === 'images.example') {
      const bytes = jpegBytes();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Response(buffer, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/responses') {
      return Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(state.openAiSchema ?? schema()) }] }] });
    }
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/images/edits') {
      return Response.json({ data: [{ b64_json: encodeBase64(jpegBytes()) }] });
    }
    if (url.hostname === 'relay.test') {
      if (state.relayFailure) return Response.json({ ok: false }, { status: 502 });
      const relayBody = parsedBody as Record<string, any>;
      return Response.json({
        ok: true,
        observed: {
          shopCode: relayBody.payload.shopCode,
          listingId: state.relayReadbackMismatch ? 'wrong-listing' : relayBody.payload.listingId,
          images: relayBody.payload.imageUrls,
        },
      });
    }

    const table = url.pathname.split('/').pop();
    if (table === 'platform_listings') {
      if (method === 'PATCH') {
        const patch = parsedBody as Record<string, unknown>;
        state.listing = { ...(state.listing ?? listingRow()), ...patch };
        return Response.json([state.listing]);
      }
      return Response.json([state.listing ?? listingRow()]);
    }
    if (table === 'product_spus') {
      return Response.json([{ id: SPU_ID, spu_code: 'SPU-WAGON', title: '収納ワゴン', category: '収納', status: 'active' }]);
    }
    if (table === 'product_variants') {
      return Response.json([
        {
          id: VARIANT_ID, product_spu_id: SPU_ID, item_code: 'WAGON-BEIGE', variant_name: 'ベージュ',
          color: 'ベージュ', color_code: '#D8C3A5', size_text: null, material: 'steel', material_ja: 'スチール',
          package_quantity: 1, status: 'active',
        },
        {
          id: OTHER_VARIANT_ID, product_spu_id: '99999999-9999-4999-8999-999999999999', item_code: 'OTHER',
          variant_name: 'unrelated', color: '黒', status: 'active',
        },
      ]);
    }
    if (table === 'platform_listing_attributes') {
      return Response.json([{ id: 'attr-material', listing_id: LISTING_ID, attribute_key: 'material', attribute_value: 'スチール' }]);
    }
    if (table === 'platform_listing_images') {
      if (method === 'POST') return Response.json(parsedBody as unknown[]);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json([
        { id: 'img-1', image_position: 1, image_url: 'https://market.example/current-main.jpg' },
        { id: 'img-2', image_position: 2, image_url: 'https://market.example/detail.jpg' },
      ]);
    }
    if (table === 'platform_listing_events') {
      return Response.json((parsedBody as unknown[]) ?? []);
    }
    if (table === 'product_assets') {
      if (method === 'POST') {
        if (state.assetInsertFailure) return Response.json({ error: 'insert failed' }, { status: 500 });
        const rows = parsedBody as Record<string, unknown>[];
        state.approvedAsset = rows[0];
        return Response.json(rows);
      }
      if (url.searchParams.get('id')) return Response.json(state.approvedAsset ? [state.approvedAsset] : []);
      return Response.json([{
        id: SOURCE_ASSET_ID,
        product_spu_id: SPU_ID,
        variant_id: VARIANT_ID,
        asset_type: 'image',
        asset_url: state.sourceAssetUrl ?? 'https://images.example/source.jpg',
        position: 1,
        source_system: 'catalog',
        metadata: { width: 1024, height: 1024, content_type: 'image/jpeg' },
      }]);
    }
    return Response.json([]);
  };
}

test('main-image context rejects the wrong bearer token before reading Supabase', async () => {
  let called = false;
  const response = await handleMainImageContext(
    request(`/api/internal/catalog/listings/${LISTING_ID}/main-image-context`, 'GET', undefined, 'wrong'),
    env(),
    LISTING_ID,
    async () => { called = true; return Response.json([]); },
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test('context and schema are grounded to the exact listing and same SPU', async () => {
  const state: MockState = { calls: [] };
  const fetchFn = mockFetch(state);
  const contextResponse = await handleMainImageContext(
    request(`/listings/${LISTING_ID}/main-image-context`, 'GET'), env(), LISTING_ID, fetchFn,
  );
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json() as Record<string, any>;
  assert.deepEqual(context.fact_pack.variantIds, [VARIANT_ID]);
  assert.deepEqual(context.fact_pack.assetIds, [SOURCE_ASSET_ID]);
  assert.equal(context.fact_pack.evidence.find((entry: any) => entry.id === 'listing.title').status, 'context_only');

  const schemaResponse = await handleMainImageSchema(
    request(`/listings/${LISTING_ID}/main-image-schema`, 'POST', { expected_content_revision: 3 }),
    env(), LISTING_ID, fetchFn,
  );
  assert.equal(schemaResponse.status, 200);
  const generated = await schemaResponse.json() as Record<string, any>;
  assert.equal(generated.validation.valid, true);
  const openAiCall = state.calls.find((call) => call.url === 'https://api.openai.com/v1/responses');
  assert.ok(openAiCall);
  const openAiBody = openAiCall.body as Record<string, any>;
  assert.equal(openAiBody.text.format.strict, true);
  assert.equal(JSON.stringify(openAiBody).includes('OTHER'), false);
});

test('context rejects private-network source image URLs', async () => {
  const state: MockState = { calls: [], sourceAssetUrl: 'https://[::1]/source.jpg' };
  const response = await handleMainImageContext(
    request(`/listings/${LISTING_ID}/main-image-context`, 'GET'), env(), LISTING_ID, mockFetch(state),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'no_usable_source_image' });
});

test('candidate generation, explicit R2 save, and exact-listing publish complete independently', async () => {
  const state: MockState = { calls: [] };
  const stored = new Map<string, Uint8Array>();
  const runtimeEnv = env({
    MAIN_IMAGE_ASSETS: {
      async get(key) {
        const value = stored.get(key);
        return value ? { body: byteStream(value), httpMetadata: { contentType: 'image/jpeg' } } : null;
      },
      async head(key) { return stored.has(key) ? {} : null; },
      async put(key, value) { stored.set(key, value); return {}; },
      async delete(key) { stored.delete(key); },
    },
  });
  const fetchFn = mockFetch(state);
  const contextResponse = await handleMainImageContext(
    request(`/listings/${LISTING_ID}/main-image-context`, 'GET'), runtimeEnv, LISTING_ID, fetchFn,
  );
  const context = await contextResponse.json() as Record<string, any>;

  const candidateResponse = await handleMainImageCandidate(
    request(`/listings/${LISTING_ID}/main-image-candidate`, 'POST', {
      expected_content_revision: 3,
      fact_pack_hash: context.fact_pack_hash,
      confirmed_context_evidence_ids: [],
      schema: schema(),
    }),
    runtimeEnv, LISTING_ID, fetchFn,
  );
  assert.equal(candidateResponse.status, 200);
  const candidate = await candidateResponse.json() as Record<string, any>;
  assert.equal(candidate.model, 'gpt-image-2');

  const saveResponse = await handleMainImageAssetSave(
    request(`/listings/${LISTING_ID}/main-image-assets`, 'POST', {
      expected_content_revision: 3,
      candidate_base64: candidate.candidate_base64,
      candidate_token: candidate.candidate_token,
      fact_pack_hash: context.fact_pack_hash,
      confirmed_context_evidence_ids: [],
      operator_exclusions: [],
      operator_overrides: [],
      schema: schema(),
      operator_confirmed: true,
    }),
    runtimeEnv, LISTING_ID, fetchFn,
  );
  assert.equal(saveResponse.status, 201);
  const saved = await saveResponse.json() as Record<string, any>;
  assert.equal(saved.outcome, 'saved');
  assert.equal(stored.size, 1);
  assert.equal(state.approvedAsset?.asset_url, saved.asset_url);
  assert.equal((state.approvedAsset?.metadata as Record<string, any>).main_image.listing_id, LISTING_ID);

  const publishResponse = await handleOperatorMainImagePublish(
    request(`/listings/${LISTING_ID}/operator-main-image-publishes`, 'POST', {
      expected_content_revision: 3,
      asset_id: saved.asset_id,
      idempotency_key: 'main-image-publish-1',
      operator_confirmed: true,
    }),
    runtimeEnv, LISTING_ID, fetchFn,
  );
  assert.equal(publishResponse.status, 200);
  const published = await publishResponse.json() as Record<string, any>;
  assert.equal(published.outcome, 'published');
  assert.equal(published.content_revision, 4);
  assert.equal(published.image_urls[0], saved.asset_url);
  assert.equal(published.image_urls[1], 'https://market.example/detail.jpg');
  assert.equal(state.listing?.title, '収納ワゴン ベージュ');
  assert.equal(state.listing?.description, '移動に便利な収納ワゴンです。');
  const listingPatches = state.calls.filter((call) => call.url.includes('/platform_listings?') && call.method === 'PATCH');
  assert.equal(listingPatches.some((call) => Object.hasOwn(call.body as object, 'title')), false);
  assert.equal(listingPatches.some((call) => Object.hasOwn(call.body as object, 'description')), false);
  const relayCall = state.calls.find((call) => call.url === 'https://relay.test/marketplace/mercari');
  assert.ok(relayCall);
  const relayBody = relayCall.body as Record<string, any>;
  assert.equal(relayBody.action, 'listing-image-update');
  assert.equal(relayBody.payload.shopCode, 'shop2');
  assert.equal(relayBody.payload.listingId, 'mercari-listing-1');
  assert.equal(JSON.stringify(relayBody).includes('shop1'), false);
});

test('publish requires explicit operator confirmation before loading listing state', async () => {
  const state: MockState = { calls: [] };
  const response = await handleOperatorMainImagePublish(
    request(`/listings/${LISTING_ID}/operator-main-image-publishes`, 'POST', {
      expected_content_revision: 3,
      asset_id: APPROVED_ASSET_ID,
      idempotency_key: 'confirmation-required',
      operator_confirmed: false,
    }),
    env(), LISTING_ID, mockFetch(state),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'operator_confirmation_required' });
  assert.equal(state.calls.length, 0);
});

test('candidate rejects a stale fact pack before calling OpenAI image generation', async () => {
  const state: MockState = { calls: [] };
  const response = await handleMainImageCandidate(
    request(`/listings/${LISTING_ID}/main-image-candidate`, 'POST', {
      expected_content_revision: 3,
      fact_pack_hash: 'stale-hash',
      confirmed_context_evidence_ids: [],
      schema: schema(),
    }),
    env(), LISTING_ID, mockFetch(state),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'stale_fact_pack' });
  assert.equal(state.calls.some((call) => call.url === 'https://api.openai.com/v1/images/edits'), false);
});

for (const failureMode of ['relay failure', 'relay readback mismatch'] as const) {
  test(`${failureMode} releases the publication claim`, async () => {
    const state: MockState = {
      calls: [],
      approvedAsset: approvedAssetRow(),
      relayFailure: failureMode === 'relay failure',
      relayReadbackMismatch: failureMode === 'relay readback mismatch',
    };
    const response = await handleOperatorMainImagePublish(
      request(`/listings/${LISTING_ID}/operator-main-image-publishes`, 'POST', {
        expected_content_revision: 3,
        asset_id: APPROVED_ASSET_ID,
        idempotency_key: `failure-${failureMode}`,
        operator_confirmed: true,
      }),
      env(), LISTING_ID, mockFetch(state),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      listing_id: LISTING_ID,
      content_revision: 3,
      outcome: 'publish_failed',
    });
    assert.equal(state.listing?.lifecycle_stage, 'published');
    assert.equal(state.listing?.publish_claim_id, null);
    assert.equal(state.listing?.publish_idempotency_key, null);
  });
}

test('a completed publish idempotency key replays without another relay call', async () => {
  const state: MockState = {
    calls: [],
    listing: listingRow({ content_revision: 4, publish_idempotency_key: 'already-published' }),
  };
  const response = await handleOperatorMainImagePublish(
    request(`/listings/${LISTING_ID}/operator-main-image-publishes`, 'POST', {
      expected_content_revision: 3,
      asset_id: APPROVED_ASSET_ID,
      idempotency_key: 'already-published',
      operator_confirmed: true,
    }),
    env(), LISTING_ID, mockFetch(state),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    listing_id: LISTING_ID,
    content_revision: 4,
    outcome: 'replay',
  });
  assert.equal(state.calls.some((call) => call.url === 'https://relay.test/marketplace/mercari'), false);
});

test('asset save rejects candidate substitution before writing R2', async () => {
  const state: MockState = { calls: [] };
  let wrote = false;
  const runtimeEnv = env({
    MAIN_IMAGE_ASSETS: {
      async get() { return null; },
      async head() { return null; },
      async put() { wrote = true; return {}; },
      async delete() {},
    },
  });
  const fetchFn = mockFetch(state);
  const contextResponse = await handleMainImageContext(
    request(`/listings/${LISTING_ID}/main-image-context`, 'GET'), runtimeEnv, LISTING_ID, fetchFn,
  );
  const context = await contextResponse.json() as Record<string, any>;
  const bytes = jpegBytes();
  const imageHash = await sha256(bytes);
  const schemaHash = await hashCanonicalJson(schema());
  const token = await signCandidateToken({
    listingId: LISTING_ID,
    contentRevision: 3,
    imageSha256: imageHash,
    schemaHash,
    factPackHash: context.fact_pack_hash,
    model: 'gpt-image-2',
    exp: Math.floor(Date.now() / 1000) + 600,
  }, runtimeEnv.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET!);

  const substituted = jpegBytes();
  substituted[6] = 0x00;
  const response = await handleMainImageAssetSave(
    request(`/listings/${LISTING_ID}/main-image-assets`, 'POST', {
      expected_content_revision: 3,
      candidate_base64: encodeBase64(substituted),
      candidate_token: token,
      fact_pack_hash: context.fact_pack_hash,
      confirmed_context_evidence_ids: [],
      schema: schema(),
      operator_confirmed: true,
    }),
    runtimeEnv, LISTING_ID, fetchFn,
  );
  assert.equal(response.status, 409);
  assert.equal(wrote, false);
});

test('asset save bounds operator overrides before external writes', async () => {
  const state: MockState = { calls: [] };
  let wrote = false;
  const runtimeEnv = env({
    MAIN_IMAGE_ASSETS: {
      async get() { return null; },
      async head() { return null; },
      async put() { wrote = true; return {}; },
      async delete() {},
    },
  });
  const response = await handleMainImageAssetSave(
    request(`/listings/${LISTING_ID}/main-image-assets`, 'POST', {
      expected_content_revision: 3,
      candidate_base64: encodeBase64(jpegBytes()),
      candidate_token: 'unused',
      fact_pack_hash: 'unused',
      confirmed_context_evidence_ids: [],
      operator_overrides: Array.from({ length: 101 }, () => ({ reason: 'x' })),
      schema: schema(),
      operator_confirmed: true,
    }),
    runtimeEnv, LISTING_ID, mockFetch(state),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_operator_overrides' });
  assert.equal(state.calls.length, 0);
  assert.equal(wrote, false);
});

test('asset save removes the immutable R2 object when metadata insertion fails', async () => {
  const state: MockState = { calls: [], assetInsertFailure: true };
  const stored = new Map<string, Uint8Array>();
  const runtimeEnv = env({
    MAIN_IMAGE_ASSETS: {
      async get(key) {
        const value = stored.get(key);
        return value ? { body: byteStream(value), httpMetadata: { contentType: 'image/jpeg' } } : null;
      },
      async head(key) { return stored.has(key) ? {} : null; },
      async put(key, value) { stored.set(key, value); return {}; },
      async delete(key) { stored.delete(key); },
    },
  });
  const fetchFn = mockFetch(state);
  const contextResponse = await handleMainImageContext(
    request(`/listings/${LISTING_ID}/main-image-context`, 'GET'), runtimeEnv, LISTING_ID, fetchFn,
  );
  const context = await contextResponse.json() as Record<string, any>;
  const bytes = jpegBytes();
  const token = await signCandidateToken({
    listingId: LISTING_ID,
    contentRevision: 3,
    imageSha256: await sha256(bytes),
    schemaHash: await hashCanonicalJson(schema()),
    factPackHash: context.fact_pack_hash,
    model: 'gpt-image-2',
    exp: Math.floor(Date.now() / 1000) + 600,
  }, runtimeEnv.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET!);
  const response = await handleMainImageAssetSave(
    request(`/listings/${LISTING_ID}/main-image-assets`, 'POST', {
      expected_content_revision: 3,
      candidate_base64: encodeBase64(bytes),
      candidate_token: token,
      fact_pack_hash: context.fact_pack_hash,
      confirmed_context_evidence_ids: [],
      schema: schema(),
      operator_confirmed: true,
    }),
    runtimeEnv, LISTING_ID, fetchFn,
  );
  assert.equal(response.status, 502);
  assert.equal(stored.size, 0);
});

test('public asset delivery serves only immutable RPagentOS main-image keys', async () => {
  const bytes = jpegBytes();
  const key = 'products/WAGON-BEIGE/main-images/asset-id/v1.jpg';
  const runtimeEnv = env({
    MAIN_IMAGE_ASSETS: {
      async get(requested) {
        return requested === key
          ? { body: byteStream(bytes), httpMetadata: { contentType: 'image/jpeg' }, httpEtag: 'etag-1' }
          : null;
      },
      async head() { return null; },
      async put() { return {}; },
      async delete() {},
    },
  });
  const response = await handleMainImageAssetDelivery(
    new Request(`https://rpagentos.pages.dev/api/main-image-assets/${key}`), runtimeEnv, key,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('etag'), 'etag-1');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);

  const rejected = await handleMainImageAssetDelivery(
    new Request('https://rpagentos.pages.dev/api/main-image-assets/other/file.jpg'), runtimeEnv, 'other/file.jpg',
  );
  assert.equal(rejected.status, 404);
});

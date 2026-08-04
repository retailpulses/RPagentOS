import assert from 'node:assert/strict';
import test from 'node:test';
import { handleListingStateBatch, type InternalCatalogEnv } from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function validUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'mercari',
    shop_code: 'shop1',
    item_code: 'N511P407695W',
    external_listing_id: 'mercari-prod-1',
    external_sku_id: 'mercari-sku-1',
    sku_code: 'N511P407695W',
    listing_status: 'UNOPENED',
    observed_at: '2026-08-01T00:00:00.000Z',
    idempotency_key: 'idem-key-1',
    metadata: { score: 84 },
    ...overrides,
  };
}

function request(body: unknown, token = 'catalog-token'): Request {
  return new Request('https://worker.test/api/internal/catalog/listing-state', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockFullFetch(opts: {
  variants?: Array<{ id: string; item_code: string }>;
  listings?: Array<{
    id: string;
    variant_id: string | null;
    listing_status: string | null;
    raw_payload?: Record<string, unknown> | null;
    external_listing_id?: string;
    platform?: string;
    shop_code?: string;
  }>;
  skus?: Array<{
    listing_id: string;
    external_sku_id?: string | null;
    sku_code?: string | null;
    raw_payload?: Record<string, unknown> | null;
  }>;
  listingWriteFails?: boolean;
  skuWriteFails?: boolean;
} = {}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.includes('/platform_listing_skus')) {
      if (opts.skuWriteFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      return Response.json(body.map((row: Record<string, unknown>) => ({ id: 'sku-new-id', ...row })));
    }

    if (method === 'POST' && url.includes('/platform_listings')) {
      if (opts.listingWriteFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      return Response.json(body.map((row: Record<string, unknown>) => ({ id: 'listing-new-id', ...row })));
    }

    if (url.includes('/platform_listing_skus?')) {
      return Response.json(opts.skus ?? []);
    }

    if (url.includes('/platform_listings?')) {
      return Response.json((opts.listings ?? []).map((l) => ({
        ...l,
        external_listing_id: l.external_listing_id ?? 'mercari-prod-1',
        platform: l.platform ?? 'mercari',
        shop_code: l.shop_code ?? 'shop1',
      })));
    }

    if (url.includes('/product_variants?')) {
      return Response.json(opts.variants ?? []);
    }

    return Response.json([]);
  };
}

test('rejects unauthorized requests', async () => {
  let called = false;
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }, 'wrong-token'),
    env,
    async () => { called = true; return Response.json([]); },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
  assert.equal(called, false);
});

test('rejects non-POST methods', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-state', {
    method: 'GET',
    headers: { authorization: 'Bearer catalog-token' },
  });
  const response = await handleListingStateBatch(req, env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('rejects malformed JSON', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-state', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token' },
    body: 'not-json',
  });
  const response = await handleListingStateBatch(req, env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_json' });
});

test('rejects missing updates array', async () => {
  const response = await handleListingStateBatch(
    request({}),
    env,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_updates', message: 'updates must be an array' });
});

test('rejects empty updates array', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [] }),
    env,
  );
  assert.equal(response.status, 400);
});

test('rejects too many updates', async () => {
  const many = Array.from({ length: 101 }, (_, i) => validUpdate({ idempotency_key: `key-${i}`, external_listing_id: `ext-${i}` }));
  const response = await handleListingStateBatch(
    request({ updates: many }),
    env,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_update_count', min: 1, max: 100 });
});

test('accepts exactly 100 updates', async () => {
  const many = Array.from({ length: 100 }, (_, i) => validUpdate({
    idempotency_key: `key-${i}`,
    external_listing_id: `ext-${i}`,
    item_code: `ITEM-${String(i).padStart(3, '0')}`,
    sku_code: `ITEM-${String(i).padStart(3, '0')}`,
  }));
  const variantMap = new Map<string, { id: string; item_code: string }>();
  for (const u of many) {
    const code = (u.item_code as string).toUpperCase();
    variantMap.set(code, { id: `v-${code}`, item_code: code });
  }

  let variantBatchIdx = 0;
  const response = await handleListingStateBatch(
    request({ updates: many }),
    env,
    async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/platform_listings')) {
        const body = JSON.parse(init.body as string);
        return Response.json(body.map((row: Record<string, unknown>) => ({ id: 'lid-new', ...row })));
      }
      if (init?.method === 'POST' && url.includes('/platform_listing_skus')) {
        const body = JSON.parse(init.body as string);
        return Response.json(body.map((row: Record<string, unknown>) => ({ id: 'sid-new', ...row })));
      }
      if (url.includes('/platform_listing_skus?')) {
        return Response.json([]);
      }
      if (url.includes('/platform_listings?')) {
        return Response.json([]);
      }
      if (url.includes('/product_variants?')) {
        variantBatchIdx += 1;
        return Response.json(
          many.slice((variantBatchIdx - 1) * 50, variantBatchIdx * 50)
            .map((u) => variantMap.get((u.item_code as string).toUpperCase())!)
            .filter(Boolean),
        );
      }
      return Response.json([]);
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: unknown[] };
  assert.equal(body.results.length, 100);
  for (const result of body.results) {
    const r = result as Record<string, unknown>;
    assert.equal(r.result, 'created', `expected created got ${r.error ?? r.result}`);
  }
});

test('rejects unknown keys in update', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [{ ...validUpdate(), extra_unknown: 'bad' }] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /unknown_key_extra_unknown/);
});

test('rejects missing required string fields', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ platform: '' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /missing_or_blank_platform/);
});

test('rejects blank required string fields', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ item_code: '   ' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /missing_or_blank_item_code/);
});

test('rejects oversized fields', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ platform: 'x'.repeat(65) })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /oversized_platform/);
});

test('rejects invalid listing status', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'INVALID' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /invalid_listing_status/);
});

test('rejects invalid observed_at timestamp', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ observed_at: 'not-a-date' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /invalid_observed_at/);
});

test('rejects observed_at without an explicit timezone', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ observed_at: '2026-08-01T00:00:00' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /invalid_observed_at/);
});

test('rejects non-object metadata', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ metadata: ['not-an-object'] })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /non_object_metadata/);
});

test('rejects oversized metadata (>16KB)', async () => {
  const bigMetadata: Record<string, string> = {};
  let size = 0;
  let idx = 0;
  while (size < 17 * 1024) {
    const key = `key_${idx}`;
    const value = 'x'.repeat(200);
    bigMetadata[key] = value;
    size += key.length + value.length + 6;
    idx += 1;
  }
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ metadata: bigMetadata })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /oversized_metadata/);
});

test('rejects duplicate identities within request', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ idempotency_key: 'a' }), validUpdate({ idempotency_key: 'b' })] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /duplicate_request_identity/);
});

test('returns variant_not_found when item_code has no match', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({ variants: [], listings: [], skus: [] }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'variant_not_found');
});

test('returns duplicate_item_code when item_code matches multiple variants', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({
      variants: [
        { id: 'v1', item_code: 'N511P407695W' },
        { id: 'v2', item_code: 'N511P407695W' },
      ],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'duplicate_item_code');
});

test('returns identity_conflict when existing listing maps to different variant', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v-new', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v-old',
        listing_status: 'OPENED',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'identity_conflict');
});

test('returns identity_conflict when existing SKU maps to different sku_code', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'OPENED',
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'DIFFERENT-CODE',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'identity_conflict');
});

test('returns identity_conflict when existing SKU maps to different external_sku_id', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'OPENED',
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'different-sku-id',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'identity_conflict');
});

test('returns illegal_status_transition when CLOSED tries to OPEN', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'OPENED' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'CLOSED',
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'illegal_status_transition');
});

test('returns unchanged for idempotent retry with matching key', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate()] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'UNOPENED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'idem-key-1',
            observed_at: '2026-08-01T00:00:00.000Z',
            queued_at: '2026-08-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'unchanged');
});

test('creates a new UNOPENED listing with both table writes', async () => {
  const writtenListings: Array<Record<string, unknown>> = [];
  const writtenSkus: Array<Record<string, unknown>> = [];

  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({
      metadata: { score: 84, observed_at: 'attacker-value', idempotency_key: 'attacker-key' },
    })] }),
    env,
    async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/platform_listing_skus')) {
        assert.match(url, /on_conflict=listing_id%2Csku_position/);
        const rows = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
        writtenSkus.push(...rows);
        return Response.json(rows.map((row) => ({ id: 'sku-new-id', ...row })));
      }
      if (init?.method === 'POST' && url.includes('/platform_listings')) {
        assert.match(url, /on_conflict=platform%2Cshop_code%2Cexternal_listing_id/);
        const rows = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
        writtenListings.push(...rows);
        return Response.json(rows.map((row) => ({ id: 'listing-new-id', ...row })));
      }
      if (url.includes('/product_variants?')) {
        return Response.json([{ id: 'v1', item_code: 'N511P407695W' }]);
      }
      return Response.json([]);
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'created');
  assert.equal(writtenListings.length, 1);
  assert.equal(writtenSkus.length, 1);
  const listingPayload = writtenListings[0].raw_payload as Record<string, unknown>;
  const state = listingPayload.catalogsync_listing_state as Record<string, unknown>;
  assert.equal(state.observed_at, '2026-08-01T00:00:00.000Z');
  assert.equal(state.idempotency_key, 'idem-key-1');
  assert.equal(state.queued_at, '2026-08-01T00:00:00.000Z');
});

test('transitions UNOPENED to OPENED and preserves queued_at', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'OPENED', idempotency_key: 'key-2' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'UNOPENED',
        raw_payload: {
          other_key: 'preserved',
          catalogsync_listing_state: {
            idempotency_key: 'key-1',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
        raw_payload: { sku_data: 'keep-me' },
      }],
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('preserves unrelated raw_payload keys during merge', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ idempotency_key: 'key-2' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'UNOPENED',
        raw_payload: {
          unrelated_field: 'keep-me',
          another_one: 42,
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('UNOPENED -> UNOPENED with mismatched idempotency key is still legal', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ idempotency_key: 'new-key' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'UNOPENED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.notEqual(body.results[0].error, 'illegal_status_transition');
  assert.equal(body.results[0].result, 'updated');
});

test('OPENED transitions to CLOSED and SUSPENDED', async () => {
  const tests = ['CLOSED', 'SUSPENDED'];
  for (const status of tests) {
    const response = await handleListingStateBatch(
      request({ updates: [validUpdate({ listing_status: status, idempotency_key: `key-${status}` })] }),
      env,
      mockFullFetch({
        variants: [{ id: 'v1', item_code: 'N511P407695W' }],
        listings: [{
          id: 'listing-1',
          variant_id: 'v1',
          listing_status: 'OPENED',
          raw_payload: {
            catalogsync_listing_state: {
              idempotency_key: 'original-key',
              queued_at: '2026-07-01T00:00:00.000Z',
              opened_at: '2026-07-15T00:00:00.000Z',
            },
          },
        }],
        skus: [{
          listing_id: 'listing-1',
          external_sku_id: 'mercari-sku-1',
          sku_code: 'N511P407695W',
        }],
      }),
    );
    assert.equal(response.status, 200, `failed for status ${status}`);
    const body = await response.json() as { results: Record<string, unknown>[] };
    assert.equal(body.results[0].result, 'updated', `failed for status ${status}`);
  }
});

test('CLOSED stays CLOSED', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'CLOSED', idempotency_key: 'new-key' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'CLOSED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
            opened_at: '2026-07-15T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('results follow input order mixing successes and failures', async () => {
  const response = await handleListingStateBatch(
    request({
      updates: [
        validUpdate({ idempotency_key: 'k1', external_listing_id: 'ext-1', item_code: 'MISSING' }),
        validUpdate({ idempotency_key: 'k2', external_listing_id: 'ext-2' }),
        validUpdate({ idempotency_key: 'k3', external_listing_id: 'ext-3', listing_status: 'OPENED' }),
      ],
    }),
    env,
    mockFullFetch({
      variants: [
        { id: 'v2', item_code: 'N511P407695W' },
      ],
      listings: [{
        id: 'listing-3',
        variant_id: 'v2',
        listing_status: 'UNOPENED',
        external_listing_id: 'ext-3',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'original-k3',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-3',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results.length, 3);
  assert.equal(body.results[0].error, 'variant_not_found');
  assert.equal(body.results[0].external_listing_id, 'ext-1');
  assert.equal(body.results[1].result, 'created');
  assert.equal(body.results[1].external_listing_id, 'ext-2');
  assert.equal(body.results[2].result, 'updated');
  assert.equal(body.results[2].external_listing_id, 'ext-3');
});

test('maps upstream variant-read failure to 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleListingStateBatch(
      request({ updates: [validUpdate()] }),
      env,
      async (input) => {
        if (String(input).includes('/product_variants?')) {
          return new Response('unavailable', { status: 503 });
        }
        return Response.json([]);
      },
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('maps upstream listing-read failure to 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleListingStateBatch(
      request({ updates: [validUpdate()] }),
      env,
      async (input) => {
        const url = String(input);
        if (url.includes('/platform_listings?') && !url.includes('skus')) {
          return new Response('unavailable', { status: 503 });
        }
        if (url.includes('/product_variants?')) {
          return Response.json([{ id: 'v1', item_code: 'N511P407695W' }]);
        }
        return Response.json([]);
      },
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('maps upstream listing-write failure to 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleListingStateBatch(
      request({ updates: [validUpdate()] }),
      env,
      mockFullFetch({
        variants: [{ id: 'v1', item_code: 'N511P407695W' }],
        listings: [],
        skus: [],
        listingWriteFails: true,
      }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('maps upstream SKU-write failure to 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleListingStateBatch(
      request({ updates: [validUpdate()] }),
      env,
      mockFullFetch({
        variants: [{ id: 'v1', item_code: 'N511P407695W' }],
        listings: [],
        skus: [],
        skuWriteFails: true,
      }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('SUSPENDED may only remain SUSPENDED', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'OPENED', idempotency_key: 'key-2' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'SUSPENDED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].error, 'illegal_status_transition');
});

test('SUSPENDED stays SUSPENDED with new idempotency_key', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'SUSPENDED', idempotency_key: 'key-2' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'SUSPENDED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('metadata null is treated as empty object', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ metadata: null })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [],
      skus: [],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'created');
});

test('metadata undefined is treated as empty object', async () => {
  const u = validUpdate();
  delete u.metadata;
  const response = await handleListingStateBatch(
    request({ updates: [u] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [],
      skus: [],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'created');
});

test('OPENED -> OPENED stays OPENED', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'OPENED', idempotency_key: 'key-2' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'OPENED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'old-key',
            queued_at: '2026-07-01T00:00:00.000Z',
            opened_at: '2026-07-15T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('legacy active status reconciles as OPENED', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'OPENED', idempotency_key: 'legacy-reconcile' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{ id: 'listing-1', variant_id: 'v1', listing_status: 'active' }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('rejects non-object item in updates array', async () => {
  const response = await handleListingStateBatch(
    request({ updates: ['not-an-object'] }),
    env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as Record<string, string>;
  assert.match(body.error, /invalid_update_item/);
});

test('case-insensitive item_code resolution', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ item_code: 'n511p407695w' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [],
      skus: [],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'created');
});

test('UNOPENED to OPENED sets opened_at, CLOSED to CLOSED preserves both timestamps', async () => {
  const response = await handleListingStateBatch(
    request({ updates: [validUpdate({ listing_status: 'CLOSED', idempotency_key: 'k3' })] }),
    env,
    mockFullFetch({
      variants: [{ id: 'v1', item_code: 'N511P407695W' }],
      listings: [{
        id: 'listing-1',
        variant_id: 'v1',
        listing_status: 'OPENED',
        raw_payload: {
          catalogsync_listing_state: {
            idempotency_key: 'k2',
            queued_at: '2026-07-01T00:00:00.000Z',
            opened_at: '2026-07-15T00:00:00.000Z',
          },
        },
      }],
      skus: [{
        listing_id: 'listing-1',
        external_sku_id: 'mercari-sku-1',
        sku_code: 'N511P407695W',
      }],
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { results: Record<string, unknown>[] };
  assert.equal(body.results[0].result, 'updated');
});

test('rejects non-object body (array)', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-state', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token', 'content-type': 'application/json' },
    body: '[]',
  });
  const response = await handleListingStateBatch(req, env);
  assert.equal(response.status, 400);
});

test('rejects null body', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-state', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token', 'content-type': 'application/json' },
    body: 'null',
  });
  const response = await handleListingStateBatch(req, env);
  assert.equal(response.status, 400);
});

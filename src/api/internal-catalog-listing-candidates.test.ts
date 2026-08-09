import assert from 'node:assert/strict';
import test from 'node:test';
import { handleListingCandidatesQuery, type InternalCatalogEnv } from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function request(body: unknown, token = 'catalog-token'): Request {
  return new Request('https://worker.test/api/internal/catalog/listing-candidates/query', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockFetch(opts: {
  variants?: Array<{
    id: string;
    item_code: string;
    variant_name?: string | null;
    color?: string | null;
    material?: string | null;
    raw_payload?: Record<string, unknown> | null;
  }>;
  commercials?: Array<Record<string, unknown>>;
  listings?: Array<{
    id: string;
    variant_id: string;
    external_listing_id: string;
    shop_code: string;
    listing_status: string;
    raw_payload?: Record<string, unknown> | null;
  }>;
  skus?: Array<{
    listing_id: string;
    external_sku_id?: string | null;
    sku_code?: string | null;
    sku_status?: string | null;
    raw_payload?: Record<string, unknown> | null;
  }>;
  variantReadFails?: boolean;
  commercialReadFails?: boolean;
  listingReadFails?: boolean;
  skuReadFails?: boolean;
  legacyListings?: Array<{
    id: string;
    variant_id: null;
    external_listing_id: string;
    shop_code: string;
    listing_status: string;
    raw_payload?: Record<string, unknown> | null;
  }>;
  legacySkus?: Array<{
    listing_id: string;
    external_sku_id?: string | null;
    sku_code?: string | null;
    sku_status?: string | null;
    raw_payload?: Record<string, unknown> | null;
  }>;
  legacySkuReadFails?: boolean;
  legacyListingReadFails?: boolean;
} = {}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input) => {
    const url = String(input);

    if (url.includes('/product_variants?')) {
      if (opts.variantReadFails) return new Response('unavailable', { status: 500 });
      return Response.json(opts.variants ?? []);
    }

    if (url.includes('/product_commercials?')) {
      if (opts.commercialReadFails) return new Response('unavailable', { status: 500 });
      return Response.json(opts.commercials ?? []);
    }

    if (url.includes('/platform_listings?')) {
      if (url.includes('variant_id=is.null')) {
        if (opts.legacyListingReadFails) return new Response('unavailable', { status: 500 });
        return Response.json((opts.legacyListings ?? []).map((l) => ({
          ...l,
          variant_id: null,
          raw_payload: l.raw_payload ?? null,
        })));
      }
      if (opts.listingReadFails) return new Response('unavailable', { status: 500 });
      return Response.json((opts.listings ?? []).map((l) => ({
        ...l,
        raw_payload: l.raw_payload ?? null,
      })));
    }

    if (url.includes('/platform_listing_skus?')) {
      if (url.includes('sku_code.ilike')) {
        if (opts.legacySkuReadFails) return new Response('unavailable', { status: 500 });
        return Response.json(opts.legacySkus ?? []);
      }
      if (opts.skuReadFails) return new Response('unavailable', { status: 500 });
      return Response.json(opts.skus ?? []);
    }

    return Response.json([]);
  };
}

function makeVariant(id: string, item_code: string, overrides: Record<string, unknown> = {}) {
  return { id, item_code, variant_name: 'Test Product', color: 'Red', material: 'Cotton', raw_payload: { extra: 'data' }, ...overrides };
}

function makeCommercial(variantId: string, overrides: Record<string, unknown> = {}) {
  return {
    variant_id: variantId,
    source_available_qty: 10,
    owned_qty: 0,
    source_unit_price: 1000,
    fulfillment_fee: 500,
    effective_cost_price: 1500,
    inventory_status: 'in_stock',
    restock_date: null,
    sync_status: 'synced',
    last_sync_success_at: '2025-06-01T00:00:00.000Z',
    raw_payload: { commercial_data: true },
    ...overrides,
  };
}

test('rejects unauthorized', async () => {
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }, 'wrong'),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 401);
});

test('rejects non-POST', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-candidates/query', {
    method: 'GET',
    headers: { authorization: 'Bearer catalog-token' },
  });
  const response = await handleListingCandidatesQuery(req, env, async () => Response.json([]));
  assert.equal(response.status, 405);
});

test('rejects invalid JSON', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/listing-candidates/query', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token', 'content-type': 'application/json' },
    body: 'not json',
  });
  const response = await handleListingCandidatesQuery(req, env, async () => Response.json([]));
  assert.equal(response.status, 400);
});

test('rejects empty item_codes', async () => {
  const response = await handleListingCandidatesQuery(
    request({}),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects non-array item_codes', async () => {
  const response = await handleListingCandidatesQuery(
    request({ item_codes: 'string' }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects >100 item_codes', async () => {
  const codes = Array.from({ length: 101 }, (_, i) => `SKU-${i}`);
  const response = await handleListingCandidatesQuery(
    request({ item_codes: codes }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects blank item code', async () => {
  const response = await handleListingCandidatesQuery(
    request({ item_codes: [''] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects duplicate case-insensitive item codes', async () => {
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['sku-a', 'SKU-A'] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects item code longer than 128 chars', async () => {
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['x'.repeat(129)] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('returns sku_not_found for missing variant', async () => {
  const fetchFn = mockFetch({ variants: [] });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['MISSING'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].error, 'sku_not_found');
  assert.equal(body.results[0].item_code, 'MISSING');
});

test('returns duplicate_item_code for ambiguous variant', async () => {
  const fetchFn = mockFetch({
    variants: [
      { id: 'v-1', item_code: 'SKU-A' },
      { id: 'v-2', item_code: 'sku-a' },
    ],
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'duplicate_item_code');
});

test('returns commercial_state_missing when no commercial row', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [],
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results[0].error, 'commercial_state_missing');
  assert.equal(body.results[0].item_code, 'SKU-A');
});

test('returns full candidate data with mercari mappings', async () => {
  const listingRawPayload = {
    catalogsync_listing_state: {
      queued_at: '2025-01-01T00:00:00.000Z',
      opened_at: '2025-02-01T00:00:00.000Z',
      idempotency_key: 'idem-1',
    },
    other_field: true,
  };

  const skuRawPayload = {
    catalogsync_listing_state: {
      queued_at: '2025-01-01T00:00:00.000Z',
      opened_at: '2025-02-01T00:00:00.000Z',
    },
  };

  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listings: [
      { id: 'l-1', variant_id: 'v-1', external_listing_id: 'ext-1', shop_code: 'shop1', listing_status: 'OPENED', raw_payload: listingRawPayload },
      { id: 'l-2', variant_id: 'v-1', external_listing_id: 'ext-2', shop_code: 'shop2', listing_status: 'UNOPENED', raw_payload: null },
    ],
    skus: [
      { listing_id: 'l-1', external_sku_id: 'esk-1', sku_code: 'SKU-A', sku_status: 'OPENED', raw_payload: skuRawPayload },
      { listing_id: 'l-2', external_sku_id: 'esk-2', sku_code: 'SKU-A', sku_status: 'UNOPENED', raw_payload: null },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  const r = body.results[0];

  assert.equal(r.variant_id, 'v-1');
  assert.equal(r.item_code, 'SKU-A');
  assert.equal(r.variant_name, 'Test Product');
  assert.equal(r.color, 'Red');
  assert.equal(r.material, 'Cotton');
  assert.deepEqual(r.variant_raw_payload, { extra: 'data' });
  assert.equal(r.source_available_qty, 10);
  assert.equal(r.owned_qty, 0);
  assert.equal(r.source_unit_price, 1000);
  assert.equal(r.fulfillment_fee, 500);
  assert.equal(r.effective_cost_price, 1500);
  assert.equal(r.inventory_status, 'in_stock');
  assert.equal(r.restock_date, null);
  assert.equal(r.sync_status, 'synced');
  assert.equal(r.last_sync_success_at, '2025-06-01T00:00:00.000Z');
  assert.deepEqual(r.commercial_raw_payload, { commercial_data: true });

  assert.ok(r.mercari_mappings.shop1);
  assert.equal(r.mercari_mappings.shop1.external_listing_id, 'ext-1');
  assert.equal(r.mercari_mappings.shop1.external_sku_id, 'esk-1');
  assert.equal(r.mercari_mappings.shop1.sku_code, 'SKU-A');
  assert.equal(r.mercari_mappings.shop1.status, 'OPENED');
  assert.equal(r.mercari_mappings.shop1.queued_at, '2025-01-01T00:00:00.000Z');
  assert.equal(r.mercari_mappings.shop1.opened_at, '2025-02-01T00:00:00.000Z');

  assert.ok(r.mercari_mappings.shop2);
  assert.equal(r.mercari_mappings.shop2.external_listing_id, 'ext-2');
  assert.equal(r.mercari_mappings.shop2.external_sku_id, 'esk-2');
  assert.equal(r.mercari_mappings.shop2.status, 'UNOPENED');
  assert.equal(r.mercari_mappings.shop2.queued_at, null);
  assert.equal(r.mercari_mappings.shop2.opened_at, null);

  assert.equal(r.mercari_mappings.shop3, null);
  assert.equal(r.mercari_mappings.shop4, null);
});

test('preserves input order', async () => {
  const fetchFn = mockFetch({
    variants: [
      makeVariant('v-1', 'SKU-B'),
      makeVariant('v-2', 'SKU-A'),
    ],
    commercials: [
      makeCommercial('v-1'),
      makeCommercial('v-2'),
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-B', 'SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].item_code, 'SKU-B');
  assert.equal(body.results[1].item_code, 'SKU-A');
});

test('returns listing_mapping_conflict when multiple listings per shop', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listings: [
      { id: 'l-1', variant_id: 'v-1', external_listing_id: 'ext-1', shop_code: 'shop1', listing_status: 'OPENED' },
      { id: 'l-2', variant_id: 'v-1', external_listing_id: 'ext-2', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

test('returns listing_mapping_conflict when multiple SKUs per listing', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listings: [
      { id: 'l-1', variant_id: 'v-1', external_listing_id: 'ext-1', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    skus: [
      { listing_id: 'l-1', external_sku_id: 'esk-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
      { listing_id: 'l-1', external_sku_id: 'esk-2', sku_code: 'SKU-B', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

test('variant read failure returns 502', async () => {
  const fetchFn = mockFetch({ variantReadFails: true });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('commercial read failure returns 502', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercialReadFails: true,
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('listing read failure returns 502', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listingReadFails: true,
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('SKU read failure returns 502', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listings: [{ id: 'l-1', variant_id: 'v-1', external_listing_id: 'ext-1', shop_code: 'shop1', listing_status: 'OPENED' }],
    skuReadFails: true,
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('handles exact zero in source_available_qty', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1', { source_available_qty: 0 })],
  });
  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results[0].source_available_qty, 0);
});

test('mixes success and error results preserving order', async () => {
  const fetchFn = mockFetch({
    variants: [
      makeVariant('v-1', 'SKU-A'),
    ],
    commercials: [makeCommercial('v-1')],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A', 'SKU-MISSING'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].item_code, 'SKU-A');
  assert.ok('variant_id' in body.results[0]);
  assert.equal(body.results[1].item_code, 'SKU-MISSING');
  assert.equal(body.results[1].error, 'sku_not_found');
});

test('returns legacy NULL-variant listing with shop mapping, IDs, and stored status', async () => {
  const listingRawPayload = {
    catalogsync_listing_state: {
      queued_at: '2025-01-01T00:00:00.000Z',
      opened_at: '2025-06-01T00:00:00.000Z',
    },
  };
  const skuRawPayload = {
    catalogsync_listing_state: {
      queued_at: '2025-01-01T00:00:00.000Z',
    },
  };

  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: 'ext-legacy-1', shop_code: 'shop1', listing_status: 'OPENED', raw_payload: listingRawPayload },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-legacy-1', sku_code: 'SKU-A', sku_status: 'OPENED', raw_payload: skuRawPayload },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  const r = body.results[0];

  assert.equal(r.variant_id, 'v-1');
  assert.ok(r.mercari_mappings.shop1, 'shop1 should have legacy mapping');
  assert.equal(r.mercari_mappings.shop1.external_listing_id, 'ext-legacy-1');
  assert.equal(r.mercari_mappings.shop1.external_sku_id, 'esk-legacy-1');
  assert.equal(r.mercari_mappings.shop1.sku_code, 'SKU-A');
  assert.equal(r.mercari_mappings.shop1.status, 'OPENED');
  assert.equal(r.mercari_mappings.shop1.queued_at, '2025-01-01T00:00:00.000Z');
  assert.equal(r.mercari_mappings.shop1.opened_at, '2025-06-01T00:00:00.000Z');

  assert.equal(r.mercari_mappings.shop2, null);
  assert.equal(r.mercari_mappings.shop3, null);
  assert.equal(r.mercari_mappings.shop4, null);
});

test('fails closed when legacy SKU identity set exceeds its safety ceiling', async () => {
  const legacySkus = Array.from({ length: 9 }, (_, index) => ({
    listing_id: `l-legacy-${index}`,
    external_sku_id: `esk-${index}`,
    sku_code: 'SKU-A',
    sku_status: 'OPENED',
  }));
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacySkus,
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'catalog_upstream_error');
});

test('duplicate legacy listings for one shop returns listing_mapping_conflict', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: 'ext-legacy-1', shop_code: 'shop1', listing_status: 'OPENED' },
      { id: 'l-legacy-2', variant_id: null, external_listing_id: 'ext-legacy-2', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
      { listing_id: 'l-legacy-2', external_sku_id: 'esk-2', sku_code: 'SKU-A', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

test('collision between linked and legacy listing returns listing_mapping_conflict', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    listings: [
      { id: 'l-1', variant_id: 'v-1', external_listing_id: 'ext-1', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    skus: [
      { listing_id: 'l-1', external_sku_id: 'esk-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
    ],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: 'ext-legacy-1', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-legacy-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

test('legacy listing with multiple SKU rows returns listing_mapping_conflict', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: 'ext-legacy-1', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-2', sku_code: 'SKU-B', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

test('legacy listing with empty external_listing_id returns candidate successfully', async () => {
  // Empty external_listing_id is a valid state — listings that haven't been
  // finalized yet (or were created before external IDs were assigned) may
  // have an empty external_listing_id.  The handler returns the candidate
  // data so the pipeline can populate the external ID via finalize_publish.
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: '', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: 'esk-legacy-1', sku_code: 'SKU-A', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const result = (await response.json()).results[0];
  assert.equal(result.error, undefined);
  assert.equal(result.item_code, 'SKU-A');
});

test('legacy listing with missing SKU external_sku_id returns listing_mapping_conflict', async () => {
  const fetchFn = mockFetch({
    variants: [makeVariant('v-1', 'SKU-A')],
    commercials: [makeCommercial('v-1')],
    legacyListings: [
      { id: 'l-legacy-1', variant_id: null, external_listing_id: 'ext-legacy-1', shop_code: 'shop1', listing_status: 'OPENED' },
    ],
    legacySkus: [
      { listing_id: 'l-legacy-1', external_sku_id: null, sku_code: 'SKU-A', sku_status: 'OPENED' },
    ],
  });

  const response = await handleListingCandidatesQuery(
    request({ item_codes: ['SKU-A'] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].error, 'listing_mapping_conflict');
});

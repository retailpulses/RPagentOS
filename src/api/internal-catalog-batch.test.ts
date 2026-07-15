import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleCatalogInventoryQueryRequest, type InternalCatalogEnv } from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function request(body: unknown, token = 'catalog-token'): Request {
  return new Request('https://worker.test/api/internal/catalog/inventory-query', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function inventoryContractFixture(): Promise<{
  request: { item_codes: string[] };
  response: unknown;
}> {
  const fixtureUrl = new URL('../../contracts/internal-catalog/inventory-query-v1.fixture.json', import.meta.url);
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('batch query rejects unauthorized requests before parsing or upstream reads', async () => {
  let calls = 0;
  const response = await handleCatalogInventoryQueryRequest(request({ item_codes: ['SKU'] }, 'wrong'), env, async () => {
    calls += 1;
    return Response.json([]);
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('batch query rejects malformed JSON, duplicates, and oversize requests', async () => {
  const malformed = new Request('https://worker.test/api/internal/catalog/inventory-query', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token' },
    body: '{',
  });
  assert.equal((await handleCatalogInventoryQueryRequest(malformed, env)).status, 400);

  const duplicate = await handleCatalogInventoryQueryRequest(request({ item_codes: ['sku', 'SKU'] }), env);
  assert.equal(duplicate.status, 400);
  assert.deepEqual(await duplicate.json(), { error: 'duplicate_request_item_code', item_code: 'SKU' });

  const oversize = await handleCatalogInventoryQueryRequest(
    request({ item_codes: Array.from({ length: 201 }, (_, index) => `SKU-${index}`) }),
    env,
  );
  assert.equal(oversize.status, 413);
  assert.deepEqual(await oversize.json(), { error: 'too_many_item_codes', max_item_codes: 200 });
});

test('batch query accepts exactly 200 unique item codes', async () => {
  const itemCodes = Array.from({ length: 200 }, (_, index) => `SKU-${index}`);
  let calls = 0;
  const response = await handleCatalogInventoryQueryRequest(
    request({ item_codes: itemCodes }),
    env,
    async () => {
      calls += 1;
      return Response.json([]);
    },
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 4);
  const body = await response.json() as { results: unknown[] };
  assert.equal(body.results.length, 200);
});

test('batch query rejects empty arrays and malformed item codes', async () => {
  assert.equal(
    (await handleCatalogInventoryQueryRequest(request({ item_codes: [] }), env)).status,
    400,
  );
  assert.equal(
    (await handleCatalogInventoryQueryRequest(request({ item_codes: ['   '] }), env)).status,
    400,
  );
  assert.equal(
    (await handleCatalogInventoryQueryRequest(request({ item_codes: [123] }), env)).status,
    400,
  );
});

test('batch query resolves lowercase identity, preserves zero, and returns ordered results', async () => {
  const fixture = await inventoryContractFixture();
  const urls: string[] = [];
  const response = await handleCatalogInventoryQueryRequest(
    request(fixture.request),
    env,
    async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/product_variants?')) {
        return Response.json([
          { id: 'v-zero', item_code: 'N511P407695W' },
          { id: 'v-stale', item_code: 'N511P407695B' },
        ]);
      }
      return Response.json([
        {
          variant_id: 'v-zero',
          source_available_qty: 0,
          sync_status: 'synced',
          last_sync_success_at: '2026-07-15T06:54:00.000Z',
        },
        {
          variant_id: 'v-stale',
          source_available_qty: 4,
          sync_status: 'failed',
          last_sync_success_at: '2026-07-14T06:54:00.000Z',
        },
      ]);
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), fixture.response);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /or=%28item_code\.ilike\.%22N511P407695W%22/);
  assert.match(urls[1], /variant_id=in\.%28%22v-zero%22/);
});

test('batch query reports missing and ambiguous identity and commercial states in request order', async () => {
  const response = await handleCatalogInventoryQueryRequest(
    request({ item_codes: ['missing', 'no-commercial', 'duplicate'] }),
    env,
    async (input) => String(input).includes('/product_variants?')
      ? Response.json([
        { id: 'v-no-commercial', item_code: 'NO-COMMERCIAL' },
        { id: 'v-duplicate-1', item_code: 'DUPLICATE' },
        { id: 'v-duplicate-2', item_code: 'DUPLICATE' },
      ])
      : Response.json([]),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [
      { requested_item_code: 'missing', item_code: null, error: 'sku_not_found' },
      {
        requested_item_code: 'no-commercial',
        item_code: 'NO-COMMERCIAL',
        error: 'commercial_state_missing',
      },
      { requested_item_code: 'duplicate', item_code: null, error: 'duplicate_item_code' },
    ],
  });
});

test('batch query treats null, fractional, and negative quantity as per-item errors', async () => {
  const response = await handleCatalogInventoryQueryRequest(
    request({ item_codes: ['NULL', 'FRACTION', 'NEGATIVE'] }),
    env,
    async (input) => String(input).includes('/product_variants?')
      ? Response.json([
        { id: 'v-null', item_code: 'NULL' },
        { id: 'v-fraction', item_code: 'FRACTION' },
        { id: 'v-negative', item_code: 'NEGATIVE' },
      ])
      : Response.json([
        { variant_id: 'v-null', source_available_qty: null, sync_status: 'synced', last_sync_success_at: 'now' },
        { variant_id: 'v-fraction', source_available_qty: 1.5, sync_status: 'synced', last_sync_success_at: 'now' },
        { variant_id: 'v-negative', source_available_qty: -1, sync_status: 'synced', last_sync_success_at: 'now' },
      ]),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [
      { requested_item_code: 'NULL', item_code: 'NULL', error: 'source_quantity_unknown' },
      { requested_item_code: 'FRACTION', item_code: 'FRACTION', error: 'source_quantity_unknown' },
      { requested_item_code: 'NEGATIVE', item_code: 'NEGATIVE', error: 'source_quantity_unknown' },
    ],
  });
});

test('batch query fails closed when duplicate commercial rows are returned', async () => {
  const response = await handleCatalogInventoryQueryRequest(
    request({ item_codes: ['sku'] }),
    env,
    async (input) => String(input).includes('/product_variants?')
      ? Response.json([{ id: 'v-sku', item_code: 'SKU' }])
      : Response.json([
        { variant_id: 'v-sku', source_available_qty: 0, sync_status: 'synced', last_sync_success_at: 'now' },
        { variant_id: 'v-sku', source_available_qty: 1, sync_status: 'synced', last_sync_success_at: 'now' },
      ]),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [{
      requested_item_code: 'sku',
      item_code: 'SKU',
      error: 'duplicate_commercial_state',
    }],
  });
});

test('batch query maps an upstream failure to a generic 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleCatalogInventoryQueryRequest(
      request({ item_codes: ['SKU'] }),
      env,
      async () => new Response('unavailable', { status: 503 }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

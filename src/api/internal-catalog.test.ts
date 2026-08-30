import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleCatalogSkuRequest,
  inquiryCatalogAuthorized,
  inquiryCatalogConfigurationReady,
  type InternalCatalogEnv,
} from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  ORDERMGMT_CATALOG_API_TOKEN: 'ordermgmt-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function request(token = 'catalog-token', method = 'GET'): Request {
  return new Request('https://worker.test/api/internal/catalog/sku/N511P407695W', {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

test('scopes a dedicated Inquiry credential without requiring the broad internal token', () => {
  const inquiryEnv: InternalCatalogEnv = {
    INQUIRY_CATALOG_API_TOKEN: 'inquiry-token',
    SUPABASE_URL: 'https://catalog.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  };
  assert.equal(inquiryCatalogConfigurationReady(inquiryEnv), true);
  assert.equal(inquiryCatalogAuthorized(request('inquiry-token'), inquiryEnv), true);
  assert.equal(inquiryCatalogAuthorized(request('wrong'), inquiryEnv), false);
});

test('rejects unauthorized requests without reading Supabase', async () => {
  let calls = 0;
  const response = await handleCatalogSkuRequest(request('wrong'), env, 'N511P407695W', async () => {
    calls += 1;
    return Response.json([]);
  });

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('returns 404 for an unknown item code', async () => {
  const response = await handleCatalogSkuRequest(
    request(),
    env,
    'UNKNOWN',
    async () => Response.json([]),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'sku_not_found', item_code: 'UNKNOWN' });
});

test('accepts the dedicated OrderMgmt token for SKU reads', async () => {
  const response = await handleCatalogSkuRequest(
    request('ordermgmt-token'),
    {
      ORDERMGMT_CATALOG_API_TOKEN: 'ordermgmt-token',
      SUPABASE_URL: 'https://catalog.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    },
    'UNKNOWN',
    async () => Response.json([]),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'sku_not_found', item_code: 'UNKNOWN' });
});

test('resolves a lowercase request to canonical item code and preserves zero', async () => {
  const urls: string[] = [];
  const response = await handleCatalogSkuRequest(request(), env, 'n511p407695w', async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/product_variants?')) {
      return Response.json([{ id: 'variant-1', item_code: 'N511P407695W' }]);
    }
    return Response.json([
      {
        source_available_qty: 0,
        sync_status: 'synced',
        last_sync_success_at: '2026-07-15T06:54:00.000Z',
        manual_cost_price: 1200,
        manual_presale_arrival_date: '2026-08-20',
        presale_info_protect_until: '2026-08-18',
        effective_cost_price: 1200,
      },
    ]);
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    item_code: 'N511P407695W',
    source_available_qty: 0,
    sync_status: 'synced',
    last_sync_success_at: '2026-07-15T06:54:00.000Z',
    manual_cost_price: 1200,
    manual_presale_arrival_date: '2026-08-20',
    presale_info_protect_until: '2026-08-18',
    effective_cost_price: 1200,
  });
  assert.equal(urls.length, 2);
  assert.match(urls[0], /or=%28item_code\.ilike\.%22n511p407695w%22%29/);
  assert.match(urls[1], /variant_id=eq\.variant-1/);
});

test('returns null fields when a variant has no commercial row', async () => {
  let calls = 0;
  const response = await handleCatalogSkuRequest(request(), env, 'N511P407695W', async () => {
    calls += 1;
    return calls === 1
      ? Response.json([{ id: 'variant-1', item_code: 'N511P407695W' }])
      : Response.json([]);
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    item_code: 'N511P407695W',
    source_available_qty: null,
    sync_status: null,
    last_sync_success_at: null,
    manual_cost_price: null,
    manual_presale_arrival_date: null,
    presale_info_protect_until: null,
    effective_cost_price: null,
  });
});

test('returns 409 instead of selecting an ambiguous duplicate', async () => {
  const response = await handleCatalogSkuRequest(request(), env, 'DUPLICATE', async () =>
    Response.json([
      { id: 'variant-1', item_code: 'DUPLICATE' },
      { id: 'variant-2', item_code: 'DUPLICATE' },
    ]),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'duplicate_item_code', item_code: 'DUPLICATE' });
});

test('maps a Supabase failure to a generic 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleCatalogSkuRequest(
      request(),
      env,
      'N511P407695W',
      async () => new Response('forbidden', { status: 403 }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('rejects non-GET methods', async () => {
  const response = await handleCatalogSkuRequest(request('catalog-token', 'POST'), env, 'SKU');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

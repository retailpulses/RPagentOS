import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSourceImportBatch, type InternalCatalogEnv } from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

const PAST = '2025-01-15T00:00:00.000Z';
const FUTURE_OK = new Date(Date.now() - 86400000).toISOString();
const RUN_KEY = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
const ROW_HASH = 'a'.repeat(64);
const OLD_ROW_HASH = 'b'.repeat(64);
const NEW_ROW_HASH = 'c'.repeat(64);

function validRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_system: 'gigab2b_saved',
    window_start: PAST,
    window_end: FUTURE_OK,
    run_key: RUN_KEY,
    is_bootstrap: true,
    ...overrides,
  };
}

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    row_index: 1,
    item_code: 'TEST-SKU-001',
    source_added_at: PAST,
    source_updated_at: null,
    row_hash: ROW_HASH,
    variant: {
      variant_name: 'Test Product',
      color: 'Red',
      material: 'Cotton',
      raw_payload: { source: 'giga' },
    },
    commercial: {
      source_available_qty: 10,
      owned_qty: 0,
      source_unit_price: 1000,
      discounted_unit_price: null,
      fulfillment_fee: 500,
      effective_cost_price: 1500,
      inventory_status: 'in_stock',
      restock_date: null,
      raw_payload: { price_tier: 'A' },
    },
    ...overrides,
  };
}

function request(body: unknown, token = 'catalog-token'): Request {
  return new Request('https://worker.test/api/internal/catalog/source-imports/batch', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type MockVariant = { id: string; item_code: string; sku: string };

function mockFetch(opts: {
  variants?: MockVariant[];
  variantWriteFails?: boolean;
  runExists?: boolean;
  runExistsId?: string;
  runInsertFails?: boolean;
  existingRows?: Array<{ row_index: number; row_hash: string }>;
  rowUpsertFails?: boolean;
  commercialUpsertFails?: boolean;
  patchFails?: boolean;
} = {}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const createdVariants: MockVariant[] = [];

  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'PATCH' && url.includes('/source_import_runs')) {
      if (opts.patchFails) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify([{ id: 'run-1' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'POST' && url.includes('/product_variants')) {
      if (opts.variantWriteFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      const newVariants = body.map((row: Record<string, unknown>) => {
        const existing = [...(opts.variants ?? []), ...createdVariants]
          .find((variant) => variant.sku === row.sku);
        if (existing) return existing;
        const v: MockVariant = { id: `new-${row.sku}`, item_code: row.item_code as string, sku: row.sku as string };
        createdVariants.push(v);
        return v;
      });
      return Response.json(newVariants);
    }

    if (method === 'POST' && url.includes('/source_import_rows')) {
      if (opts.rowUpsertFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      return Response.json(body);
    }

    if (method === 'POST' && url.includes('/product_commercials')) {
      if (opts.commercialUpsertFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      return Response.json(body);
    }

    if (method === 'POST' && url === 'https://catalog.test/rest/v1/source_import_runs') {
      if (opts.runInsertFails) return new Response('unavailable', { status: 503 });
      const body = JSON.parse(init?.body as string ?? '[]');
      return Response.json(body.map((row: Record<string, unknown>) => ({ id: opts.runExistsId ?? 'run-1', ...row })));
    }

    if (url.includes('/source_import_runs?')) {
      if (opts.runExists) {
        return Response.json([{ id: 'existing-run-id', status: 'completed', row_count: 5 }]);
      }
      return Response.json([]);
    }

    if (url.includes('/source_import_rows?')) {
      return Response.json(opts.existingRows ?? []);
    }

    if (url.includes('/product_variants?')) {
      return Response.json([...(opts.variants ?? []), ...createdVariants]);
    }

    return Response.json([]);
  };
}

test('rejects unauthorized requests', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }, 'wrong-token'),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 401);
});

test('rejects non-POST methods', async () => {
  const fetchFn = () => Promise.resolve(Response.json([]));
  const req = new Request('https://worker.test/api/internal/catalog/source-imports/batch', {
    method: 'GET',
    headers: { authorization: 'Bearer catalog-token' },
  });
  const response = await handleSourceImportBatch(req, env, fetchFn);
  assert.equal(response.status, 405);
});

test('rejects configured but unset env', async () => {
  const partialEnv: InternalCatalogEnv = { INTERNAL_CATALOG_API_TOKEN: 'x' };
  const response = await handleSourceImportBatch(
    new Request('https://worker.test/api/internal/catalog/source-imports/batch', {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: '{}',
    }),
    partialEnv,
    async () => Response.json([]),
  );
  assert.equal(response.status, 503);
});

test('rejects invalid JSON body', async () => {
  const req = new Request('https://worker.test/api/internal/catalog/source-imports/batch', {
    method: 'POST',
    headers: { authorization: 'Bearer catalog-token', 'content-type': 'application/json' },
    body: 'not json',
  });
  const response = await handleSourceImportBatch(req, env, async () => Response.json([]));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'invalid_json');
});

test('rejects array body', async () => {
  const response = await handleSourceImportBatch(
    request([], 'catalog-token'),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects body with extra keys', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()], extra: true }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects missing run', async () => {
  const response = await handleSourceImportBatch(
    request({ rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects missing rows', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun() }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects unknown run keys', async () => {
  const response = await handleSourceImportBatch(
    request({ run: { ...validRun(), extra_field: 'nope' }, rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.message, /unknown run keys/);
});

test('rejects invalid source_system', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ source_system: 'amazon' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid window_start', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ window_start: 'not-a-date' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid window_end', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ window_end: 'not-a-date' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects window_start after window_end', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ window_start: '2026-01-01T00:00:00.000Z', window_end: '2025-01-01T00:00:00.000Z' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects window_start equal to window_end', async () => {
  const same = '2025-06-01T00:00:00.000Z';
  const response = await handleSourceImportBatch(
    request({ run: validRun({ window_start: same, window_end: same }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects missing run_key', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ run_key: '' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects non-boolean is_bootstrap', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun({ is_bootstrap: 'yes' }), rows: [validRow()] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects empty rows array', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects more than 100 rows', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => validRow({ row_index: i + 1, item_code: `SKU-${i + 1}` }));
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects non-arrays rows', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: 'not-array' }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects non-object row', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: ['string'] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects row with unknown keys', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [{ ...validRow(), extra_key: 'bad' } as Record<string, unknown>] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.message, /unknown row keys/);
});

test('rejects oversized row', async () => {
  const bigPayload = 'x'.repeat(132_000);
  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [validRow({
        variant: {
          variant_name: 'Test Product',
          color: 'Red',
          material: 'Cotton',
          raw_payload: { big: bigPayload } as Record<string, unknown>,
        },
      })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /exceeds.*bytes/);
});

test('rejects negative row_index', async () => {
  for (const idx of [-1, 0, 1.5]) {
    const response = await handleSourceImportBatch(
      request({ run: validRun(), rows: [validRow({ row_index: idx })] }),
      env,
      async () => Response.json([]),
    );
    assert.equal(response.status, 400);
  }
});

test('rejects duplicate row_index', async () => {
  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [validRow({ row_index: 1 }), validRow({ row_index: 1, item_code: 'SKU-2' })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid item_code', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ item_code: '' })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects duplicate case-insensitive item codes', async () => {
  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [validRow({ row_index: 1, item_code: 'sku-a' }), validRow({ row_index: 2, item_code: 'SKU-A' })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid source_added_at', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ source_added_at: 'not-iso' })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects leaking source_added_at beyond window_end', async () => {
  const response = await handleSourceImportBatch(
    request({
      run: validRun({ window_start: '2025-01-01T00:00:00.000Z', window_end: '2025-06-01T00:00:00.000Z' }),
      rows: [validRow({ source_added_at: '2025-07-01T00:00:00.000Z' })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects future source_added_at', async () => {
  const tooFar = new Date(Date.now() + 86_400_000).toISOString();
  const response = await handleSourceImportBatch(
    request({
      run: validRun({ window_end: tooFar }),
      rows: [validRow({ source_added_at: tooFar })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid source_updated_at string', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ source_updated_at: 'bad-date' })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects leaking source_updated_at', async () => {
  const response = await handleSourceImportBatch(
    request({
      run: validRun({ window_end: '2025-06-01T00:00:00.000Z' }),
      rows: [validRow({ source_updated_at: '2025-07-01T00:00:00.000Z' })],
    }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects missing row_hash', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ row_hash: undefined })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid variant object', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ variant: 'not-object' })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects unknown variant key', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ variant: { variant_name: 'Test Product', color: 'Red', material: 'Cotton', raw_payload: { source: 'giga' }, extra: 'nope' as unknown } })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects blank variant_name', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ variant: { variant_name: '  ', color: 'Red', material: 'Cotton', raw_payload: { source: 'giga' } } })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects invalid commercial object', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ commercial: 'not-object' })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects unknown commercial key', async () => {
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow({ commercial: { source_available_qty: 10, owned_qty: 0, source_unit_price: 1000, discounted_unit_price: null, fulfillment_fee: 500, effective_cost_price: 1500, inventory_status: 'in_stock', restock_date: null, raw_payload: { price_tier: 'A' }, extra: 'nope' as unknown } })] }),
    env,
    async () => Response.json([]),
  );
  assert.equal(response.status, 400);
});

test('rejects non-number commercial fields', async () => {
  const badFields = ['source_available_qty', 'owned_qty', 'source_unit_price', 'fulfillment_fee', 'effective_cost_price'];
  for (const field of badFields) {
    const baseCommercial: Record<string, unknown> = { source_available_qty: 10, owned_qty: 0, source_unit_price: 1000, discounted_unit_price: null, fulfillment_fee: 500, effective_cost_price: 1500, inventory_status: 'in_stock', restock_date: null, raw_payload: { price_tier: 'A' } };
    const badCommercial = { ...baseCommercial, [field]: 'not-a-number' };
    const response = await handleSourceImportBatch(
      request({ run: validRun(), rows: [validRow({ commercial: badCommercial })] }),
      env,
      async () => Response.json([]),
    );
    assert.equal(response.status, 400);
  }
});

test('creates variants and returns created', async () => {
  const fetchFn = mockFetch({
    variants: [],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].result, 'created');
  assert.equal(body.results[0].row_index, 1);
  assert.equal(body.results[0].item_code, 'TEST-SKU-001');
  assert.ok(body.results[0].variant_id);
});

test('uses existing variants and returns created', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-123', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].result, 'created');
  assert.equal(body.results[0].item_code, 'TEST-SKU-001');
  assert.equal(body.results[0].variant_id, 'v-123');
});

test('batch with multiple rows returns input-ordered results', async () => {
  const fetchFn = mockFetch({
    variants: [
      { id: 'v-1', item_code: 'SKU-A', sku: 'SKU-A' },
      { id: 'v-2', item_code: 'SKU-B', sku: 'SKU-B' },
    ],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [
        validRow({ row_index: 3, item_code: 'SKU-B' }),
        validRow({ row_index: 1, item_code: 'SKU-A' }),
      ],
    }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].row_index, 1);
  assert.equal(body.results[1].row_index, 3);
});

test('returns unchanged on replay with identical row hashes', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: true,
    runExistsId: 'existing-run-id',
    existingRows: [{ row_index: 1, row_hash: ROW_HASH }],
  });

  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].result, 'unchanged');
});

test('returns updated on replay with different row hash', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: true,
    runExistsId: 'existing-run-id',
    existingRows: [{ row_index: 1, row_hash: OLD_ROW_HASH }],
  });

  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].result, 'updated');
});

test('mixed unchanged and created on partial replay', async () => {
  const fetchFn = mockFetch({
    variants: [
      { id: 'v-1', item_code: 'SKU-A', sku: 'SKU-A' },
      { id: 'v-2', item_code: 'SKU-B', sku: 'SKU-B' },
    ],
    runExists: true,
    runExistsId: 'existing-run-id',
    existingRows: [{ row_index: 1, row_hash: ROW_HASH }],
  });

  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [
        validRow({ row_index: 1, item_code: 'SKU-A' }),
        validRow({ row_index: 2, item_code: 'SKU-B', row_hash: NEW_ROW_HASH }),
      ],
    }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  const r1 = body.results.find((r: Record<string, unknown>) => r.row_index === 1);
  const r2 = body.results.find((r: Record<string, unknown>) => r.row_index === 2);
  assert.equal(r1.result, 'unchanged');
  assert.equal(r2.result, 'created');
});

test('exact zero source_available_qty is preserved', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [validRow({
        commercial: {
          source_available_qty: 0,
          owned_qty: 0,
          source_unit_price: 1000,
          discounted_unit_price: null,
          fulfillment_fee: 500,
          effective_cost_price: 1500,
          inventory_status: 'in_stock',
          restock_date: null,
          raw_payload: { price_tier: 'A' },
        },
      })],
    }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].result, 'created');
});

test('accepts null discounted_unit_price and null restock_date', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [validRow()],
    }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
});

test('variant read failure returns 502', async () => {
  const fetchFn = () => {
    if (  (globalThis as Record<string, unknown>).__mockVariantReadFails) return Promise.resolve(new Response('unavailable', { status: 500 }));
    return Promise.resolve(Response.json([]));
  };
  // Simulate variant read failure by passing a fetch that always fails
  const failingFetch = () => Promise.resolve(new Response('unavailable', { status: 500 }));
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    failingFetch,
  );
  assert.equal(response.status, 502);
});

test('variant write failure returns 502', async () => {
  const fetchFn = mockFetch({ variants: [], variantWriteFails: true });
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('run insert failure returns 502', async () => {
  const fetchFn = mockFetch({ variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }], runExists: false, runInsertFails: true });
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('row upsert failure returns 502', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: false,
    rowUpsertFails: true,
  });
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('commercial upsert failure returns 502', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'TEST-SKU-001', sku: 'TEST-SKU-001' }],
    runExists: false,
    commercialUpsertFails: true,
  });
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [validRow()] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 502);
});

test('creates multiple missing variants in batch', async () => {
  const fetchFn = mockFetch({
    variants: [{ id: 'v-1', item_code: 'SKU-A', sku: 'SKU-A' }],
    runExists: false,
  });

  const response = await handleSourceImportBatch(
    request({
      run: validRun(),
      rows: [
        validRow({ row_index: 1, item_code: 'SKU-A' }),
        validRow({ row_index: 2, item_code: 'SKU-B' }),
        validRow({ row_index: 3, item_code: 'SKU-C' }),
      ],
    }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 3);
  for (const r of body.results) {
    assert.equal(r.result, 'created');
  }
});

test('handles null color and material', async () => {
  const fetchFn = mockFetch({ variants: [], runExists: false });

  const row = validRow();
  const varObj = row.variant as Record<string, unknown>;
  (row as Record<string, unknown>).variant = { ...varObj, color: null, material: null };
  const response = await handleSourceImportBatch(
    request({ run: validRun(), rows: [row] }),
    env,
    fetchFn,
  );
  assert.equal(response.status, 200);
});

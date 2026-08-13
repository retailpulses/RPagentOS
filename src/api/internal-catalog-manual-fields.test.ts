import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCatalogSkuManualFieldsUpdate, type InternalCatalogEnv } from './internal-catalog.js';

const env: InternalCatalogEnv = {
  INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
  CATALOGSYNC_PIPELINE_API_TOKEN: 'pipeline-token',
  ORDERMGMT_CATALOG_API_TOKEN: 'ordermgmt-token',
  SUPABASE_URL: 'https://catalog.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function request(body: unknown, token = 'ordermgmt-token', method = 'PATCH'): Request {
  return new Request('https://worker.test/api/internal/catalog/sku/N511P407695W/manual-fields', {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function requestRawBody(raw: string, token = 'ordermgmt-token'): Request {
  return new Request('https://worker.test/api/internal/catalog/sku/N511P407695W/manual-fields', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: raw,
  });
}

const variantRow = { id: 'variant-1', item_code: 'N511P407695W' };
const commercialRow = {
  variant_id: 'variant-1',
  raw_payload: { gigab2b_saved: { price_tier: 'A' } },
  manual_cost_price: null,
  manual_presale_arrival_date: null,
  presale_info_protect_until: null,
  effective_cost_price: 1500,
};

function successFetch(capture: { method?: string; url?: string; body?: unknown } = {}) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'PATCH') {
      capture.method = method;
      capture.url = url;
      capture.body = JSON.parse((init?.body as string) ?? '{}');
      return Response.json([{
        ...commercialRow,
        manual_cost_price: 2000,
        manual_presale_arrival_date: '2026-08-20',
        presale_info_protect_until: '2026-09-01',
        effective_cost_price: 2000,
      }]);
    }
    if (url.includes('/product_variants?')) return Response.json([variantRow]);
    if (url.includes('/product_commercials?')) return Response.json([commercialRow]);
    return Response.json([]);
  };
}

test('rejects unauthorized tokens without reading Supabase', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return Response.json([]); };
  const res = await handleCatalogSkuManualFieldsUpdate(request({ manual_cost_price: 1 }, 'wrong'), env, 'N511P407695W', fetchFn);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
  assert.equal(calls, 0);
});

test('does not accept the internal catalog or pipeline tokens', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return Response.json([]); };

  const internalRes = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }, 'catalog-token'), env, 'N511P407695W', fetchFn,
  );
  assert.equal(internalRes.status, 401);

  const pipelineRes = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }, 'pipeline-token'), env, 'N511P407695W', fetchFn,
  );
  assert.equal(pipelineRes.status, 401);

  assert.equal(calls, 0);
});

test('rejects non-PATCH methods', async () => {
  const getReq = new Request('https://worker.test/api/internal/catalog/sku/N511P407695W/manual-fields', {
    method: 'GET',
    headers: { authorization: 'Bearer ordermgmt-token' },
  });
  const res = await handleCatalogSkuManualFieldsUpdate(getReq, env, 'N511P407695W', async () => Response.json([]));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'PATCH');
});

test('requires a dedicated ordermgmt token to be configured', async () => {
  const partialEnv: InternalCatalogEnv = {
    INTERNAL_CATALOG_API_TOKEN: 'catalog-token',
    SUPABASE_URL: 'https://catalog.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  };
  const res = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), partialEnv, 'N511P407695W', async () => Response.json([]),
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'service_not_configured' });
});

test('rejects malformed JSON and non-object bodies', async () => {
  const malformed = requestRawBody('{');
  assert.equal((await handleCatalogSkuManualFieldsUpdate(malformed, env, 'N511P407695W', async () => Response.json([]))).status, 400);

  const array = requestRawBody('[]');
  const res = await handleCatalogSkuManualFieldsUpdate(array, env, 'N511P407695W', async () => Response.json([]));
  assert.equal(res.status, 400);
});

test('rejects unknown fields and empty bodies', async () => {
  const unknown = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1, extra: 'nope' }), env, 'N511P407695W', async () => Response.json([]),
  );
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'unknown_field', field: 'extra' });

  const empty = await handleCatalogSkuManualFieldsUpdate(
    request({}), env, 'N511P407695W', async () => Response.json([]),
  );
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'no_fields_to_update' });
});

test('rejects invalid calendar dates and non-date values', async () => {
  const cases = [
    { manual_presale_arrival_date: '2026-02-31' },
    { manual_presale_arrival_date: '2026-13-01' },
    { manual_presale_arrival_date: 'not-a-date' },
    { manual_presale_arrival_date: 20260820 },
    { presale_info_protect_until: '2026-02-31' },
  ];
  for (const body of cases) {
    const res = await handleCatalogSkuManualFieldsUpdate(
      request(body), env, 'N511P407695W', async () => Response.json([]),
    );
    assert.equal(res.status, 400);
    const payload = await res.json() as { error: string };
    assert.ok(payload.error.startsWith('invalid_manual_presale_arrival_date')
      || payload.error.startsWith('invalid_presale_info_protect_until'));
  }
});

test('rejects zero, negative, non-finite, oversized, and non-number cost', async () => {
  const invalidBodies: Array<{ raw: string } | { body: unknown }> = [
    { body: { manual_cost_price: 0 } },
    { body: { manual_cost_price: -1 } },
    { body: { manual_cost_price: 100_000_000 } },
    { body: { manual_cost_price: '123' } },
    { raw: '{"manual_cost_price":1e999}' },
  ];
  for (const entry of invalidBodies) {
    const req = 'raw' in entry ? requestRawBody(entry.raw) : request(entry.body);
    const res = await handleCatalogSkuManualFieldsUpdate(req, env, 'N511P407695W', async () => Response.json([]));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_manual_cost_price' });
  }
});

test('returns 404 for a missing variant and 409 for a duplicate variant', async () => {
  const missing = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), env, 'UNKNOWN', async () => Response.json([]),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'sku_not_found', item_code: 'UNKNOWN' });

  const duplicate = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), env, 'DUPLICATE',
    async () => Response.json([
      { id: 'variant-1', item_code: 'DUPLICATE' },
      { id: 'variant-2', item_code: 'DUPLICATE' },
    ]),
  );
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'duplicate_item_code', item_code: 'DUPLICATE' });
});

test('rejects missing and duplicate commercial rows', async () => {
  const missing = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), env, 'N511P407695W',
    async (input) => {
      const url = String(input);
      if (url.includes('/product_variants?')) return Response.json([variantRow]);
      return Response.json([]);
    },
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'commercial_state_missing', item_code: 'N511P407695W' });

  const duplicate = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), env, 'N511P407695W',
    async (input) => {
      const url = String(input);
      if (url.includes('/product_variants?')) return Response.json([variantRow]);
      return Response.json([commercialRow, commercialRow]);
    },
  );
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'duplicate_commercial_state', item_code: 'N511P407695W' });
});

test('successfully updates fields, preserves effective-price ownership, and avoids shared payload writes', async () => {
  const capture: { method?: string; url?: string; body?: Record<string, unknown> } = {};
  const res = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 2000, manual_presale_arrival_date: '2026-08-20' }),
    env,
    'n511p407695w',
    successFetch(capture),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    item_code: 'N511P407695W',
    manual_cost_price: 2000,
    manual_presale_arrival_date: '2026-08-20',
    presale_info_protect_until: '2026-09-01',
    effective_cost_price: 2000,
  });

  assert.equal(capture.method, 'PATCH');
  assert.match(capture.url ?? '', /\/rest\/v1\/product_commercials\?variant_id=eq\.variant-1/);

  const body = capture.body as Record<string, unknown>;
  assert.equal(body.manual_cost_price, 2000);
  assert.equal(body.manual_presale_arrival_date, '2026-08-20');
  assert.equal('presale_info_protect_until' in body, false);
  assert.equal('effective_cost_price' in body, false);

  assert.equal('raw_payload' in body, false);
  assert.equal('audit_notes' in body, false);
});

test('clears fields via null and returns stored nulls', async () => {
  const capture: { body?: Record<string, unknown> } = {};
  const res = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: null, presale_info_protect_until: null }),
    env,
    'N511P407695W',
    async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        capture.body = JSON.parse((init?.body as string) ?? '{}');
        return Response.json([{ ...commercialRow, manual_cost_price: null, presale_info_protect_until: null, effective_cost_price: 1500 }]);
      }
      if (url.includes('/product_variants?')) return Response.json([variantRow]);
      return Response.json([commercialRow]);
    },
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    item_code: 'N511P407695W',
    manual_cost_price: null,
    manual_presale_arrival_date: null,
    presale_info_protect_until: null,
    effective_cost_price: 1500,
  });
  assert.equal(capture.body?.manual_cost_price, null);
  assert.equal(capture.body?.presale_info_protect_until, null);
});

test('maps upstream failures to a generic 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const res = await handleCatalogSkuManualFieldsUpdate(
      request({ manual_cost_price: 1 }), env, 'N511P407695W',
      async () => new Response('forbidden', { status: 403 }),
    );
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'catalog_upstream_error' });

    const patchFails = await handleCatalogSkuManualFieldsUpdate(
      request({ manual_cost_price: 1 }), env, 'N511P407695W',
      async (input, init) => {
        const url = String(input);
        if (init?.method === 'PATCH') return new Response('unavailable', { status: 503 });
        if (url.includes('/product_variants?')) return Response.json([variantRow]);
        return Response.json([commercialRow]);
      },
    );
    assert.equal(patchFails.status, 502);
    assert.deepEqual(await patchFails.json(), { error: 'catalog_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('responds with Cache-Control: no-store', async () => {
  const res = await handleCatalogSkuManualFieldsUpdate(
    request({ manual_cost_price: 1 }), env, 'N511P407695W', successFetch(),
  );
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

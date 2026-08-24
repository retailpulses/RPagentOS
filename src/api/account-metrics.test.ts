import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAccountMetricsRequest, type AccountMetricsEnv } from './account-metrics.js';

const env: AccountMetricsEnv = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
};

function request(query = ''): Request {
  return new Request(`https://agent.test/api/account-metrics${query}`);
}

function manualRequest(body: unknown): Request {
  return new Request('https://agent.test/api/account-metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validManualMetric = {
  platform_account_id: '00000000-0000-4000-8000-000000000004',
  period_month: '2026-07',
  source_as_of_date: '2026-07-31',
  coverage_status: 'complete',
  sales_amount: 2191473,
  visitor_count: 47844,
  reported_conversion_rate: 0,
  reported_conversion_rate_reliable: false,
  average_purchase_value: 12451,
  new_follower_count: 279,
  note: 'Entered from the monthly dashboard export.',
} as const;

test('returns 503 when the server-side Supabase configuration is missing', async () => {
  const response = await handleAccountMetricsRequest(request(), {
    SUPABASE_URL: env.SUPABASE_URL,
  });
  assert.equal(response.status, 503);
});

test('returns accounts and monthly metrics with two bounded bulk reads', async () => {
  const urls: string[] = [];
  const response = await handleAccountMetricsRequest(
    request('?platform=mercari&shop_code=shop4'),
    env,
    async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/platform_accounts?')) {
        return Response.json([{
          id: '00000000-0000-0000-0000-000000000004',
          platform: 'mercari',
          shop_code: 'shop4',
          display_name: 'Shop 4',
          default_currency: 'JPY',
        }]);
      }
      return Response.json([{
        id: 'metric-1',
        platform_account_id: '00000000-0000-0000-0000-000000000004',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
        source_as_of_date: '2026-08-24',
        coverage_status: 'complete',
        currency: 'JPY',
        sales_amount: 2191473,
        visitor_count: 47844,
        reported_conversion_rate: 0,
        reported_conversion_rate_reliable: false,
        average_purchase_value: 12451,
        new_follower_count: 279,
        estimated_purchaser_count: 176,
        estimated_conversion_rate: 0.00367879,
        quality_flags: ['reported_conversion_rate_low_precision'],
      }]);
    },
  );

  assert.equal(response.status, 200);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /platform=eq\.mercari/);
  assert.match(urls[0], /shop_code=eq\.shop4/);
  assert.match(urls[1], /platform_account_id=in\.%28/);
  const payload = await response.json() as { accounts: unknown[]; metrics: unknown[] };
  assert.equal(payload.accounts.length, 1);
  assert.equal(payload.metrics.length, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('does not issue a metric query when no active account matches', async () => {
  let calls = 0;
  const response = await handleAccountMetricsRequest(request(), env, async () => {
    calls += 1;
    return Response.json([]);
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { accounts: [], metrics: [] });
});

test('rejects malformed filters', async () => {
  const response = await handleAccountMetricsRequest(request('?shop_code=shop4%2Cstatus.eq.active'), env);
  assert.equal(response.status, 400);
});

test('maps upstream failures to a generic 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleAccountMetricsRequest(
      request(),
      env,
      async () => new Response('forbidden', { status: 403 }),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'account_metrics_upstream_error' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('rejects unsupported methods and advertises the supported methods', async () => {
  const response = await handleAccountMetricsRequest(
    new Request('https://agent.test/api/account-metrics', { method: 'PUT' }),
    env,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
});

test('manual insert rejects unsupported content types and malformed inputs before Supabase reads', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json([]);
  };
  const unsupported = new Request('https://agent.test/api/account-metrics', { method: 'POST', body: '{}' });
  assert.equal((await handleAccountMetricsRequest(unsupported, env, fetchImpl)).status, 415);
  assert.equal((await handleAccountMetricsRequest(manualRequest({ ...validManualMetric, unexpected: true }), env, fetchImpl)).status, 400);
  assert.equal((await handleAccountMetricsRequest(manualRequest({ ...validManualMetric, visitor_count: -1 }), env, fetchImpl)).status, 400);
  assert.equal(calls, 0);
});

test('manual insert rejects oversized bodies and future or inconsistent dates before Supabase reads', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json([]);
  };
  const oversized = new Request('https://agent.test/api/account-metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...validManualMetric, note: 'x'.repeat(16_384) }),
  });
  assert.equal((await handleAccountMetricsRequest(oversized, env, fetchImpl)).status, 413);
  assert.equal((await handleAccountMetricsRequest(manualRequest({ ...validManualMetric, period_month: '2100-12' }), env, fetchImpl)).status, 400);
  assert.equal((await handleAccountMetricsRequest(manualRequest({ ...validManualMetric, source_as_of_date: '2026-06-30' }), env, fetchImpl)).status, 400);
  assert.equal(calls, 0);
});

test('manual insert rejects an inactive account and an existing account-month', async () => {
  const inactive = await handleAccountMetricsRequest(manualRequest(validManualMetric), env, async () => Response.json([]));
  assert.equal(inactive.status, 404);

  let calls = 0;
  const conflict = await handleAccountMetricsRequest(manualRequest(validManualMetric), env, async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json([{
        id: validManualMetric.platform_account_id,
        platform: 'mercari',
        shop_code: 'shop4',
        default_currency: 'JPY',
      }]);
    }
    return Response.json([{ id: 'existing-metric' }]);
  });
  assert.equal(conflict.status, 409);
  assert.equal(calls, 2);
  assert.deepEqual(await conflict.json(), { error: 'metric_already_exists' });
});

test('manual insert performs two bounded reads and one insert without generated-column writes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const insertedMetric = {
    id: 'metric-manual-1',
    platform_account_id: validManualMetric.platform_account_id,
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    source_as_of_date: '2026-07-31',
    coverage_status: 'complete',
    currency: 'JPY',
    sales_amount: 2191473,
    visitor_count: 47844,
    reported_conversion_rate: 0,
    reported_conversion_rate_reliable: false,
    average_purchase_value: 12451,
    new_follower_count: 279,
    estimated_purchaser_count: 176,
    estimated_conversion_rate: 0.00367879,
    quality_flags: ['manual_entry', 'reported_conversion_rate_low_precision'],
  };
  const response = await handleAccountMetricsRequest(manualRequest(validManualMetric), env, async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/platform_accounts?')) {
      return Response.json([{
        id: validManualMetric.platform_account_id,
        platform: 'mercari',
        shop_code: 'shop4',
        default_currency: 'JPY',
      }]);
    }
    if (init?.method === 'POST') return Response.json([insertedMetric], { status: 201 });
    return Response.json([]);
  });

  assert.equal(response.status, 201);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init?.method, 'POST');
  const insertBody = JSON.parse(String(calls[2].init?.body)) as Record<string, unknown>;
  assert.equal(insertBody.source_system, 'manual_portal');
  assert.ok(!('estimated_purchaser_count' in insertBody));
  assert.ok(!('estimated_conversion_rate' in insertBody));
  assert.deepEqual(await response.json(), { metric: insertedMetric });
});

test('manual insert maps read and write failures to a generic 502', async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const readFailure = await handleAccountMetricsRequest(
      manualRequest(validManualMetric),
      env,
      async () => new Response('unavailable', { status: 503 }),
    );
    assert.equal(readFailure.status, 502);

    let calls = 0;
    const writeFailure = await handleAccountMetricsRequest(manualRequest(validManualMetric), env, async (input, init) => {
      calls += 1;
      if (calls === 1) {
        return Response.json([{
          id: validManualMetric.platform_account_id,
          platform: 'mercari',
          shop_code: 'shop4',
          default_currency: 'JPY',
        }]);
      }
      if (init?.method === 'POST') return new Response('unavailable', { status: 503 });
      return Response.json([]);
    });
    assert.equal(writeFailure.status, 502);
    assert.equal(calls, 3);
  } finally {
    console.error = originalConsoleError;
  }
});

test('manual insert maps a concurrent unique-key conflict to 409 without retrying', async () => {
  let calls = 0;
  const response = await handleAccountMetricsRequest(manualRequest(validManualMetric), env, async (input, init) => {
    calls += 1;
    if (calls === 1) {
      return Response.json([{
        id: validManualMetric.platform_account_id,
        platform: 'mercari',
        shop_code: 'shop4',
        default_currency: 'JPY',
      }]);
    }
    if (init?.method === 'POST') return Response.json({ code: '23505' }, { status: 409 });
    return Response.json([]);
  });
  assert.equal(response.status, 409);
  assert.equal(calls, 3);
  assert.deepEqual(await response.json(), { error: 'metric_already_exists' });
});

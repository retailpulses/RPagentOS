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

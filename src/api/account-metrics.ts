import type {
  AccountMetricsResponse,
  PlatformAccountMetricAccount,
  PlatformAccountMonthlyMetric,
} from '../lib/account-metrics-types.js';

export interface AccountMetricsEnv {
  ACCOUNT_METRICS_API_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type FetchLike = typeof fetch;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

function tokensEqual(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let mismatch = actual.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function validFilter(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{1,64}$/.test(value));
}

function postgrestHeaders(env: Required<Pick<AccountMetricsEnv, 'SUPABASE_SERVICE_ROLE_KEY'>>): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
  };
}

export async function handleAccountMetricsRequest(
  request: Request,
  env: AccountMetricsEnv,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'GET') {
    const response = json({ error: 'method_not_allowed' }, 405);
    response.headers.set('allow', 'GET');
    return response;
  }

  if (!env.ACCOUNT_METRICS_API_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'account_metrics_not_configured' }, 503);
  }

  const token = bearerToken(request);
  if (!token || !tokensEqual(token, env.ACCOUNT_METRICS_API_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const shopCode = url.searchParams.get('shop_code');
  if ((platform && !validFilter(platform)) || (shopCode && !validFilter(shopCode))) {
    return json({ error: 'invalid_filter' }, 400);
  }

  const accountParams = new URLSearchParams({
    select: 'id,platform,shop_code,display_name,default_currency',
    status: 'eq.active',
    order: 'platform.asc,shop_code.asc',
  });
  if (platform) accountParams.set('platform', `eq.${platform}`);
  if (shopCode) accountParams.set('shop_code', `eq.${shopCode}`);

  try {
    const accountResponse = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/platform_accounts?${accountParams.toString()}`,
      { headers: postgrestHeaders(env as Required<AccountMetricsEnv>) },
    );
    if (!accountResponse.ok) {
      console.error('Account metrics account query failed', accountResponse.status);
      return json({ error: 'account_metrics_upstream_error' }, 502);
    }

    const accountRows = await accountResponse.json() as Array<{
      id: string;
      platform: string;
      shop_code: string;
      display_name: string | null;
      default_currency: string | null;
    }>;

    const accounts: PlatformAccountMetricAccount[] = accountRows.map((account) => ({
      id: account.id,
      platform: account.platform,
      shop_code: account.shop_code,
      display_name: account.display_name,
      currency: account.default_currency || 'JPY',
    }));

    if (accounts.length === 0) {
      return json({ accounts: [], metrics: [] } satisfies AccountMetricsResponse);
    }

    const metricParams = new URLSearchParams({
      select: [
        'id',
        'platform_account_id',
        'period_start',
        'period_end',
        'source_as_of_date',
        'coverage_status',
        'currency',
        'sales_amount',
        'visitor_count',
        'reported_conversion_rate',
        'reported_conversion_rate_reliable',
        'average_purchase_value',
        'new_follower_count',
        'estimated_purchaser_count',
        'estimated_conversion_rate',
        'quality_flags',
      ].join(','),
      platform_account_id: `in.(${accounts.map((account) => account.id).join(',')})`,
      order: 'period_start.asc',
    });
    const metricResponse = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/platform_account_monthly_metrics?${metricParams.toString()}`,
      { headers: postgrestHeaders(env as Required<AccountMetricsEnv>) },
    );
    if (!metricResponse.ok) {
      console.error('Account metrics fact query failed', metricResponse.status);
      return json({ error: 'account_metrics_upstream_error' }, 502);
    }

    const metrics = await metricResponse.json() as PlatformAccountMonthlyMetric[];
    return json({ accounts, metrics } satisfies AccountMetricsResponse);
  } catch (error) {
    console.error('Account metrics request failed', error);
    return json({ error: 'account_metrics_upstream_error' }, 502);
  }
}

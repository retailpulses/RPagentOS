import type {
  AccountMetricsResponse,
  ManualAccountMetricInput,
  PlatformAccountMetricAccount,
  PlatformAccountMonthlyMetric,
} from '../lib/account-metrics-types.js';

export interface AccountMetricsEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type FetchLike = typeof fetch;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
};

const METRIC_SELECT = [
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
].join(',');

const MANUAL_INPUT_KEYS = new Set([
  'platform_account_id',
  'period_month',
  'source_as_of_date',
  'coverage_status',
  'sales_amount',
  'visitor_count',
  'reported_conversion_rate',
  'reported_conversion_rate_reliable',
  'average_purchase_value',
  'new_follower_count',
  'note',
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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

function postgrestWriteHeaders(env: Required<Pick<AccountMetricsEnv, 'SUPABASE_SERVICE_ROLE_KEY'>>): HeadersInit {
  return {
    ...postgrestHeaders(env),
    'content-type': 'application/json',
    prefer: 'return=representation',
  };
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function finiteRange(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function parseManualInput(value: unknown): { input: ManualAccountMetricInput; periodStart: string; periodEnd: string; sourceAsOfDate: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !MANUAL_INPUT_KEYS.has(key))) return null;
  if (!validUuid(record.platform_account_id)) return null;
  if (typeof record.period_month !== 'string' || !/^\d{4}-\d{2}$/.test(record.period_month)) return null;
  const [year, month] = record.period_month.split('-').map(Number);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  if (record.coverage_status !== 'complete' && record.coverage_status !== 'partial') return null;
  if (!finiteRange(record.sales_amount, 99_999_999_999_999.99)) return null;
  if (!finiteRange(record.visitor_count, 1_000_000_000_000) || !Number.isInteger(record.visitor_count)) return null;
  if (!finiteRange(record.average_purchase_value, 999_999_999_999.99)) return null;
  if (record.sales_amount > 0 && record.average_purchase_value === 0) return null;
  if (!finiteRange(record.new_follower_count, 1_000_000_000_000) || !Number.isInteger(record.new_follower_count)) return null;
  if (typeof record.reported_conversion_rate_reliable !== 'boolean') return null;
  if (record.reported_conversion_rate !== undefined && record.reported_conversion_rate !== null
    && !finiteRange(record.reported_conversion_rate, 1)) return null;
  if (record.note !== undefined && record.note !== null
    && (typeof record.note !== 'string' || record.note.trim().length > 500)) return null;

  const periodStart = `${record.period_month}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (periodStart > today || (record.coverage_status === 'complete' && periodEnd > today)) return null;
  const defaultSourceDate = periodEnd < today ? periodEnd : today;
  const sourceAsOfDate = record.source_as_of_date ?? defaultSourceDate;
  if (!validDate(sourceAsOfDate) || sourceAsOfDate < periodStart || sourceAsOfDate > today) return null;

  return {
    input: record as unknown as ManualAccountMetricInput,
    periodStart,
    periodEnd,
    sourceAsOfDate,
  };
}

async function handleManualMetricInsert(
  request: Request,
  env: Required<Pick<AccountMetricsEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>>,
  fetchImpl: FetchLike,
): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 16_384) return json({ error: 'payload_too_large' }, 413);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (rawBody.length === 0 || rawBody.length > 16_384) return json({ error: rawBody.length > 16_384 ? 'payload_too_large' : 'invalid_json' }, rawBody.length > 16_384 ? 413 : 400);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseManualInput(body);
  if (!parsed) return json({ error: 'invalid_metric' }, 400);

  const accountParams = new URLSearchParams({
    select: 'id,platform,shop_code,default_currency',
    id: `eq.${parsed.input.platform_account_id}`,
    status: 'eq.active',
    limit: '2',
  });

  try {
    const accountResponse = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/platform_accounts?${accountParams.toString()}`,
      { headers: postgrestHeaders(env) },
    );
    if (!accountResponse.ok) return json({ error: 'account_metrics_upstream_error' }, 502);
    const accounts = await accountResponse.json() as Array<{
      id: string;
      platform: string;
      shop_code: string;
      default_currency: string | null;
    }>;
    if (accounts.length !== 1) return json({ error: 'account_not_found' }, 404);
    const account = accounts[0];

    const existingParams = new URLSearchParams({
      select: 'id',
      platform_account_id: `eq.${account.id}`,
      period_start: `eq.${parsed.periodStart}`,
      limit: '1',
    });
    const existingResponse = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/platform_account_monthly_metrics?${existingParams.toString()}`,
      { headers: postgrestHeaders(env) },
    );
    if (!existingResponse.ok) return json({ error: 'account_metrics_upstream_error' }, 502);
    const existing = await existingResponse.json() as Array<{ id: string }>;
    if (existing.length > 0) return json({ error: 'metric_already_exists' }, 409);

    const qualityFlags = ['manual_entry'];
    if (parsed.input.reported_conversion_rate === 0 && !parsed.input.reported_conversion_rate_reliable) {
      qualityFlags.push('reported_conversion_rate_low_precision');
    }
    const insertResponse = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/platform_account_monthly_metrics?select=${encodeURIComponent(METRIC_SELECT)}`,
      {
        method: 'POST',
        headers: postgrestWriteHeaders(env),
        body: JSON.stringify({
          platform_account_id: account.id,
          period_start: parsed.periodStart,
          period_end: parsed.periodEnd,
          source_as_of_date: parsed.sourceAsOfDate,
          coverage_status: parsed.input.coverage_status,
          currency: account.default_currency || 'JPY',
          sales_amount: parsed.input.sales_amount,
          visitor_count: parsed.input.visitor_count,
          reported_conversion_rate: parsed.input.reported_conversion_rate ?? null,
          reported_conversion_rate_reliable: parsed.input.reported_conversion_rate_reliable,
          average_purchase_value: parsed.input.average_purchase_value,
          new_follower_count: parsed.input.new_follower_count,
          source_system: 'manual_portal',
          source_file: `manual_portal/${account.platform}/${account.shop_code}/${parsed.periodStart}`,
          quality_flags: qualityFlags,
          raw_payload: {
            submission_id: crypto.randomUUID(),
            submitted_via: 'agent.homesbliss.net/metrics',
            manager_note: parsed.input.note?.trim() || null,
          },
        }),
      },
    );
    if (insertResponse.status === 409) return json({ error: 'metric_already_exists' }, 409);
    if (!insertResponse.ok) return json({ error: 'account_metrics_upstream_error' }, 502);
    const inserted = await insertResponse.json() as PlatformAccountMonthlyMetric[];
    if (inserted.length !== 1) return json({ error: 'account_metrics_upstream_error' }, 502);
    return json({ metric: inserted[0] }, 201);
  } catch (error) {
    console.error('Manual account metric insert failed', error);
    return json({ error: 'account_metrics_upstream_error' }, 502);
  }
}

export async function handleAccountMetricsRequest(
  request: Request,
  env: AccountMetricsEnv,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    const response = json({ error: 'method_not_allowed' }, 405);
    response.headers.set('allow', 'GET, POST');
    return response;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'account_metrics_not_configured' }, 503);
  }

  if (request.method === 'POST') {
    return handleManualMetricInsert(
      request,
      env as Required<Pick<AccountMetricsEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>>,
      fetchImpl,
    );
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
      select: METRIC_SELECT,
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
